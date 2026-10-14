import { chromium, type BrowserContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One launch path for production runs, probe and inspect, so diagnostics see
// exactly the browser fingerprint and network route that real checks use.

export function proxyFromEnv(session = randomBytes(6).toString("hex")) {
  const raw = process.env.RESIDENTIAL_PROXY_URL?.trim();
  if (!raw) {
    if (process.env.REQUIRE_PROXY === "true")
      throw new Error(
        "RESIDENTIAL_PROXY_URL is empty but REQUIRE_PROXY=true; refusing to browse from the VPS datacenter IP.",
      );
    return undefined;
  }
  // "{session}" in the URL becomes a fresh sticky-session id per browser run, so
  // the exit IP stays the same for the whole conversation but changes between runs.
  // Gateways are often written as host:port or user:pass@host:port; without a
  // scheme, URL parsing would drop the port or credentials.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "http://" + raw;
  // Accept the placeholder written plainly or URL-encoded (%7Bsession%7D);
  // otherwise every run would reuse one literal "{session}" id and one IP.
  const placeholder = /\{session\}|%7Bsession%7D/gi;
  if (process.env.REQUIRE_PROXY === "true" && !placeholder.test(raw))
    throw new Error(
      "RESIDENTIAL_PROXY_URL must contain {session} in the username so each run gets its own sticky exit IP.",
    );
  let u: URL;
  try {
    u = new URL(withScheme.replace(placeholder, session));
  } catch {
    u = new URL("invalid://");
  }
  if (!/^(https?|socks[45]?):$/.test(u.protocol) || !u.hostname)
    throw new Error(
      "RESIDENTIAL_PROXY_URL must look like http://user:pass@host:port.",
    );
  if (u.protocol.startsWith("socks") && u.username)
    throw new Error(
      "Chromium cannot authenticate to SOCKS proxies. Use the provider's http:// gateway URL.",
    );
  return {
    server: `${u.protocol}//${u.host}`,
    ...(u.username
      ? {
          username: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
        }
      : {}),
  };
}

const profileRoot = () =>
  process.env.BROWSER_PROFILE_DIR || join(tmpdir(), "doctorfizz-profiles");

// Every run gets a throwaway Chrome profile that is deleted when the context
// closes: no user's questions or history stay on disk, no device identity is
// shared between users, and no profile lock can outlive a killed container.
export async function launchContext(
  id: string,
  proxyArgs: string[] = [],
): Promise<BrowserContext> {
  await mkdir(profileRoot(), { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(profileRoot(), `${id}-`));
  const remove = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    const proxy = proxyFromEnv();
    // Real Chrome, headed on the Xvfb display, and no user-agent override:
    // every fingerprint surface reports the same browser.
    const context = await chromium.launchPersistentContext(dir, {
      channel: process.env.BROWSER_EXECUTABLE_PATH
        ? undefined
        : process.env.BROWSER_CHANNEL || "chrome",
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      headless: process.env.BROWSER_HEADLESS === "true",
      timeout: 30000,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--window-size=1366,900",
        // WebRTC/STUN is UDP and bypasses an HTTP proxy, which would reveal
        // the VPS address to the page; keep it inside the proxy.
        ...(proxy
          ? ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", ...proxyArgs]
          : []),
        // Operator extras, e.g. "--window-position=-2400,0" to keep a headed
        // window off-screen on a desktop machine.
        ...(process.env.BROWSER_ARGS || "").split(/\s+/).filter(Boolean),
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      viewport: { width: 1366, height: 820 },
      locale: process.env.BROWSER_LOCALE || "en-IN",
      timezoneId:
        process.env.BROWSER_TIMEZONE ||
        process.env.BROWSER_TIMEZONE_ID ||
        "Asia/Kolkata",
      proxy,
    });
    context.once("close", () => void remove());
    return context;
  } catch (e) {
    await remove();
    throw e;
  }
}

// Deletes profiles left behind when the worker or Chrome was killed mid-run.
// Runs last at most ~90 s, so anything older than the cutoff is abandoned.
export async function sweepProfiles(maxAgeMs = 60 * 60 * 1000) {
  const root = profileRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const path = join(root, e.name);
        const info = await stat(path).catch(() => null);
        if (info && Date.now() - info.mtimeMs > maxAgeMs)
          await rm(path, { recursive: true, force: true }).catch(() => {});
      }),
  );
}

export async function egressIp(context: BrowserContext) {
  const r = await context.request.get("https://api.ipify.org?format=json", {
    timeout: 15000,
  });
  return ((await r.json()) as { ip: string }).ip;
}
