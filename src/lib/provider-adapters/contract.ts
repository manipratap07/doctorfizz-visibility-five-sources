import type { ProviderResult, BrowserInput } from "../types";
export interface ProviderAdapter {
  id: string;
  run(input: BrowserInput): Promise<ProviderResult>;
}
