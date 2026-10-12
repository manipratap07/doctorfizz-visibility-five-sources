import { providers } from "../providers.config";
import { runBrowser } from "../../worker/browser-adapter";
import type { ProviderAdapter } from "./contract";
export function getAdapter(id: string): ProviderAdapter {
  if (!providers().some((p) => p.id === id && p.enabled))
    throw new Error("Unknown or disabled browser provider.");
  return { id, run: (input) => runBrowser(id, input) };
}
