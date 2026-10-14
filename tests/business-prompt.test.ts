import { expect, it } from "vitest";
import { resolveBusinessPrompt } from "../src/lib/business-prompt";
const brand = { name: "Itzfizz", domain: "itzfizz.com", aliases: [] };

it("resolves the reported we-ranking question with the company and domain", () => {
  const question = "where we rank in the it feild in bengaluru";
  const resolved = resolveBusinessPrompt(question, brand);
  expect(resolved.text).toContain("Itzfizz (itzfizz.com)");
  expect(resolved.text).toContain("Question: " + question);
  expect(resolved.text).toContain("Do not invent a numeric rank");
  expect(resolved.originalText).toBe(question);
  expect(resolved.contextApplied).toBe(true);
});

it("keeps unbranded discovery independent of the selected business", () => {
  for (const question of [
    "Which SEO agencies are recommended in Bengaluru?",
    "Tell us the best website builders for a small business.",
    "What software should I use for my small business?",
  ])
    expect(resolveBusinessPrompt(question, brand)).toEqual({ text: question });
});

it("resolves explicit company references without assuming every my business is the target", () => {
  for (const question of [
    "Is our company mentioned among Bengaluru agencies?",
    "What services does my website provide?",
    "Compare us with other IT agencies in Bengaluru.",
  ])
    expect(resolveBusinessPrompt(question, brand).contextApplied).toBe(true);
});

it("leaves questions that already name the brand unchanged", () => {
  const brand = { name: "Itzfizz", domain: "itzfizz.com", aliases: [] };
  expect(resolveBusinessPrompt("How can Itzfizz help my business?", brand)).toEqual({
    text: "How can Itzfizz help my business?",
  });
});
