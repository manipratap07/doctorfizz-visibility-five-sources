import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
const g = globalThis as unknown as { dfPool?: Pool };
const created = !g.dfPool;
export const pool =
  g.dfPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_SIZE || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
// An idle client dropped by a Postgres restart is emitted here; without a
// listener the error is uncaught and kills the process. pg-pool has already
// discarded the client, so the next query reconnects.
if (created)
  pool.on("error", (e) =>
    console.error(
      JSON.stringify({ event: "pg_idle_client_error", message: e.message }),
    ),
  );
if (process.env.NODE_ENV !== "production") g.dfPool = pool;
export const db = drizzle(pool);
export async function query<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  return (await pool.query(sql, args)).rows;
}
