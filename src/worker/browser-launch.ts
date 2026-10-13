import { chromium, type Browser, type Page } from "@playwright/test";
import { browserConfig } from "./browser.config";

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
    browser = await chromium.launch({
      headless: browserConfig.headless,
      timeout: 15000,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      args: browserConfig.args,
    });
    signal.throwIfAborted();
    const context = await browser.newContext({
      locale: "en-US",
      viewport: browserConfig.viewport,
      proxy,
      // Keep the user agent and browser APIs consistent with installed Chromium.
    });
    signal.throwIfAborted();
    return await task(await context.newPage());
  } finally {
    signal.removeEventListener("abort", abort);
    await browser?.close().catch(() => {});
  }
}
