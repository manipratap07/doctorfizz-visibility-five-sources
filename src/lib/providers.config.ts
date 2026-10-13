export const definitions = [
  ["chatgpt", "ChatGPT", "https://chatgpt.com/"],
  ["gemini", "Gemini", "https://gemini.google.com/"],
  ["copilot", "Microsoft Copilot", "https://copilot.microsoft.com/"],
  ["google-ai", "Google AI Mode", "https://www.google.com/ai"],
  ["duckai", "Duck.ai", "https://duck.ai/"],
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
    webSearch: id !== "duckai",
    costUsd: 0,
    timeoutMs: 90000,
    maxConcurrency: 1,
    enabled: !(process.env.BROWSER_DISABLED_PROVIDERS || "")
      .split(",")
      .map((value) => value.trim())
      .includes(id),
  }));
}
export const publicProviders = definitions.map(([id, displayName]) => ({
  id,
  displayName,
  tier: "Browser",
  webSearch: id !== "duckai",
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
export const checkDeadlineSeconds = (runCount = 25) => runCount * 90 + 120;
