export const runtime = "nodejs";
export const maxDuration = 30;
import { relay } from "@/lib/backend";
import { getCheck } from "@/lib/checks";
import { error } from "@/lib/http";
import { rateLimit } from "@/lib/limits";
const cell = (v: unknown) =>
  '"' +
  String(v ?? "")
    .replace(/^[=+@-]/, "'")
    .replace(/"/g, '""') +
  '"';
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const forwarded = await relay(req);
  if (forwarded) return forwarded;
  try {
    await rateLimit("export", 20);
    const c = await getCheck((await params).id);
    if (!c) return new Response("Check not found", { status: 404 });
    const rows = [
      [
        "prompt_number",
        "provider",
        "status",
        "reason",
        "mentioned",
        "position",
        "total_entities",
        "cited",
        "sentiment",
        "snippet",
        "competitors",
        "model_reported",
        "web_search_used",
        "cache",
        "captured",
        "raw_answer",
        "page_url",
        "answer_sha256",
        "prompt",
        "prompt_kind",
        "direct_brand_query",
      ],
      ...c.runs.map((r) => [
        (r.prompt_index ?? 0) + 1,
        r.provider_id,
        r.status,
        r.reason,
        r.analysis?.mentioned,
        r.analysis?.position,
        r.analysis?.totalEntities,
        r.analysis?.cited,
        r.analysis?.sentiment,
        r.analysis?.snippet,
        r.analysis?.competitors.map((e) => e.name).join("; "),
        r.model_reported,
        r.web_search_used,
        r.from_cache,
        r.completed_at,
        r.answer_text,
        r.browser_evidence?.pageUrl,
        r.browser_evidence?.answerHash,
        r.prompt_text || c.prompt_text,
        c.prompt_kind,
        r.prompt_bias ?? c.prompt_bias,
      ]),
    ];
    return new Response(
      rows.map((row) => row.map(cell).join(",")).join("\r\n"),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="doctorfizz-visibility.csv"',
        },
      },
    );
  } catch (e) {
    return error(e);
  }
}
