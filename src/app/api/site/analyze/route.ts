import { relay } from "@/lib/backend";
import { randomUUID } from "node:crypto";
import { body, error } from "@/lib/http";
import { analyzeSchema } from "@/lib/schemas";
import { visitor } from "@/lib/identity";
import { rateLimit } from "@/lib/limits";
import { validateUrl } from "@/lib/security";
import { query } from "@/lib/db";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: Request) {
  const forwarded = await relay(req);
  if (forwarded) return forwarded;
  try {
    const data = analyzeSchema.parse(await body(req));
    await rateLimit("analyze", 6);
    const owner = await visitor();
    if (!data.url && data.name.trim().length < 2)
      throw new Error("Enter a website or business name.");
    const u = data.url ? validateUrl(data.url) : null;
    const brand = {
      name: data.name.trim() || u!.hostname.replace(/^www\./, ""),
      domain: u ? u.hostname.replace(/^www\./, "") : "",
      aliases: data.aliases,
    };
    const profile = {
      category: "User questions",
      subCategory: "",
      primaryOffering: "",
      targetAudience: "",
      isLocalBusiness: !!data.location,
      location: data.location,
      language: "User supplied",
      confidence: 0,
    };
    const profileId = randomUUID();
    await query(
      "INSERT INTO site_profiles(id,visitor_id,brand,profile) VALUES($1,$2,$3,$4)",
      [profileId, owner, brand, profile],
    );
    return Response.json({ profileId, brand, profile });
  } catch (e) {
    return error(e);
  }
}
