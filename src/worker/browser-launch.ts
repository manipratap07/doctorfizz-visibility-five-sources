import { chromium, type Browser, type Page } from "@playwright/test";
import { browserConfig } from "./browser.config";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

type StorageState = Exclude<
  NonNullable<Parameters<Browser["newContext"]>[0]>["storageState"],
  string | undefined
>;

/** Login is explicit and provider-specific; missing selected sessions fail closed. */
export function storageStateForProvider(id: string): StorageState | undefined {
  if (!/^(chatgpt|gemini|copilot|google-ai|duckai)$/.test(id))
    throw new Error("Unknown browser provider.");
  const selected = (process.env.BROWSER_SESSION_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim());
  if (!selected.includes(id)) return undefined;
  const profileDir = process.env.BROWSER_PROFILE_DIR;
  if (profileDir) {
    try {
      const saved = JSON.parse(
        readFileSync(join(profileDir, id + ".json"), "utf8"),
      );
      if (Array.isArray(saved.cookies) && Array.isArray(saved.origins))
        return saved;
    } catch {
      // A missing runtime profile may be initialized from the authorised login state.
    }
  }
  try {
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
  const required = process.env.REQUIRE_PROXY === "true";
  const selected = (process.env.PROXY_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!required && !selected.length) return undefined;
  if (selected.length && !selected.includes(id)) {
    if (required)
      throw new Error(
        "Proxy is required for this provider but it is not selected.",
      );
    return undefined;
  }
  const raw = process.env.RESIDENTIAL_PROXY_URL?.trim();
  if (!raw && required)
    throw new Error("A selected proxy provider has no proxy URL configured.");
  if (!raw) return undefined;
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
    if (required && !url.username) throw new Error();
    const session = randomBytes(8).toString("hex");
    const username = decodeURIComponent(url.username).replaceAll(
      "{session}",
      session,
    );
    if (required && !decodeURIComponent(url.username).includes("{session}"))
      throw new Error();
    return {
      server: `${url.protocol}//${url.host}`,
      ...(url.username
        ? {
            username,
            password: decodeURIComponent(url.password),
          }
        : {}),
    };
  } catch {
    throw new Error(
      "Invalid proxy configuration. Use an HTTP(S) origin with URL-encoded credentials and {session} in the username when REQUIRE_PROXY=true.",
    );
  }
}

async function checkEgress(page: Page, id: string, required: boolean) {
  try {
    const check = await page.context().newPage();
    try {
      const response = await check.goto("https://api.ipify.org?format=json", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      if (!response?.ok()) throw new Error();
      const observed = JSON.parse(await check.locator("body").innerText()).ip;
      if (typeof observed !== "string" || !/^[a-f0-9:.]+$/i.test(observed))
        throw new Error();
      console.log(
        JSON.stringify({ event: "browser_egress", provider: id, ip: observed }),
      );
      if (required && observed === process.env.VPS_PUBLIC_IP)
        throw new Error("Proxy exit IP matches the configured VPS address.");
    } finally {
      await check.close();
    }
  } catch {
    if (required)
      throw new Error(
        "Proxy exit could not be verified, or it matched the VPS address.",
      );
    console.warn(
      JSON.stringify({ event: "browser_egress_unverified", provider: id }),
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
    if (process.env.REQUIRE_PROXY === "true" && !process.env.VPS_PUBLIC_IP)
      throw new Error("VPS_PUBLIC_IP is required for proxy exit verification.");
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
        locale: process.env.BROWSER_LOCALE || "en-IN",
        timezoneId: process.env.BROWSER_TIMEZONE_ID || "Asia/Kolkata",
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
    const page = await context.newPage();
    await checkEgress(page, id, process.env.REQUIRE_PROXY === "true");
    const result = await task(page);
    if (
      process.env.BROWSER_PROFILE_DIR &&
      (process.env.BROWSER_SESSION_PROVIDERS || "")
        .split(",")
        .map((value) => value.trim())
        .includes(id) &&
      typeof result === "object" &&
      result !== null &&
      "status" in result &&
      result.status === "ok"
    ) {
      const dir = process.env.BROWSER_PROFILE_DIR;
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const output = join(dir, id + ".json");
      const temp = join(
        dir,
        id + "." + randomBytes(6).toString("hex") + ".tmp",
      );
      await writeFile(
        temp,
        JSON.stringify(await context.storageState({ indexedDB: true })),
        { mode: 0o600 },
      );
      await rename(temp, output);
    }
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    await browser?.close().catch(() => {});
  }
}
