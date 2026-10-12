import { providers } from "../src/lib/providers.config";
const frontend = !!process.env.BACKEND_URL;
const required = frontend
  ? ["BACKEND_URL", "BACKEND_SHARED_SECRET"]
  : ["DATABASE_URL", "REDIS_URL", "IP_HASH_SALT", "BACKEND_SHARED_SECRET"];
const missing = required.filter(
  (k) => !process.env[k] || process.env[k]!.startsWith("CHANGE_ME"),
);
for (const k of [
  "BACKEND_SHARED_SECRET",
  ...(!frontend ? ["IP_HASH_SALT"] : []),
])
  if ((process.env[k] || "").length < 32 && !missing.includes(k))
    missing.push(k);
if (missing.length) {
  console.error("Missing/invalid runtime settings: " + missing.join(", "));
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      runtime: frontend ? "frontend" : "VPS",
      providers: providers()
        .filter((p) => p.enabled)
        .map((p) => p.id),
      llmApiCredentialsRequired: false,
      note: "Run browser:probe --submit on VPS to verify live capture.",
    }),
  );
