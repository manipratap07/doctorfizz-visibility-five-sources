import type { Brand } from "./types";
import { brandMatches } from "./analysis";

/** Resolve company references only; do not seed unbranded discovery questions. */
export function resolveBusinessPrompt(question: string, brand: Brand) {
  const text = question.trim();
  const refersToBusiness =
    /\b(?:we|our|ours)\b|\b(?:my|this|the)\s+(?:company|business|brand|website|agency|firm|domain|organisation|organization)\b|\b(?:rank|ranked|ranking|compare|recommend|list|position|mention)\s+us\b|\bwhere\s+(?:do\s+)?us\b/i.test(
      text,
    );
  // A question that already names the brand needs no context, and its "my
  // business" means the asker's business, not the brand ("How can Acme help
  // my business grow?").
  if (!refersToBusiness || !brand.name.trim() || brandMatches(text, brand))
    return { text };
  const business = brand.domain
    ? `${brand.name.trim()} (${brand.domain})`
    : brand.name.trim();
  const ranking = /\brank(?:s|ed|ing)?\b|\bposition\b/i.test(text)
    ? "\nIf no verified market ranking is available, say so. Do not invent a numeric rank or confuse a recommendation-list position with a market ranking."
    : "";
  return {
    text: `Business context: ${business}. Company references such as "we", "our" and "our company" in this question refer to this business.\n\nQuestion: ${text}${ranking}`,
    originalText: text,
    contextApplied: true as const,
  };
}
