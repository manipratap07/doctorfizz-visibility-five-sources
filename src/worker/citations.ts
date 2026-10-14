import { getDomain } from "tldts";
import type { Citation } from "../lib/types";

// Provider redirect wrappers whose real destination sits in a query parameter.
function unwrap(u: URL): URL {
  const domain = getDomain(u.hostname);
  const param =
    domain === "google.com" && u.pathname === "/url"
      ? u.searchParams.get("q") || u.searchParams.get("url")
      : null;
  if (!param) return u;
  try {
    return new URL(param);
  } catch {
    return u;
  }
}

// Turns the visible links of a captured answer into citations: real web
// destinations only, de-duplicated, without the provider's own pages.
export function toCitations(
  links: { url: string; title: string }[],
  providerUrl: string,
  ownDomains?: string[],
): Citation[] {
  const own = new Set(
    ownDomains?.length ? ownDomains : [getDomain(providerUrl) || ""],
  );
  const seen = new Set<string>();
  return links.flatMap((link) => {
    let u: URL;
    try {
      u = unwrap(new URL(link.url));
    } catch {
      return [];
    }
    const domain = getDomain(u.hostname);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      !domain ||
      own.has(domain)
    )
      return [];
    u.hash = "";
    if (seen.has(u.href)) return [];
    seen.add(u.href);
    return [{ url: u.href, title: link.title, domain: u.hostname }];
  });
}
