import { createHmac } from "node:crypto";

// usage_events.domain holds a keyed hash of the brand (domain, or "brand:<name>"),
// so the per-brand daily cap still works after "delete my data" without
// keeping the brand readable for the 31-day retention.
export const hashBrandKey = (raw: string, salt: string) =>
  createHmac("sha256", salt).update(raw).digest("hex");

export function brandSalt() {
  const salt = process.env.IP_HASH_SALT;
  if (!salt || salt.length < 32)
    throw new Error("IP_HASH_SALT must have at least 32 characters.");
  return salt;
}

// Rows written before v1.6 stored the plaintext key; hash them in place.
// Already-hashed rows (64 hex characters) are skipped, so this is repeatable.
export async function hashLegacyUsageDomains(
  run: (
    sql: string,
    args?: unknown[],
  ) => Promise<{ rows: { id: string; domain: string }[] }>,
  salt: string,
) {
  const { rows } = await run(
    "SELECT id,domain FROM usage_events WHERE domain !~ '^[0-9a-f]{64}$'",
  );
  for (const r of rows)
    await run("UPDATE usage_events SET domain=$1 WHERE id=$2", [
      hashBrandKey(r.domain, salt),
      r.id,
    ]);
  return rows.length;
}
