/** Read-only. Never prints connection URLs, passwords, cookies, prompts or answer text. */
import { runtimeInfo } from "../src/worker/runtime-info";
import { proxyFromEnv } from "../src/worker/launch";
import { providers } from "../src/lib/providers.config";
import { query, pool } from "../src/lib/db";
import { redis, providerQueue } from "../src/lib/redis";
import { workerIdentity } from "../src/lib/worker-identity";
async function main() {
  console.log(
    JSON.stringify({
      event: "runtime",
      ...runtimeInfo(),
      providers: providers().map((p) => ({
        id: p.id,
        enabled: p.enabled,
        timeoutMs: p.timeoutMs,
        proxy: !!proxyFromEnv(),
      })),
    }),
  );
  const queue = providerQueue("browser");
  try {
    console.log(
      JSON.stringify({
        event: "queue",
        workers: (await queue.getWorkers()).map(workerIdentity),
        counts: await queue.getJobCounts(
          "active",
          "waiting",
          "failed",
          "completed",
        ),
      }),
    );
  } finally {
    await queue.close();
  }
  const runs = await query(
    "SELECT r.check_id,r.id AS run_id,r.provider_id,r.prompt_index,r.status,r.phase,r.reason,r.latency_ms,r.browser_evidence->>'adapterVersion' AS adapter_version,r.phase_updated_at FROM llm_runs r ORDER BY r.created_at DESC,r.prompt_index LIMIT 25",
  );
  console.log(JSON.stringify({ event: "recent_runs", runs }));
}
main()
  .catch(() => {
    console.error(
      "Runtime diagnostic failed. Check database/Redis connectivity and proxy configuration.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await redis().quit();
  });
