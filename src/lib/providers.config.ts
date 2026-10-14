// Bump when the frontend/VPS API contract changes (v1.6 = three sources and
// 2–5 questions). A Vercel frontend refuses a VPS reporting a different value.
export const BACKEND_CONTRACT = 2;
export const definitions = [
  ["chatgpt", "ChatGPT", "https://chatgpt.com/"],
  ["gemini", "Gemini", "https://gemini.google.com/"],
  ["google-ai", "Google AI Mode", "https://www.google.com/ai"],
] as const;
export function providers() {
  return definitions.map(([id, displayName, url]) => ({
    id,
    displayName,
    url,
    tier: "Browser",
    adapter: "playwright" as const,
    modelId: "",
    key: "",
    webSearch: true,
    costUsd: 0,
    timeoutMs: 90000,
    maxConcurrency: 1,
    enabled: !(process.env.BROWSER_DISABLED_PROVIDERS || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .includes(id),
  }));
}
export const publicProviders = definitions.map(([id, displayName]) => ({
  id,
  displayName,
  tier: "Browser",
  webSearch: true,
}));
export function getPublicProviders() {
  return providers().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    tier: p.tier,
    enabled: p.enabled,
    configured: true,
    webSearch: p.webSearch,
    readiness: "not_tested",
    reason: "Public browser access must be checked on your VPS.",
  }));
}
export const checkDeadlineSeconds = (runCount = 15) => runCount * 90 + 120;
