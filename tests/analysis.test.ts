import { describe, it, expect } from "vitest";
import {
  aliases,
  analyze,
  fallbackEntities,
  verifiedEntities,
  summarize,
  matches,
} from "../src/lib/analysis";
import { publicIp, validateUrl } from "../src/lib/security";
const brand = {
  name: "Acme Cloud",
  domain: "acmecloud.com",
  aliases: ["AcmeCloud"],
};
describe("analysis", () => {
  it("normalizes aliases and requires boundaries", () => {
    expect(aliases(brand)).toContain("acmecloud");
    expect(matches("acmecloudish", aliases(brand))).toBe(false);
    expect(matches("Try ACME CLOUD.", aliases(brand))).toBe(true);
  });
  it("requires corroboration for common names", () => {
    expect(
      analyze("I ate an apple today.", [], {
        name: "Apple",
        domain: "apple.com",
        aliases: [],
      }).mentioned,
    ).toBe(false);
    expect(
      analyze("1. Apple: useful devices", [], {
        name: "Apple",
        domain: "apple.com",
        aliases: [],
      }).mentioned,
    ).toBe(true);
  });
  it("drops invented snippets", () => {
    expect(
      verifiedEntities("An exact answer", [
        {
          name: "Acme",
          position: 1,
          snippet: "invented",
          sentiment: "positive",
        },
      ]),
    ).toHaveLength(0);
  });
  it("scores exact ordered recommendation and citation", () => {
    const text = "1. Acme Cloud: useful software";
    const a = analyze(
      text,
      [{ url: "https://www.acmecloud.com/docs", domain: "www.acmecloud.com" }],
      brand,
      [
        {
          name: "Acme Cloud",
          position: 1,
          snippet: text,
          sentiment: "positive",
        },
      ],
    );
    expect(a.score).toBe(100);
    expect(a.position).toBe(1);
    expect(a.cited).toBe(true);
  });
  it("does not count lookalike citation hosts", () => {
    expect(
      analyze(
        "Acme Cloud",
        [
          {
            url: "https://acmecloud.com.evil.test",
            domain: "acmecloud.com.evil.test",
          },
        ],
        brand,
      ).cited,
    ).toBe(false);
  });
  it("keeps a citation-only appearance distinct from a mention", () => {
    const a = analyze(
      "No recommendation.",
      [{ url: "https://acmecloud.com", domain: "acmecloud.com" }],
      brand,
    );
    expect(a.cited).toBe(true);
    expect(a.mentioned).toBe(false);
    expect(a.score).toBe(0);
  });
  it("recognizes numbered Markdown recommendation headings", () => {
    for (const text of [
      "**1. Acme Cloud** — reliable hosting",
      "### 1. Acme Cloud\nUseful hosting",
      "1. **Acme Cloud**: useful hosting",
    ]) {
      expect(analyze(text, [], brand).position).toBe(1);
    }
    expect(
      fallbackEntities("1. Pricing: varies\n2. Key features: good"),
    ).toHaveLength(0);
  });
  it("derives recommendation order from answer evidence rather than extractor order", () => {
    const text = "1. Other: service\n2. Acme Cloud: hosting";
    const a = analyze(text, [], brand, [
      {
        name: "Acme Cloud",
        snippet: "2. Acme Cloud: hosting",
        position: 1,
        sentiment: "neutral",
      },
      {
        name: "Other",
        snippet: "1. Other: service",
        position: 2,
        sentiment: "neutral",
      },
    ]);
    expect(a.position).toBe(2);
  });
  it("excludes failures from denominator", () => {
    expect(
      summarize([
        { status: "ok", analysis: analyze("Acme Cloud", [], brand) },
        { status: "timeout" },
      ]).score,
    ).toBe(52);
    expect(summarize([{ status: "blocked" }]).score).toBeNull();
  });
});
describe("SSRF and prompts", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
    "100.64.0.1",
  ])("blocks %s", (ip) => expect(publicIp(ip)).toBe(false));
  it("permits public IP only", () => expect(publicIp("8.8.8.8")).toBe(true));
  it.each([
    "file:///etc/passwd",
    "http://user:password@example.com",
    "http://example.com:8080",
  ])("rejects unsafe URL %s", (url) =>
    expect(() => validateUrl(url)).toThrow(),
  );

});
it("builds aliases from registrable domains rather than generic subdomains", () => {
  expect(
    aliases({
      name: "Example Brand",
      domain: "help.example.co.uk",
      aliases: [],
    }),
  ).toContain("example");
  expect(
    aliases({
      name: "Example Brand",
      domain: "help.example.co.uk",
      aliases: [],
    }),
  ).not.toContain("help");
});
