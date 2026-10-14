import { isIP } from "node:net";
import { query } from "./db";
import { BACKEND_CONTRACT, getPublicProviders } from "./providers.config";

function backend() {
  if (!process.env.BACKEND_URL) return null;
  const url = new URL(process.env.BACKEND_URL);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("BACKEND_URL must be an origin without a path.");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("BACKEND_URL must use HTTPS.");
  if (
    !process.env.BACKEND_SHARED_SECRET ||
    process.env.BACKEND_SHARED_SECRET.length < 32
  )
    throw new Error("Backend authentication is not configured.");
  return url;
}

/** Same-origin browser API, relayed only to the operator's fixed HTTPS backend. */
export async function relay(req: Request): Promise<Response | null> {
  if (!process.env.BACKEND_URL) return null;
  try {
    const target = backend()!;
    const incoming = new URL(req.url);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers({
      "x-doctorfizz-backend-key": process.env.BACKEND_SHARED_SECRET!,
    });
    for (const name of [
      "cookie",
      "content-type",
      "origin",
      "sec-fetch-site",
      "accept",
    ]) {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Vercel overwrites this header. Never use a browser-supplied custom IP header.
    const ip =
      process.env.VERCEL === "1"
        ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
        : process.env.NODE_ENV !== "production"
          ? "127.0.0.1"
          : null;
    if (!ip || !isIP(ip))
      throw new Error("Trusted frontend IP is unavailable.");
    headers.set("x-doctorfizz-proxy-ip", ip);
    let body: string | undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (Number(req.headers.get("content-length") || 0) > 16384)
        return Response.json({ error: "Request too large." }, { status: 413 });
      body = await req.text();
      if (Buffer.byteLength(body) > 16384)
        return Response.json({ error: "Request too large." }, { status: 413 });
    }
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(25000)]),
    });
    const out = new Headers({ "Cache-Control": "no-store" });
    for (const name of [
      "content-type",
      "content-disposition",
      "x-accel-buffering",
    ])
      if (upstream.headers.has(name))
        out.set(name, upstream.headers.get(name)!);
    for (const cookie of upstream.headers.getSetCookie())
      out.append("set-cookie", cookie);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: out,
    });
  } catch {
    return Response.json(
      { error: "The check service is unavailable. Please try again shortly." },
      { status: 503 },
    );
  }
}

export async function getToolConfig() {
  const target = backend();
  if (target) {
    try {
      target.pathname = "/api/config";
      const r = await fetch(target, {
        headers: {
          "x-doctorfizz-backend-key": process.env.BACKEND_SHARED_SECRET!,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!r.ok)
        throw new Error("The check service configuration is unavailable.");
      const remote = (await r.json()) as {
        providers: ReturnType<typeof getPublicProviders>;
        turnstileKey: string;
        contract?: number;
      };
      if (!Array.isArray(remote?.providers))
        throw new Error("The check service configuration is malformed.");
      // An older VPS still lists these source ids but rejects this frontend's
      // batches, so a contract mismatch disables every source.
      const stale = remote.contract !== BACKEND_CONTRACT;
      return {
        providers: getPublicProviders().map((p) => {
          const upstream = stale
            ? undefined
            : remote.providers.find((h) => h.id === p.id);
          return upstream
            ? { ...p, ...upstream, displayName: p.displayName }
            : {
                ...p,
                enabled: false,
                configured: false,
                readiness: "backend_update_required",
                reason: "Update the VPS to v1.6 before testing this source.",
              };
        }),
        turnstileKey: remote.turnstileKey,
      };
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "backend_config_failed",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      return {
        providers: getPublicProviders().map((p) => ({
          ...p,
          enabled: false,
          readiness: "backend_unavailable",
          reason:
            "The check service is temporarily unavailable. Please try again shortly.",
        })),
        turnstileKey: "",
      };
    }
  }
  const publicList = getPublicProviders();
  try {
    const health = process.env.DATABASE_URL
      ? await query<{
          provider_id: string;
          status: string;
          reason: string;
          checked_at: string;
        }>(
          "SELECT * FROM browser_provider_health WHERE checked_at>now()-interval '24 hours'",
        )
      : [];
    for (const p of publicList) {
      const h = health.find((h) => h.provider_id === p.id);
      if (h) {
        p.readiness = h.status;
        p.reason = h.reason || "Last browser capture succeeded.";
      }
    }
  } catch {
    /* Before migration/build, expose unknown readiness rather than a false success. */
  }
  return {
    providers: publicList,
    contract: BACKEND_CONTRACT,
    turnstileKey:
      process.env.TURNSTILE_REQUIRED === "true"
        ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
          process.env.TURNSTILE_SITE_KEY ||
          ""
        : "",
  };
}
