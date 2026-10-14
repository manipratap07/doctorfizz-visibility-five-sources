import { randomUUID } from "node:crypto";
import { brandSalt, hashBrandKey } from "./brand-key";
import { pool, query } from "./db";
import { brandMatches } from "./analysis";
import { checkDeadlineSeconds, providers } from "./providers.config";
import { providerQueue, deadlineQueue } from "./redis";
import { allowance } from "./limits";
import { z } from "zod";
import type { Brand, Run, Check, BatchPrompt } from "./types";
const brandKey = (brand: Brand) =>
  hashBrandKey(
    brand.domain || "brand:" + brand.name.toLowerCase(),
    brandSalt(),
  );
export async function createCheck(
  visitorId: string,
  ip: string,
  data: {
    profileId: string;
    prompts: string[];
    providers: string[];
    idempotencyKey: string;
  },
) {
  const c = await pool.connect();
  let checkId = randomUUID(),
    existing = false;
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(841372)");
    const prior = await c.query(
      "SELECT id FROM checks WHERE visitor_id=$1 AND idempotency_key=$2",
      [visitorId, data.idempotencyKey],
    );
    if (prior.rows.length) {
      checkId = prior.rows[0].id;
      existing = true;
      await c.query("COMMIT");
      return { checkId, existing };
    }
    const texts = z
      .array(z.string().trim().min(8).max(1000))
      .min(2)
      .max(5)
      .parse(data.prompts);
    const row = (
      await c.query(
        "SELECT brand FROM site_profiles WHERE id=$1 AND visitor_id=$2",
        [data.profileId, visitorId],
      )
    ).rows[0];
    if (!row) throw new Error("Your business profile was not found.");
    const batch: BatchPrompt[] = texts.map((text, index) => ({
      id: randomUUID(),
      index,
      text,
      bias:
        brandMatches(text, row.brand) ||
        !!(
          row.brand.domain &&
          text.toLowerCase().includes(row.brand.domain.toLowerCase())
        ),
    }));
    const selected = [...new Set(data.providers)].map((id) =>
      providers().find((p) => p.id === id && p.enabled),
    );
    if (selected.some((p) => !p))
      throw new Error("Unknown or disabled provider.");
    const cost = 0;
    if (!selected.length || selected.length > 3)
      throw new Error("Select one to three browser providers.");
    const [load] = (
      await c.query("SELECT count(*) n FROM checks WHERE status!='completed'")
    ).rows;
    if (Number(load.n) >= Number(process.env.MAX_PENDING_CHECKS || 1))
      throw new Error(
        "Browser workers are busy. Please try again after the current checks finish.",
      );
    const stats = (
      await c.query(
        `SELECT count(*) FILTER (WHERE (visitor_id=$1 OR ip_hash=$2) AND NOT refunded AND created_at>now()-($4*interval '1 day')) visitor_count,count(*) FILTER (WHERE ip_hash=$2 AND created_at>date_trunc('day',now())) ip_count,count(*) FILTER (WHERE domain=$3 AND created_at>date_trunc('day',now())) domain_count FROM usage_events`,
        [
          visitorId,
          ip,
          brandKey(row.brand as Brand),
          Number(process.env.WINDOW_DAYS || 30),
        ],
      )
    ).rows[0];
    if (Number(stats.visitor_count) >= allowance())
      throw new Error("Your five free checks have been used.");
    if (
      Number(stats.ip_count) >= Number(process.env.IP_DAILY_CAP || 15) ||
      Number(stats.domain_count) >= Number(process.env.DOMAIN_DAILY_CAP || 10)
    )
      throw new Error("The daily check limit has been reached.");
    for (const prompt of batch)
      await c.query(
        "INSERT INTO generated_prompts(id,site_profile_id,type,text) VALUES($1,$2,'Custom',$3)",
        [prompt.id, data.profileId, prompt.text],
      );
    const deadline = checkDeadlineSeconds(batch.length * selected.length);
    await c.query(
      "INSERT INTO checks(id,visitor_id,site_profile_id,prompt_id,prompt_text,brand,selected_providers,estimated_cost,deadline_at,idempotency_key,prompt_kind,prompt_bias,prompts) VALUES($1,$2,$3,$4,$5,$6,$7,0,now()+($8*interval '1 second'),$9,'custom_batch',$10,$11)",
      [
        checkId,
        visitorId,
        data.profileId,
        batch[0].id,
        batch[0].text,
        row.brand,
        JSON.stringify(selected.map((p) => p!.id)),
        deadline,
        data.idempotencyKey,
        batch.some((p) => p.bias),
        JSON.stringify(batch),
      ],
    );
    // Prompt-major ordering lets the user see each question finish across all sources.
    for (const prompt of batch)
      for (const provider of selected)
        await c.query(
          "INSERT INTO llm_runs(id,check_id,provider_id,repeat_index,prompt_id,prompt_index,prompt_text,prompt_bias,source_url) VALUES($1,$2,$3,0,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            checkId,
            provider!.id,
            prompt.id,
            prompt.index,
            prompt.text,
            prompt.bias,
            provider!.url,
          ],
        );
    await c.query(
      "INSERT INTO usage_events(id,visitor_id,check_id,ip_hash,domain,cost) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        visitorId,
        checkId,
        ip,
        brandKey(row.brand as Brand),
        cost,
      ],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  // Database rows are the durable outbox; worker reconciliation repairs queue interruptions.
  try {
    await enqueue(checkId);
  } catch {
    console.error(JSON.stringify({ event: "enqueue_deferred", checkId }));
  }
  return { checkId, existing };
}
export async function enqueue(id: string) {
  const rows = await query<{
    id: string;
    provider_id: string;
    repeat_index: number;
  }>(
    "SELECT id,provider_id,repeat_index FROM llm_runs WHERE check_id=$1 AND status IN ('queued','running') ORDER BY prompt_index,provider_id",
    [id],
  );
  for (const r of rows) {
    const q = providerQueue(r.provider_id);
    try {
      await q.add(
        "run",
        { runId: r.id, checkId: id, repeat_index: r.repeat_index },
        {
          jobId: r.id,
          attempts: 1,
          backoff: { type: "exponential", delay: 1500 },
          removeOnComplete: 1000,
          // A failed job must not block re-queueing its run under the same id.
          removeOnFail: true,
        },
      );
    } finally {
      await q.close();
    }
  }
  const [deadline] = await query<{ deadline_at: string }>(
    "SELECT deadline_at FROM checks WHERE id=$1",
    [id],
  );
  if (!deadline) return;
  const q = deadlineQueue();
  try {
    await q.add(
      "finalize",
      { checkId: id },
      {
        jobId: id,
        delay: Math.max(
          0,
          new Date(deadline!.deadline_at).getTime() - Date.now(),
        ),
        removeOnComplete: 1000,
      },
    );
  } finally {
    await q.close();
  }
}
export async function getCheck(id: string): Promise<Check | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const [row] = await query<Check & { deadline_at: string }>(
    "SELECT id,brand,prompt_text,prompt_kind,prompt_bias,prompts,status,created_at,refunded,deadline_at FROM checks WHERE id=$1 AND created_at>now()-interval '7 days'",
    [id],
  );
  if (!row) return null;
  if (
    row.status !== "completed" &&
    new Date(row.deadline_at).getTime() <= Date.now()
  ) {
    await finish(id, true);
    return getCheck(id);
  }
  const { deadline_at: _, ...check } = row;
  check.runs = await query<Run>(
    "SELECT * FROM llm_runs WHERE check_id=$1 ORDER BY prompt_index,provider_id,repeat_index",
    [id],
  );
  return check;
}
export async function finish(id: string, force = false) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const check = (
      await c.query("SELECT * FROM checks WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!check || check.status === "completed") {
      await c.query("COMMIT");
      return;
    }
    if (force)
      await c.query(
        "UPDATE llm_runs SET status='timeout',phase='failed',phase_message='Overall batch deadline exceeded.',reason='Overall batch deadline exceeded.',phase_updated_at=now(),completed_at=now() WHERE check_id=$1 AND status IN ('queued','running')",
        [id],
      );
    const rows = (
      await c.query("SELECT status FROM llm_runs WHERE check_id=$1", [id])
    ).rows;
    if (rows.some((r) => ["queued", "running"].includes(r.status))) {
      await c.query("COMMIT");
      return;
    }
    const refund = rows.every((r) => r.status !== "ok");
    await c.query(
      "UPDATE checks SET status='completed',refunded=$2 WHERE id=$1",
      [id, refund],
    );
    if (refund)
      await c.query("UPDATE usage_events SET refunded=true WHERE check_id=$1", [
        id,
      ]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
