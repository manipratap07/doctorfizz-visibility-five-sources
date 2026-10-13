import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const state = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  sent: [] as string[],
  observed: [] as string[],
  failCapture: false,
}));
vi.mock("../src/lib/provider-adapters", () => ({
  getAdapter: () => ({
    run: async (input: import("../src/lib/types").BrowserInput) => {
      state.sent.push(input.prompt);
      if (state.failCapture)
        return {
          status: "timeout",
          errorReason: "Fixture capture timeout",
          webSearchUsed: false,
          latencyMs: 10,
        };
      for (const phase of [
        "opening",
        "submitting",
        "waiting",
        "collecting",
      ] as const) {
        await input.onProgress?.(
          phase,
          `Fixture ${phase}`,
          "https://copilot.microsoft.com/",
        );
        const result = await state.db.query<{ phase: string }>(
          "SELECT phase FROM llm_runs WHERE status='running'",
        );
        state.observed.push(result.rows[0].phase);
      }
      return {
        status: "ok",
        answerText: `1. Demo: a useful service. Answer to: ${input.prompt}`,
        citations: [],
        webSearchUsed: false,
        latencyMs: 1,
      };
    },
  }),
}));
vi.mock("../src/lib/db", () => {
  const query = async (sql: string, args: unknown[] = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    return (await state.db.query(sql, args)).rows;
  };
  return {
    query,
    pool: {
      connect: async () => ({
        query: async (sql: string, args: unknown[] = []) => ({
          rows: await query(sql, args),
        }),
        release: () => {},
      }),
    },
  };
});
vi.mock("../src/lib/redis", () => ({
  providerQueue: () => ({ add: async () => {}, close: async () => {} }),
  deadlineQueue: () => ({ add: async () => {}, close: async () => {} }),
}));
import { createCheck, finish, getCheck } from "../src/lib/checks";
import { processBrowserRun } from "../src/worker/process-run";
import { usage } from "../src/lib/limits";
const visitor = randomUUID(),
  profile = randomUUID(),
  prompt = randomUUID();
const input = () => ({
  profileId: profile,
  prompts: Array.from(
    { length: 5 },
    (_, i) => `Which software is useful for customer situation ${i + 1}?`,
  ),
  providers: ["copilot", "duckai"],
  idempotencyKey: randomUUID(),
});
beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(readFileSync("db/001.sql", "utf8"));
  await state.db.exec(readFileSync("db/001.sql", "utf8")); // Additive migration is safe to repeat.
  process.env.MAX_PENDING_CHECKS = "10";
  process.env.DAILY_BUDGET_USD = "0";
  process.env.ANALYSIS_COST_CEILING_USD = "0.02";
  await state.db.query("INSERT INTO visitors(id) VALUES($1)", [visitor]);
  await state.db.query(
    "INSERT INTO site_profiles(id,visitor_id,brand,profile) VALUES($1,$2,$3,$4)",
    [
      profile,
      visitor,
      JSON.stringify({ name: "Acme", domain: "acme.com", aliases: [] }),
      JSON.stringify({}),
    ],
  );
  await state.db.query(
    "INSERT INTO generated_prompts(id,site_profile_id,type,text) VALUES($1,$2,$3,$4)",
    [
      prompt,
      profile,
      "Best",
      "What are the best accounting software options for small business teams?",
    ],
  );
});
afterAll(async () => {
  await state.db.close();
});
it("creates durable runs, reuses idempotency and enforces ownership", async () => {
  const d = input();
  const a = await createCheck(visitor, "hash", d);
  const b = await createCheck(visitor, "hash", d);
  expect(a.checkId).toBe(b.checkId);
  expect((await getCheck(a.checkId))?.runs).toHaveLength(10);
  await expect(
    createCheck(visitor, "hash", { ...input(), profileId: randomUUID() }),
  ).rejects.toThrow("profile was not found");
  await state.db.query("UPDATE llm_runs SET status='error' WHERE check_id=$1", [
    a.checkId,
  ]);
  await finish(a.checkId);
  expect((await getCheck(a.checkId))?.refunded).toBe(true);
  expect(await usage(visitor, "hash")).toBe(5);
});
it("preserves successful partial results and times out pending jobs", async () => {
  const a = await createCheck(visitor, "hash", input());
  await state.db.query(
    "UPDATE llm_runs SET status='ok',answer_text='Evidence' WHERE check_id=$1 AND provider_id='copilot'",
    [a.checkId],
  );
  await finish(a.checkId, true);
  const c = await getCheck(a.checkId);
  expect(c?.status).toBe("completed");
  expect(c?.refunded).toBe(false);
  expect(c?.runs.find((r) => r.provider_id === "duckai")?.status).toBe(
    "timeout",
  );
});
it("limits five checks server-side and rejects the sixth", async () => {
  for (let i = 0; i < 4; i++) {
    const c = await createCheck(visitor, "hash", input());
    await state.db.query("UPDATE llm_runs SET status='ok' WHERE check_id=$1", [
      c.checkId,
    ]);
    await finish(c.checkId);
  }
  expect(await usage(visitor, "hash")).toBe(0);
  await expect(createCheck(visitor, "hash", input())).rejects.toThrow(
    "five free",
  );
});

