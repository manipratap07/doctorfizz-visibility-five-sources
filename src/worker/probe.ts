import { browserTargets } from "./browser.config";
import { sessionBarrier, runBrowser } from "./browser-adapter";
import { withBrowserPage } from "./browser-launch";
import { runtimeInfo } from "./runtime-info";
import { query, pool } from "../lib/db";
import { providers } from "../lib/providers.config";

async function main() {
  const submit = process.argv.includes("--submit");
  const requested = process.argv
    .find((a) => a.startsWith("--provider="))
    ?.slice(11);
  const prompt =
    process.argv.find((a) => a.startsWith("--prompt="))?.slice(9) ||
    "What are three project management tools for a small business? Explain your choices.";
  if (requested && !browserTargets[requested])
    throw new Error("Unknown browser provider.");
  for (const [id, target] of Object.entries(browserTargets).filter(
    ([id]) => !requested || requested === id,
  )) {
    let status = "error",
      reason = "",
      evidence,
      diagnostics;
    const timeoutMs = providers().find((p) => p.id === id)!.timeoutMs;
    try {
      if (submit) {
        const result = await runBrowser(id, {
          prompt,
          signal: AbortSignal.timeout(timeoutMs),
          onProgress: async (phase) => {
            console.log(
              JSON.stringify({ event: "probe_progress", provider: id, phase }),
            );
          },
        });
        status = result.status === "ok" ? "ready" : result.status;
        reason = result.errorReason || "";
        evidence = result.browserEvidence;
        diagnostics = result.diagnostics;
      } else {
        await withBrowserPage(
          id,
          AbortSignal.timeout(timeoutMs),
          async (page) => {
            await page.goto(target.url, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
            await page
              .locator(target.input)
              .filter({ visible: true })
              .first()
              .waitFor({ state: "visible", timeout: 12000 })
              .catch(() => {});
            const barrier = await sessionBarrier(page, target.answer);
            const found = await page
              .locator(target.input)
              .filter({ visible: true })
              .first()
              .isVisible();
            status = barrier?.status || (found ? "input_found" : "blocked");
            reason =
              barrier?.reason ||
              (found
                ? "Input found; completed answer capture has not been verified."
                : "No chat input found. Inspect the live page before changing selectors.");
          },
        );
      }
    } catch {
      reason =
        "Browser inspection failed. Check the launch configuration and network.";
    }
    console.log(
      JSON.stringify({
        event: "probe_result",
        ...runtimeInfo(),
        provider: id,
        status,
        reason,
        evidence,
        diagnostics,
      }),
    );
    // An inspection must not erase evidence of a previously completed probe.
    if (submit && process.env.DATABASE_URL) {
      await query(
        "INSERT INTO browser_provider_health(provider_id,status,reason,checked_at) VALUES($1,$2,$3,now()) ON CONFLICT(provider_id) DO UPDATE SET status=$2,reason=$3,checked_at=now()",
        [id, status, reason],
      ).catch(() =>
        console.error(
          JSON.stringify({ event: "probe_health_save_failed", provider: id }),
        ),
      );
    }
    if (status !== "ready" && submit) process.exitCode = 1;
  }
}
main()
  .catch(() => {
    console.error(
      "Probe failed. Check the provider name and runtime configuration.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
