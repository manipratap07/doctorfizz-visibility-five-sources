import { providers } from "../lib/providers.config";
import { runBrowser } from "./browser-adapter";
export async function healthCheck() {
  const results = [];
  for (const p of providers().filter((p) => p.enabled))
    results.push({
      provider: p.id,
      result: await runBrowser(p.id, {
        prompt:
          "What are three project management tools for a small business? Explain your choices.",
        signal: AbortSignal.timeout(p.timeoutMs),
        deadlineAt: Date.now() + p.timeoutMs,
      }),
    });
  return results;
}
