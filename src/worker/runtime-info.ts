import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
export const ADAPTER_VERSION = "browser-1.5.1";
let cached: {
  adapterVersion: string;
  sourceHash: string;
  instance: string;
  node: string;
};
export function runtimeInfo() {
  if (cached) return cached;
  const hash = createHash("sha256");
  for (const path of [
    "src/worker/browser-adapter.ts",
    "src/worker/browser-launch.ts",
    "src/worker/browser.config.ts",
    "src/worker/process-run.ts",
    "src/worker/index.ts",
    "src/lib/providers.config.ts",
    "package-lock.json",
  ]) {
    hash.update(path);
    hash.update(readFileSync(path));
  }
  return (cached = {
    adapterVersion: ADAPTER_VERSION,
    sourceHash: hash.digest("hex").slice(0, 16),
    instance: hostname(),
    node: process.version,
  });
}
