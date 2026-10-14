import { createHash } from "node:crypto";
import { runtimeInfo } from "./runtime-info";
import { providers } from "../lib/providers.config";
import { query } from "../lib/db";
import { getAdapter } from "../lib/provider-adapters";
import { analyze } from "../lib/analysis";
import { extract } from "../lib/intelligence";
import { finish } from "../lib/checks";
import type { Brand } from "../lib/types";
export async function processBrowserRun(runId: string, checkId: string) {
  const [row] = await query<{
    prompt_text: string;
    brand: Brand;
    deadline_at: string;
    status: string;
    provider_id: string;
  }>(
    "SELECT coalesce(r.prompt_text,c.prompt_text) prompt_text,c.brand,c.deadline_at,r.status,r.provider_id FROM checks c JOIN llm_runs r ON r.check_id=c.id WHERE r.id=$1",
    [runId],
  );
  if (!row || !["queued", "running"].includes(row.status)) return;
  const p = providers().find((p) => p.id === row.provider_id && p.enabled);
  if (!p) throw new Error("Browser provider is disabled.");
  const remaining = new Date(row.deadline_at).getTime() - Date.now();
  if (remaining <= 0) {
    await finish(checkId, true);
    return;
  }
  await query(
    "UPDATE llm_runs SET status='running',phase='opening',phase_message='Starting a fresh browser session.',phase_updated_at=now() WHERE id=$1 AND status='queued'",
    [runId],
  );
  await query(
    "UPDATE checks SET status='running' WHERE id=$1 AND status='queued'",
    [checkId],
  );
  const context = {
    ...runtimeInfo(),
    runId,
    checkId,
    provider: p.id,
    promptHash: createHash("sha256")
      .update(row.prompt_text)
      .digest("hex")
      .slice(0, 16),
  };
  console.log(
    JSON.stringify({
      event: "browser_run_started",
      ...context,
      timeoutMs: Math.min(p.timeoutMs, remaining),
    }),
  );
  const result = await getAdapter(p.id).run({
    prompt: row.prompt_text,
    signal: AbortSignal.timeout(Math.min(p.timeoutMs, remaining)),
    onObservation: async (diagnostics) => {
      console.log(
        JSON.stringify({
          event: "browser_capture_observation",
          ...context,
          diagnostics,
        }),
      );
    },
    onProgress: async (phase, message, url) => {
      console.log(
        JSON.stringify({ event: "browser_run_progress", ...context, phase }),
      );
      await query(
        "UPDATE llm_runs SET phase=$2,phase_message=$3,source_url=coalesce($4,source_url),phase_updated_at=now() WHERE id=$1 AND status='running'",
        [runId, phase, message, url || null],
      );
    },
  });
  console.log(
    JSON.stringify({
      event: "browser_run_finished",
      ...context,
      status: result.status,
      reason: result.errorReason,
      latencyMs: result.latencyMs,
      diagnostics: result.diagnostics,
    }),
  );
  if (result.status === "ok")
    await query(
      "UPDATE llm_runs SET phase='analysing',phase_message='Saving browser evidence and checking brand mentions.',phase_updated_at=now() WHERE id=$1 AND status='running'",
      [runId],
    );
  const analysis =
    result.status === "ok"
      ? analyze(
          result.answerText!,
          result.citations || [],
          row.brand,
          await extract(result.answerText!),
        )
      : null;
  await query(
    "UPDATE llm_runs SET status=$2,reason=$3,answer_text=$4,citations=$5,model_reported=$6,web_search_used=$7,latency_ms=$8,from_cache=false,analysis=$9,browser_evidence=$10,phase=$11,phase_message=$12,phase_updated_at=now(),completed_at=now() WHERE id=$1 AND status IN ('queued','running')",
    [
      runId,
      result.status,
      result.errorReason || null,
      result.answerText || null,
      JSON.stringify(result.citations || []),
      result.modelReported || null,
      result.webSearchUsed,
      result.latencyMs,
      analysis,
      result.browserEvidence || {},
      result.status === "ok" ? "completed" : "failed",
      result.status === "ok"
        ? "Answer and evidence saved."
        : result.errorReason ||
          "This source did not return a completed answer.",
    ],
  );
  await query(
    "INSERT INTO browser_provider_health(provider_id,status,reason,checked_at) VALUES($1,$2,$3,now()) ON CONFLICT(provider_id) DO UPDATE SET status=$2,reason=$3,checked_at=now()",
    [
      p.id,
      result.status === "ok" ? "ready" : result.status,
      result.errorReason || null,
    ],
  );
  await finish(checkId);
}
