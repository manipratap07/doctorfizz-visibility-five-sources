import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { browserTargets } from "./browser.config";
import { collectOnPage, sessionBarrier } from "./browser-adapter";
import { launchContext, egressIp } from "./launch";

// Operator-only diagnostic. No login, cookies, headers or private API replay.
async function main() {
  const id =
    process.argv.find((a) => a.startsWith("--provider="))?.slice(11) ||
    "gemini";
  const target = browserTargets[id];
  if (!target)
    throw new Error(
      "Unknown provider. Use chatgpt, gemini or google-ai.",
    );
  const directory = join("internal-debug", id + "-" + Date.now());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Same browser, profile style and proxy route as production runs.
  const context = await launchContext(id);
  const exitIp = await egressIp(context).catch((e) => "unknown: " + e.message);
  const failures: { url: string; status?: number; error?: string }[] = [];
  const safeUrl = (raw: string) => {
    const u = new URL(raw);
    return u.origin + u.pathname;
  };
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("response", (r) => {
      if (r.status() >= 400)
        failures.push({ url: safeUrl(r.url()), status: r.status() });
    });
    page.on("requestfailed", (r) =>
      failures.push({ url: safeUrl(r.url()), error: r.failure()?.errorText }),
    );
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(8000);
    const barrier = await sessionBarrier(page, target.answer);
    const result =
      process.argv.includes("--submit") && !barrier
        ? await collectOnPage(page, target, {
            prompt:
              "What are three project management tools for a small business? Explain your choices.",
            signal: AbortSignal.timeout(90000),
            deadlineAt: Date.now() + 90000,
            onProgress: async (phase, message) => {
              console.log(JSON.stringify({ provider: id, phase, message }));
            },
          })
        : undefined;
    const report = {
      provider: id,
      egressIp: exitIp,
      pageUrl: page.url(),
      title: await page.title(),
      barrier,
      result,
      visibleText: (await page.locator("body").innerText()).slice(0, 20000),
      inputs: await page
        .locator('textarea,input,[contenteditable="true"],[role="textbox"]')
        .evaluateAll((ns) =>
          ns.map((n) => ({
            tag: n.tagName,
            id: n.id,
            role: n.getAttribute("role"),
            label: n.getAttribute("aria-label"),
            placeholder: n.getAttribute("placeholder"),
            visible: (n as HTMLElement).getClientRects().length > 0,
          })),
        ),
      buttons: await page
        .locator("button")
        .evaluateAll((ns) =>
          ns.map((n) => ({
            text: n.textContent?.trim(),
            label: n.getAttribute("aria-label"),
            title: n.getAttribute("title"),
            testId: n.getAttribute("data-test-id"),
          })),
        ),
      answerRoots: await page.locator(target.answer).count(),
      failures,
    };
    await writeFile(
      join(directory, "report.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    await writeFile(join(directory, "page.html"), await page.content(), {
      mode: 0o600,
    });
    await page.screenshot({
      path: join(directory, "page.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        provider: id,
        status: result?.status || barrier?.status || "inspection_only",
        directory,
        egressIp: exitIp,
        title: report.title,
        answerRoots: report.answerRoots,
        failures,
      }),
    );
  } finally {
    await context.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
