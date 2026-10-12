import { Worker } from "bullmq";
import pino from "pino";
import { redis, providerQueue } from "../lib/redis";
import { query, pool } from "../lib/db";
import { processBrowserRun } from "./process-run";
import { finish, enqueue } from "../lib/checks";
const log = pino({ redact: ["key", "token", "ip"] });
const workers: Worker[] = [];
async function startup() {
  const q = providerQueue("browser");
  await q.setGlobalConcurrency(1);
  await q.close();
  const worker = new Worker(
    "browser-provider",
    async (job) => {
      await processBrowserRun(job.data.runId, job.data.checkId);
    },
    { connection: redis(), concurrency: 1 },
  );
  worker.on("failed", async (job, error) => {
    log.error({ event: "browser_job_failed", message: error.message });
    if (job) {
      await query(
        "UPDATE llm_runs SET status='error',phase='failed',phase_message='Browser worker failed.',reason='Browser worker failed.',phase_updated_at=now(),completed_at=now() WHERE id=$1 AND status IN ('queued','running')",
        [job.data.runId],
      );
      await finish(job.data.checkId);
    }
  });
  workers.push(worker);
  const deadline = new Worker(
    "deadlines",
    async (job) => {
      await finish(job.data.checkId, true);
    },
    { connection: redis(), concurrency: 10 },
  );
  workers.push(deadline);
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      const old = await query<{ id: string }>(
        "SELECT id FROM checks WHERE status!='completed' AND deadline_at<now()",
      );
      for (const c of old) await finish(c.id, true);
      const pending = await query<{ id: string }>(
        "SELECT DISTINCT c.id FROM checks c JOIN llm_runs r ON r.check_id=c.id WHERE c.status!='completed' AND c.deadline_at>now() AND r.status='queued'",
      );
      for (const c of pending) await enqueue(c.id);
      await query(
        "DELETE FROM intelligence_cost_events WHERE created_at<now()-interval '31 days'",
      );
      await query("DELETE FROM response_cache WHERE expires_at<now()");
      await query(
        "DELETE FROM usage_events WHERE created_at<now()-(($1+1)*interval '1 day')",
        [Number(process.env.WINDOW_DAYS || 30)],
      );
      await query(
        "DELETE FROM checks WHERE created_at<now()-interval '7 days'",
      );
      await query(
        "DELETE FROM generated_prompts WHERE site_profile_id IN (SELECT s.id FROM site_profiles s WHERE s.created_at<now()-interval '31 days' AND NOT EXISTS (SELECT 1 FROM checks c WHERE c.site_profile_id=s.id))",
      );
      await query(
        "DELETE FROM site_profiles s WHERE created_at<now()-interval '31 days' AND NOT EXISTS (SELECT 1 FROM checks c WHERE c.site_profile_id=s.id)",
      );
      await query(
        "DELETE FROM leads WHERE consent_at<now()-interval '90 days'",
      );
      await query(
        "DELETE FROM visitors v WHERE created_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM leads l WHERE l.visitor_id=v.id) AND NOT EXISTS(SELECT 1 FROM site_profiles s WHERE s.visitor_id=v.id) AND NOT EXISTS(SELECT 1 FROM usage_events u WHERE u.visitor_id=v.id)",
      );
    } catch (e) {
      log.error({ event: "reconcile_failed", message: (e as Error).message });
    } finally {
      reconciling = false;
    }
  };
  await reconcile();
  const timer = setInterval(reconcile, 10000);
  log.info({ event: "worker_ready" });
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, async () => {
      clearInterval(timer);
      await Promise.all(workers.map((w) => w.close()));
      await pool.end();
      await redis().quit();
      process.exit(0);
    });
}
startup().catch((e) => {
  log.error({ event: "startup_failed", message: e.message });
  process.exit(1);
});
