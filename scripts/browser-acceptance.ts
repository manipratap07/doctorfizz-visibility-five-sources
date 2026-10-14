/** Real API -> database -> Redis -> worker -> provider -> result acceptance.
 * Run on the VPS after deploy. No mocked answers and no quota reset.
 * --frontend routes through APP_URL/Vercel; default checks the internal web service.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runtimeInfo } from "../src/worker/runtime-info";
import { definitions, checkDeadlineSeconds } from "../src/lib/providers.config";
import type { Check } from "../src/lib/types";
import { resolveBusinessPrompt } from "../src/lib/business-prompt";

const arg = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
async function main() {
  const frontend = process.argv.includes("--frontend");
  const provider = arg("provider") || "gemini";
  if (!definitions.some(([id]) => id === provider))
    throw new Error("Unknown provider.");
  if (process.env.TURNSTILE_REQUIRED === "true")
    throw new Error(
      "Bot verification is enabled: use the normal website flow for acceptance.",
    );
  const origin = new URL(process.env.APP_URL || "").origin;
  const base = frontend ? origin : "http://web:3000";
  if (frontend && !origin.startsWith("https://"))
    throw new Error("Frontend acceptance requires the HTTPS APP_URL.");
  const prompts: string[] = arg("prompts")
    ? JSON.parse(readFileSync(arg("prompts")!, "utf8"))
    : [
        "Which agencies offer SEO services for small businesses in Bengaluru?",
        "What should a small business compare when choosing an SEO agency?",
      ];
  if (
    !Array.isArray(prompts) ||
    prompts.length < 2 ||
    prompts.length > 5 ||
    prompts.some(
      (p) => typeof p !== "string" || p.trim().length < 8 || p.length > 1000,
    )
  )
    throw new Error(
      "Provide a JSON array with two to five questions of 8–1,000 characters.",
    );
  let cookie = "";
  async function request(path: string, data?: unknown) {
    const headers: Record<string, string> = {
      origin,
      accept: "application/json",
    };
    if (!frontend) {
      const secret = process.env.BACKEND_SHARED_SECRET;
      if (!secret || secret.length < 32)
        throw new Error("Backend secret is not configured.");
      headers["x-doctorfizz-backend-key"] = secret;
      headers["x-doctorfizz-proxy-ip"] = "127.0.0.1";
    }
    if (cookie) headers.cookie = cookie;
    if (data) headers["content-type"] = "application/json";
    const response = await fetch(base + path, {
      method: data ? "POST" : "GET",
      headers,
      body: data ? JSON.stringify(data) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const nextCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("df_visitor="));
    if (nextCookie) cookie = nextCookie.split(";")[0];
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        `HTTP ${response.status}: ${body.error || body.status || "API request failed"}`,
      );
    return body;
  }
  const health = await request("/api/health");
  const runtime = runtimeInfo();
  console.log(
    JSON.stringify({
      event: "acceptance_target",
      route: frontend ? "Vercel frontend" : "VPS API",
      ...runtime,
      backend: health,
    }),
  );
  if (
    health.release !== "1.6.0" ||
    health.workers?.length !== 1 ||
    !health.workers[0].name?.endsWith(":w:doctorfizz-" + runtime.sourceHash)
  )
    throw new Error(
      "Backend/worker mismatch. Confirm routing and the running image before sending a batch; do not stop unrelated containers.",
    );
  const profile = await request("/api/site/analyze", {
    name: arg("brand") || "Itzfizz",
    url: arg("site") || "https://itzfizz.com",
    aliases: [],
    location: "Bengaluru",
  });
  const created = await request("/api/checks", {
    profileId: profile.profileId,
    prompts,
    providers: [provider],
    turnstileToken: "",
    idempotencyKey: randomUUID(),
  });
  console.log(
    JSON.stringify({
      event: "acceptance_created",
      checkId: created.checkId,
      provider,
      viewUrl: origin + "/?check=" + created.checkId,
    }),
  );
  const deadline =
    Date.now() + (checkDeadlineSeconds(prompts.length) + 30) * 1000;
  let previous = "";
  while (Date.now() < deadline) {
    const check = (await request("/api/checks/" + created.checkId)) as Check;
    const state = check.runs.map((r) => ({
      question: (r.prompt_index ?? 0) + 1,
      status: r.status,
      phase: r.phase,
      reason: r.reason,
    }));
    const signature = JSON.stringify(state);
    if (signature !== previous)
      console.log(
        JSON.stringify({
          event: "acceptance_progress",
          checkId: check.id,
          runs: state,
        }),
      );
    previous = signature;
    if (check.status === "completed") {
      const valid =
        check.runs.length === prompts.length &&
        check.runs.every(
          (r) =>
            r.provider_id === provider &&
            r.prompt_text ===
              resolveBusinessPrompt(
                prompts[r.prompt_index ?? -1] || "",
                profile.brand,
              ).text &&
            r.status === "ok" &&
            !!r.analysis &&
            !!r.answer_text &&
            r.browser_evidence?.captureMethod === "visible_dom" &&
            r.browser_evidence.adapterVersion === runtime.adapterVersion &&
            r.browser_evidence.answerHash ===
              createHash("sha256").update(r.answer_text).digest("hex"),
        );
      console.log(
        JSON.stringify({
          event: "acceptance_result",
          passed: valid,
          checkId: check.id,
          captured: check.runs.filter((r) => r.status === "ok").length,
          expected: prompts.length,
          refunded: check.refunded,
          runs: state,
        }),
      );
      if (!valid) process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Acceptance polling exceeded the batch deadline.");
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "acceptance_failed",
      reason: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
