import { readFileSync } from "node:fs";
import { pool } from "../lib/db";
import { hashLegacyUsageDomains } from "../lib/brand-key";
async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(readFileSync("db/001.sql", "utf8"));
    const salt = process.env.IP_HASH_SALT;
    if (salt && salt.length >= 32)
      await hashLegacyUsageDomains((sql, args) => c.query(sql, args), salt);
    else
      console.warn(
        "IP_HASH_SALT missing or short: older usage_events rows were left unhashed.",
      );
    await c.query("COMMIT");
    console.log("Schema ready.");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