it("does not reset allowance when a visitor cookie changes on the same IP", async () => {
  const other = randomUUID(),
    site = randomUUID(),
    question = randomUUID();
  await state.db.query("INSERT INTO visitors(id) VALUES($1)", [other]);
  await state.db.query(
    "INSERT INTO site_profiles(id,visitor_id,brand,profile) VALUES($1,$2,$3,$4)",
    [
      site,
      other,
      JSON.stringify({
        name: "Other Brand",
        domain: "other.example",
        aliases: [],
      }),
      JSON.stringify({}),
    ],
  );
  await state.db.query(
    "INSERT INTO generated_prompts(id,site_profile_id,type,text) VALUES($1,$2,$3,$4)",
    [
      question,
      site,
      "Best",
      "What are the best software providers for small business teams?",
    ],
  );
  expect(await usage(other, "hash")).toBe(0);
  await expect(
    createCheck(other, "hash", {
      profileId: site,
      prompts: input().prompts,
      providers: ["copilot"],
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow("five free");
});
it("requires exactly five valid user questions and rolls back invalid batches", async () => {
  const before = (
    await state.db.query<{ n: number }>("SELECT count(*)::int n FROM checks")
  ).rows[0].n;
  for (const prompts of [
    input().prompts.slice(0, 4),
    [...input().prompts, "Sixth question?"],
    ["short", ...input().prompts.slice(1)],
  ]) {
    await expect(
      createCheck(visitor, "new-ip", { ...input(), prompts }),
    ).rejects.toThrow();
  }
  expect(
    (await state.db.query<{ n: number }>("SELECT count(*)::int n FROM checks"))
      .rows[0].n,
  ).toBe(before);
});

it("browser checks require no paid LLM credentials or budget and flag a custom brand query", async () => {
  const visitorId = randomUUID(),
    site = randomUUID(),
    question = randomUUID();
  await state.db.query("INSERT INTO visitors(id) VALUES($1)", [visitorId]);
  await state.db.query(
    "INSERT INTO site_profiles(id,visitor_id,brand,profile) VALUES($1,$2,$3,$4)",
    [
      site,
      visitorId,
      JSON.stringify({ name: "Demo", domain: "", aliases: [] }),
      "{}",
    ],
  );
  await state.db.query(
    "INSERT INTO generated_prompts(id,site_profile_id,type,text) VALUES($1,$2,'Custom',$3)",
    [question, site, "Is Demo a useful service for my small business?"],
  );
  const c = await createCheck(visitorId, "different-ip", {
    profileId: site,
    prompts: [
      "Is Demo a useful service for my small business?",
      ...input().prompts.slice(1),
    ],
    providers: ["duckai"],
    idempotencyKey: randomUUID(),
  });
  const result = await getCheck(c.checkId);
  expect(result?.prompt_kind).toBe("custom_batch");
  expect(result?.prompt_bias).toBe(true);
  expect(result?.prompts).toHaveLength(5);
  expect(result?.runs).toHaveLength(5);
  expect(result?.runs.map((r) => r.prompt_text)).toEqual([
    "Is Demo a useful service for my small business?",
    ...input().prompts.slice(1),
  ]);
  expect(result?.runs.map((r) => r.prompt_bias)).toEqual([
    true,
    false,
    false,
    false,
    false,
  ]);
  const [row] = (
    await state.db.query<{ estimated_cost: string }>(
      "SELECT estimated_cost FROM checks WHERE id=$1",
      [c.checkId],
    )
  ).rows;
  expect(Number(row.estimated_cost)).toBe(0);
});

it("dispatches all twenty distinct prompt/source runs and persists real stages and answers", async () => {
  const owner = randomUUID(),
    site = randomUUID();
  await state.db.query("INSERT INTO visitors(id) VALUES($1)", [owner]);
  await state.db.query(
    "INSERT INTO site_profiles(id,visitor_id,brand,profile) VALUES($1,$2,$3,'{}')",
    [
      site,
      owner,
      JSON.stringify({ name: "Demo", domain: "demo.test", aliases: [] }),
    ],
  );
  const questions = [
    "कौन सी सेवा अच्छी है और क्यों?",
    "Compare services for a new business.",
    "Which providers have helpful customer support?",
    "List affordable software for small businesses.",
    "How can Demo help my business grow?",
  ];
  const c = await createCheck(owner, "batch-ip", {
    profileId: site,
    prompts: questions,
    providers: ["chatgpt", "gemini", "copilot", "google-ai", "duckai"],
    idempotencyKey: randomUUID(),
  });
  const check = await getCheck(c.checkId);
  expect(check?.runs).toHaveLength(25);
  const [deadline] = (
    await state.db.query<{ seconds: number }>(
      "SELECT extract(epoch from(deadline_at-created_at)) seconds FROM checks WHERE id=$1",
      [c.checkId],
    )
  ).rows;
  expect(Number(deadline.seconds)).toBeGreaterThanOrEqual(2369);
  state.sent = [];
  state.observed = [];
  for (const run of check!.runs) await processBrowserRun(run.id, c.checkId);
  expect(state.sent).toEqual(questions.flatMap((q) => Array(5).fill(q)));
  expect(state.observed).toEqual(
    Array.from({ length: 25 }, () => [
      "opening",
      "submitting",
      "waiting",
      "collecting",
    ]).flat(),
  );
  const result = await getCheck(c.checkId);
  expect(result?.status).toBe("completed");
  expect(
    result?.runs.every(
      (r) =>
        r.status === "ok" &&
        r.phase === "completed" &&
        r.answer_text?.includes(r.prompt_text!),
    ),
  ).toBe(true);
  expect(await usage(owner, "batch-ip")).toBe(4);
});

it("backfills existing single-question links without changing their answers or brand-query label", async () => {
  const owner = randomUUID(),
    site = randomUUID(),
    question = randomUUID(),
    check = randomUUID(),
    run = randomUUID();
  await state.db.query("INSERT INTO visitors(id) VALUES($1)", [owner]);
  await state.db.query(
    "INSERT INTO site_profiles(id,visitor_id,brand,profile) VALUES($1,$2,'{}','{}')",
    [site, owner],
  );
  await state.db.query(
    "INSERT INTO generated_prompts(id,site_profile_id,type,text) VALUES($1,$2,'Custom','Is Demo a useful brand?')",
    [question, site],
  );
  await state.db.query(
    "INSERT INTO checks(id,visitor_id,site_profile_id,prompt_id,prompt_text,brand,selected_providers,estimated_cost,deadline_at,idempotency_key,prompt_bias,status) VALUES($1,$2,$3,$4,'Is Demo a useful brand?','{}','[\"copilot\"]',0,now()+interval '1 hour',$5,true,'completed')",
    [check, owner, site, question, randomUUID()],
  );
  await state.db.query(
    "INSERT INTO llm_runs(id,check_id,provider_id,repeat_index,status,answer_text) VALUES($1,$2,'copilot',0,'ok','Original captured answer.')",
    [run, check],
  );
  await state.db.exec(readFileSync("db/001.sql", "utf8"));
  const result = await getCheck(check);
  expect(result?.prompts).toEqual([]);
  expect(result?.runs[0]).toMatchObject({
    prompt_text: "Is Demo a useful brand?",
    prompt_bias: true,
    phase: "completed",
    answer_text: "Original captured answer.",
  });
});

it("all five real job-handler failures complete the batch and refund it without scores", async () => {
  const owner = randomUUID(),
    site = randomUUID();
  await state.db.query("INSERT INTO visitors(id) VALUES($1)", [owner]);
  await state.db.query(
    "INSERT INTO site_profiles(id,visitor_id,brand,profile) VALUES($1,$2,$3,'{}')",
    [
      site,
      owner,
      JSON.stringify({
        name: "Failure fixture",
        domain: "fixture.test",
        aliases: [],
      }),
    ],
  );
  const created = await createCheck(owner, "failure-fixture-ip", {
    ...input(),
    profileId: site,
    providers: ["gemini"],
  });
  state.failCapture = true;
  try {
    for (const run of (await getCheck(created.checkId))!.runs)
      await processBrowserRun(run.id, created.checkId);
  } finally {
    state.failCapture = false;
  }
  const check = (await getCheck(created.checkId))!;
  expect(check.status).toBe("completed");
  expect(check.refunded).toBe(true);
  expect(check.runs).toHaveLength(5);
  expect(
    check.runs.every(
      (r) =>
        r.status === "timeout" &&
        r.phase === "failed" &&
        !r.answer_text &&
        !r.analysis,
    ),
  ).toBe(true);
  expect(await usage(owner, "failure-fixture-ip")).toBe(5);
});
