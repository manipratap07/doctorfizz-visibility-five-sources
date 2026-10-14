import { describe, expect, it } from "vitest";
import { toCitations } from "../src/worker/citations";

const link = (url: string, title = "") => ({ url, title });

describe("toCitations", () => {
  it("drops the provider's own pages, including other subdomains", () => {
    const out = toCitations(
      [
        link("https://policies.google.com/privacy", "Privacy"),
        link("https://support.google.com/legal/answer/3110420", "Legal"),
        link("https://www.infosys.com/services", "Infosys"),
      ],
      "https://www.google.com/ai",
      ["google.com", "gstatic.com"],
    );
    expect(out.map((c) => c.domain)).toEqual(["www.infosys.com"]);
  });

  it("unwraps Google redirect links before filtering", () => {
    const out = toCitations(
      [
        link("https://www.google.com/url?q=https://www.wipro.com/about/&sa=U"),
        link("https://www.google.com/url?q=https://support.google.com/x"),
      ],
      "https://gemini.google.com/",
      ["google.com"],
    );
    expect(out.map((c) => c.url)).toEqual(["https://www.wipro.com/about/"]);
  });

  it("falls back to the provider URL's domain when ownDomains is not set", () => {
    const out = toCitations(
      [link("https://help.chatgpt.com/x"), link("https://example.org/a")],
      "https://chatgpt.com/",
    );
    expect(out.map((c) => c.domain)).toEqual(["example.org"]);
  });

  it("de-duplicates by URL without fragment and rejects non-web or credentialed links", () => {
    const out = toCitations(
      [
        link("https://example.org/a#one"),
        link("https://example.org/a#two"),
        link("mailto:hi@example.org"),
        link("https://user:pw@example.org/b"),
        link("not a url"),
      ],
      "https://chatgpt.com/",
    );
    expect(out.map((c) => c.url)).toEqual(["https://example.org/a"]);
  });
});
