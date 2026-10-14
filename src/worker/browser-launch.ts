import { chromium, type Browser, type Page } from "@playwright/test";
import { browserConfig } from "./browser.config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type StorageState = Exclude<
  NonNullable<Parameters<Browser["newContext"]>[0]>["storageState"],
  string | undefined
>;

/** Login is explicit and provider-specific; missing selected sessions fail closed. */
export function storageStateForProvider(id: string): StorageState | undefined {
  const selected = (process.env.BROWSER_SESSION_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim());
  if (!selected.includes(id)) return undefined;
  try {
    if (!/^(chatgpt|gemini|copilot|google-ai|duckai)$/.test(id))
      throw new Error();
    const directory =
      process.env.BROWSER_STORAGE_STATE_DIR || "browser-sessions";
    const state = JSON.parse(
      readFileSync(join(directory, id + ".json"), "utf8"),
    );
    if (!Array.isArray(state.cookies) || !Array.isArray(state.origins))
      throw new Error();
    return state;
  } catch {
    throw new Error(
      "The selected browser session could not be loaded. Complete browser:login and check session-file permissions.",
    );
  }
}

/** Credentials must be separate from the proxy server; never log the raw URL. */
export function proxyForProvider(id: string) {
  const selected = (process.env.PROXY_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!selected.includes(id)) return undefined;
  const raw = process.env.RESIDENTIAL_PROXY_URL?.trim();
  if (!raw)
    throw new Error("A selected proxy provider has no proxy URL configured.");
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return {
      server: `${url.protocol}//${url.host}`,
      ...(url.username
        ? {
            username: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
          }
        : {}),
    };
  } catch {
    throw new Error(
      "Invalid proxy configuration. Use an HTTP(S) origin with URL-encoded credentials.",
    );
  }
}

/** Production, probe and inspect share exactly the same launch/context settings. */
export async function withBrowserPage<T>(
  id: string,
  signal: AbortSignal,
  task: (page: Page) => Promise<T>,
): Promise<T> {
  let browser: Browser | undefined;
  const abort = () => {
    void browser?.close().catch(() => {});
  };
  signal.throwIfAborted();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const proxy = proxyForProvider(id);
    const storageState = storageStateForProvider(id);
    browser = await chromium.launch({
      headless: browserConfig.headless,
      timeout: 15000,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      args: browserConfig.args,
    });
    signal.throwIfAborted();
    const context = await browser
      .newContext({
        locale: "en-US",
        viewport: browserConfig.viewport,
        proxy,
        storageState,
        // Keep the user agent and browser APIs consistent with installed Chromium.
      })
      .catch((error) => {
        if (storageState)
          throw new Error(
            "Saved browser session could not be applied. Sign in again.",
          );
        throw error;
      });
    signal.throwIfAborted();
    return await task(await context.newPage());
  } finally {
    signal.removeEventListener("abort", abort);
    await browser?.close().catch(() => {});
  }
}
