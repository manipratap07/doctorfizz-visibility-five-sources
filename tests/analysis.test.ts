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
  it("matches a CamelCase or legal-suffix brand written as separate words", () => {
    const a = analyze(
      "1. Big Basket: grocery delivery\n2. Blinkit: quick commerce",
      [],
      { name: "BigBasket", domain: "bigbasket.com", aliases: [] },
    );
    expect(a.mentioned).toBe(true);
    expect(a.position).toBe(1);
    expect(a.competitors.map((e) => e.name)).toEqual(["Blinkit"]);
    for (const [name, domain, text] of [
      ["MakeMyTrip", "makemytrip.com", "Try Make My Trip for flights."],
      ["DigitalOcean", "digitalocean.com", "Digital Ocean is simple."],
      ["Acme Cloud Pvt Ltd", "acmecloud.com", "Acme Cloud is fast."],
      ["Acme Cloud, Inc.", "acmecloud.com", "Acme Cloud is fast."],
      ["Procter & Gamble Co", "pg.com", "Procter & Gamble makes soap."],
      ["Ernst & Young LLP", "ey.com", "Ernst & Young audits."],
    ])
      expect(analyze(text, [], { name, domain, aliases: [] }).mentioned).toBe(
        true,
      );
  });
  it("does not match derived brand forms against ordinary prose", () => {
    for (const [name, domain, text] of [
      [
        "NoBroker",
        "nobroker.in",
        "No broker fees apply, and there is no broker.",
      ],
      ["OneCard", "getonecard.app", "Use one card for everything."],
      ["eBay", "ebay.com", "Pick e Bay or another."],
      ["Apple Inc", "apple.com", "Apple pie is tasty."],
    ])
      expect(analyze(text, [], { name, domain, aliases: [] }).mentioned).toBe(
        false,
      );
    expect(
      analyze("No Broker lists rentals.", [], {
        name: "NoBroker",
        domain: "nobroker.in",
        aliases: [],
      }).mentioned,
    ).toBe(true);
  });
  it("guards every common-word alias, not only the exact name", () => {
    const monday = { name: "monday.com", domain: "monday.com", aliases: [] };
    expect(
      analyze("Support is open Monday to Friday.", [], monday).mentioned,
    ).toBe(false);
    expect(
      analyze("I ate an apple today.", [], {
        name: "Apple Inc",
        domain: "apple.com",
        aliases: [],
      }).mentioned,
    ).toBe(false);
    expect(
      analyze("Follow a linear process.", [], {
        name: "linear.app",
        domain: "linear.app",
        aliases: [],
      }).mentioned,
    ).toBe(false);
    const a = analyze(
      "Open Monday to Friday. Try monday.com for planning.",
      [],
      monday,
    );
    expect(a.mentioned).toBe(true);
    expect(a.ambiguous).toBe(true);
    expect(a.snippet).toBe("Try monday.com for planning.");
    expect(
      analyze(
        "Plan on Monday.",
        [{ url: "https://monday.com/", domain: "monday.com" }],
        monday,
      ).mentioned,
    ).toBe(true);
  });
  it("ignores numbered criteria lists when ranking recommendations", () => {
    const a = analyze(
      "Consider:\n1. Price\n2. Support\n3. Uptime\nTop providers:\n1. Acme Cloud: fast\n2. Other Host: ok",
      [],
      brand,
    );
    expect(a.position).toBe(1);
    expect(a.totalEntities).toBe(2);
    expect(a.score).toBe(82);
    expect(a.competitors.map((e) => e.name)).toEqual(["Other Host"]);
  });
  it("ranks labelled bullets only when there is no numbered list", () => {
    const a = analyze(
      "- Notion: all-in-one workspace\n- Obsidian: local notes",
      [],
      { name: "Notion", domain: "notion.so", aliases: [] },
    );
    expect(a.mentioned).toBe(true);
    expect(a.position).toBe(1);
    expect(a.competitors.map((e) => e.name)).toEqual(["Obsidian"]);
    expect(
      fallbackEntities(
        "- **Notion**: notes\n- Obsidian — local\n* Logseq – outliner",
      ).map((e) => [e.name, e.position]),
    ).toEqual([
      ["Notion", 1],
      ["Obsidian", 2],
      ["Logseq", 3],
    ]);
    expect(
      fallbackEntities(
        "- Your budget\n- **Team size** matters\n- Best for: small teams\n- Price: $10",
      ),
    ).toHaveLength(0);
    expect(
      fallbackEntities(
        "1. Acme Cloud: fast\n- Best for: teams\n- Notion: notes\n2. Other Host: ok",
      ).map((e) => [e.name, e.position]),
    ).toEqual([
      ["Acme Cloud", 1],
      ["Other Host", 2],
    ]);
  });
  it("ranks the pick named after a quick-picks slot label, not the label", () => {
    const a = analyze(
      "- Best overall: Notion\n- Best for privacy: Obsidian\n- Best free option: Logseq",
      [],
      { name: "Notion", domain: "notion.so", aliases: [] },
    );
    expect(a.mentioned).toBe(true);
    expect(a.position).toBe(1);
    expect(a.score).toBe(82);
    expect(a.competitors.map((e) => e.name)).toEqual(["Obsidian", "Logseq"]);
    const b = analyze(
      "- Best overall: Acme Cloud\n- Best budget pick: Other Host",
      [],
      brand,
    );
    expect(b.position).toBe(1);
    expect(b.competitors.map((e) => e.name)).toEqual(["Other Host"]);
    expect(
      fallbackEntities(
        "- **Best overall:** [monday.com](https://monday.com) — boards\n- **Top pick** – Asana (paid)\n- Best for: small teams",
      ).map((e) => e.name),
    ).toEqual(["monday.com", "Asana"]);
    expect(
      fallbackEntities(
        "1. Best overall: Notion\n2. Best for privacy: Obsidian\n3. Best for small teams",
      ).map((e) => [e.name, e.position]),
    ).toEqual([
      ["Notion", 1],
      ["Obsidian", 2],
    ]);
    expect(
      analyze("- Best Buy: electronics", [], {
        name: "Best Buy",
        domain: "bestbuy.com",
        aliases: [],
      }).position,
    ).toBe(1);
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
