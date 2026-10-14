import type { Analysis, Brand, Citation, Entity } from "./types";
import { getDomainWithoutSuffix } from "tldts";
import { weights } from "./scoring.config";
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function aliases(b: Brand) {
  const root =
    getDomainWithoutSuffix(b.domain, { allowPrivateDomains: true }) || "";
  return [
    ...new Set(
      [
        b.name,
        b.name.replace(/\s+/g, ""),
        b.name.replace(/\s+/g, "-"),
        root,
        ...b.aliases,
      ]
        .map(normalize)
        .filter((x) => x.length > 1),
    ),
  ];
}
export function matches(text: string, values: string[]) {
  const n = " " + normalize(text) + " ";
  return values.some((a) => n.includes(" " + a + " "));
}
const legal =
  /(?:[\s,]+(?:pvt|private|ltd|limited|inc|llc|llp|gmbh|corp|corporation|co)\.?)+\s*$/i;
// "BigBasket" -> "Big Basket", "Acme Cloud Pvt Ltd" -> "Acme Cloud". Only multi-word
// forms, matched case-sensitively as written, so prose like "no broker" cannot match.
function derivedForms(name: string) {
  const bare = name.replace(legal, "").trim();
  return [...new Set([bare, bare.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")])]
    .map((f) => f.split(/\s+/))
    .filter(
      (t) =>
        t.join(" ") !== name.trim() &&
        t.length > 1 &&
        t.every((x) => x.length > 1 || !/[\p{L}\p{N}]/u.test(x)),
    )
    .map(
      (t) =>
        new RegExp(
          "(?<![\\p{L}\\p{N}])" +
            t
              .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join("\\s+") +
            "(?![\\p{L}\\p{N}])",
          "u",
        ),
    );
}
export function brandMatches(text: string, b: Brand, values = aliases(b)) {
  return (
    matches(text, values) ||
    [b.name, ...b.aliases].flatMap(derivedForms).some((r) => r.test(text))
  );
}
const generic =
  /^(?:pros|cons|pros and cons|price|prices|pricing|cost|costs|budget|support|customer support|uptime|reliability|performance|speed|security|scalability|ease of use|integrations?|reviews?|ratings?|location|features|key features|best for|ideal for|why|why it stands out|strengths|weaknesses|benefits|drawbacks|limitations|considerations|key considerations|use cases?|website|overview|summary|conclusion|final thoughts|bottom line|verdict|recommendations?|best options|next steps|how to choose)$/i;
const slot =
  /^(?:best|top|ideal|great|good|perfect)\s+(?:overall|picks?|choice|option|value|alternative|budget|free|paid|premium|for\s+\S)/i;
const unmark = (s: string) =>
  s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*+/g, "");
export function fallbackEntities(text: string): Entity[] {
  const all = text.split("\n").flatMap((line) => {
    const m = line.match(
      /^\s*(?:#{1,6}\s+)?(?:\*\*)?(\d+[.)]|[-*])\s+(?:\*\*)?([^:\n—–]+?)(\*\*|:|\s[—–]\s|$)/,
    );
    if (!m) return [];
    const bullet = !/^\d/.test(m[1]),
      rest = line.slice(m[0].length - m[3].length);
    // a bullet counts only as "Name: description", not as a plain sentence
    if (bullet && !/^(?:\*\*)?(?::|\s[—–]\s)/.test(rest)) return [];
    let name = unmark(m[2]).trim();
    // "- Best overall: Notion" / "1. Best overall: Notion" names its pick after the slot label
    if (slot.test(name))
      name =
        /^\s*(?::|[—–])\s*([^(,;:\n—–]+?)(?:\.?\s*$|[(,;—–]|\.\s|\s-\s)/
          .exec(unmark(rest))?.[1]
          .trim() || "";
    return name &&
      name.length < 90 &&
      name.split(/\s+/).length <= 8 &&
      !generic.test(name) &&
      !/[!?]/.test(name)
      ? [{ name, bullet, snippet: line.trim() }]
      : [];
  });
  // bullets are a fallback for answers with no numbered recommendations
  const numbered = all.filter((e) => !e.bullet);
  return (numbered.length ? numbered : all).map(({ name, snippet }, i) => ({
    name,
    position: i + 1,
    snippet,
    sentiment: "neutral" as const,
  }));
}
export function verifiedEntities(text: string, items: Entity[]) {
  const seen = new Set<string>();
  return items
    .filter(
      (e) =>
        text.includes(e.snippet) &&
        e.snippet.length > 0 &&
        matches(e.snippet, [normalize(e.name)]) &&
        !seen.has(normalize(e.name)) &&
        !!seen.add(normalize(e.name)),
    )
    .sort((a, b) => text.indexOf(a.snippet) - text.indexOf(b.snippet))
    .map((e, i) => ({ ...e, position: e.position === null ? null : i + 1 }));
}
const ambiguous = new Set([
  "apple",
  "notion",
  "linear",
  "buffer",
  "wise",
  "bolt",
  "square",
  "open",
  "next",
  "orange",
  "meta",
  "collective",
  "command",
  "Monday".toLowerCase(),
]);
export function analyze(
  text: string,
  citations: Citation[],
  brand: Brand,
  entities: Entity[] = fallbackEntities(text),
): Analysis {
  const aa = aliases(brand),
    es = verifiedEntities(text, entities);
  const host = brand.domain.toLowerCase().replace(/^www\./, "");
  const urls = citations
    .filter((c) => {
      try {
        const h = new URL(c.url).hostname.replace(/^www\./, "").toLowerCase();
        return h === host || h.endsWith("." + host);
      } catch {
        return false;
      }
    })
    .map((c) => c.url);
  const found = es.find((e) => brandMatches(e.name, brand, aa));
  const weak = aa.filter((a) => ambiguous.has(a));
  const strong = aa.filter((a) => !ambiguous.has(a));
  const isAmbiguous = weak.length > 0;
  const mentioned =
    brandMatches(text, brand, strong) ||
    (matches(text, weak) && (urls.length > 0 || !!found));
  const pos = mentioned ? (found?.position ?? null) : null;
  const sentiment = mentioned ? (found?.sentiment ?? "neutral") : "neutral";
  let snippet = mentioned ? found?.snippet || "" : "";
  if (mentioned && !snippet) {
    const lines = text.split(/(?<=[.!?])\s+|\n/);
    snippet =
      lines.find((l) => brandMatches(l, brand, strong)) ||
      lines.find((l) => brandMatches(l, brand, aa)) ||
      "";
  }
  const score = !mentioned
    ? 0
    : Math.min(
        100,
        weights.mention +
          (pos === null
            ? weights.unordered
            : (weights.positions[pos - 1] ?? weights.lower)) +
          (urls.length ? weights.citation : 0) +
          weights.sentiment[sentiment],
      );
  return {
    mentioned,
    ambiguous: isAmbiguous,
    position: pos,
    totalEntities: es.length,
    cited: urls.length > 0,
    citationUrls: urls,
    sentiment,
    snippet,
    competitors: es.filter((e) => !brandMatches(e.name, brand, aa)),
    score,
  };
}
export function summarize(runs: { status: string; analysis?: Analysis }[]) {
  const ok = runs.filter((r) => r.status === "ok" && r.analysis);
  const score = ok.length
    ? Math.round(ok.reduce((n, r) => n + r.analysis!.score, 0) / ok.length)
    : null;
  return {
    score,
    label:
      score === null
        ? "Unavailable"
        : score >= 70
          ? "Strong"
          : score >= 40
            ? "Moderate"
            : score > 0
              ? "Weak"
              : "Not visible",
    visible: ok.filter((r) => r.analysis!.mentioned).length,
    total: ok.length,
    unavailable: runs.length - ok.length,
  };
}
