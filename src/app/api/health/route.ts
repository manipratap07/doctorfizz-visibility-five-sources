export const runtime = "nodejs";
export const maxDuration = 30;
import { relay } from "@/lib/backend";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { hostname } from "node:os";
import { redis, providerQueue } from "@/lib/redis";
import { workerIdentity } from "@/lib/worker-identity";
export async function GET(req: Request) {
  const forwarded = await relay(req);
  if (forwarded) return forwarded;
  try {
    await query("SELECT 1");
    await redis().ping();
    const queue = providerQueue("browser");
    try {
      const workers = (await queue.getWorkers()).map(workerIdentity);
      return NextResponse.json(
        {
          status: workers.length ? "ready" : "not_ready",
          service: "doctorfizz-llm-visibility",
          release: "1.5.2",
          instance: hostname(),
          workers,
        },
        { status: workers.length ? 200 : 503 },
      );
    } finally {
      await queue.close();
    }
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
