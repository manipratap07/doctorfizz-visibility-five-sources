import { chromium } from "@playwright/test";
import { browserTargets } from "./browser.config";
import { sessionBarrier, runBrowser } from "./browser-adapter";
import { query, pool } from "../lib/db";
async function main() {
  const submit = process.argv.includes("--submit");
  const requested = process.argv
    .find((a) => a.startsWith("--provider="))
    ?.split("=")[1];
  if (requested && !browserTargets[requested])
    throw new Error(
      "Unknown provider. Use chatgpt, gemini, copilot, google-ai or duckai.",
    );
  for (const [id, target] of Object.entries(browserTargets).filter(
    ([id]) => !requested || requested === id,
  )) {
    let status = "error",
      reason = "",
      evidence;
    if (submit) {
      const r = await runBrowser(id, {
        prompt:
          "What are three project management tools for a small business? Explain your choices.",
        signal: AbortSignal.timeout(90000),
      });
      status = r.status === "ok" ? "ready" : r.status;
      reason = r.errorReason || "";
      evidence = r.browserEvidence;
    } else {
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      });
      try {
        const page = await browser.newPage();
        await page.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page
          .locator(target.input)
          .filter({ visible: true })
          .first()
          .waitFor({ state: "visible", timeout: 12000 })
          .catch(() => {});
        const barrier = await sessionBarrier(page, target.answer);
        status =
          barrier?.status ||
          ((await page
            .locator(target.input)
            .filter({ visible: true })
            .first()
            .isVisible()
            .catch(() => false))
            ? "input_found"
            : "blocked");
        reason =
          barrier?.reason ||
          (status === "input_found"
            ? "Input found; completed answer capture has not been verified."
            : `No chat input found at ${page.url()}. Inspect the live page before changing selectors.`);
      } catch (e) {
        reason = (e as Error).message.split("\n")[0];
      } finally {
        await browser.close();
      }
    }
    console.log(JSON.stringify({ provider: id, status, reason, evidence }));
    // Only a successful full answer probe establishes ready status.
    await query(
      "INSERT INTO browser_provider_health(provider_id,status,reason,checked_at) VALUES($1,$2,$3,now()) ON CONFLICT(provider_id) DO UPDATE SET status=$2,reason=$3,checked_at=now()",
      [id, status, reason],
    ).catch(() => {});
    if (status !== "ready" && submit) process.exitCode = 1;
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
