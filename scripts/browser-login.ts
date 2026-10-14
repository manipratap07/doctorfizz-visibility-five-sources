import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { browserTargets, browserConfig } from "../src/worker/browser.config";
import { proxyForProvider } from "../src/worker/browser-launch";

/** Interactive, local operator login. Passwords are entered only in the browser. */
async function main() {
  const id =
    process.argv.find((arg) => arg.startsWith("--provider="))?.slice(11) ||
    "gemini";
  const target = browserTargets[id];
  if (!target) throw new Error("Unknown browser provider.");
  if (!process.stdin.isTTY)
    throw new Error(
      "Run browser:login in your local interactive terminal with a desktop browser.",
    );
  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
  });
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const context = await browser.newContext({
      viewport: browserConfig.viewport,
      proxy: proxyForProvider(id),
    });
    const page = await context.newPage();
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await terminal.question(
      "Sign in in the opened browser and complete any verification yourself. Return to the provider's chat page, then press Enter here to save the session. ",
    );
    if (
      page.isClosed() ||
      new URL(page.url()).hostname !== new URL(target.url).hostname
    )
      throw new Error(
        "Return to the provider's chat page before saving the session.",
      );
    const directory =
      process.env.BROWSER_STORAGE_STATE_DIR || "browser-sessions";
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, id + ".json");
    const state = await context.storageState({ indexedDB: true });
    await writeFile(path, JSON.stringify(state), { mode: 0o600 });
    console.log(
      `Session saved to ${path}. This file contains private login state. Transfer it directly to your VPS; do not upload it to chat or Git. Verify access with browser:probe.`,
    );
  } finally {
    terminal.close();
    await browser.close();
  }
}
main().catch(() => {
  console.error(
    "Login session was not saved. Check the browser page, display access and session directory.",
  );
  process.exitCode = 1;
});
