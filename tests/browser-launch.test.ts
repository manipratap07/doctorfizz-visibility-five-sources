import { afterEach, expect, it, vi } from "vitest";
import { proxyForProvider } from "../src/worker/browser-launch";
afterEach(() => vi.unstubAllEnvs());
it("does not proxy Gemini merely because a proxy credential exists", () => {
  vi.stubEnv("PROXY_PROVIDERS", "chatgpt, copilot");
  vi.stubEnv("RESIDENTIAL_PROXY_URL", "http://user:secret@proxy.example:823");
  expect(proxyForProvider("gemini")).toBeUndefined();
  expect(proxyForProvider("copilot")).toEqual({
    server: "http://proxy.example:823",
    username: "user",
    password: "secret",
  });
});
it("separates and decodes credentials and preserves the session suffix", () => {
  vi.stubEnv("PROXY_PROVIDERS", " chatgpt ");
  vi.stubEnv(
    "RESIDENTIAL_PROXY_URL",
    "http://user%3Bsessid.df1:pass%40word@proxy.example:823",
  );
  expect(proxyForProvider("chatgpt")).toEqual({
    server: "http://proxy.example:823",
    username: "user;sessid.df1",
    password: "pass@word",
  });
});
it("empty provider list disables all proxy routing", () => {
  vi.stubEnv("PROXY_PROVIDERS", "");
  vi.stubEnv("RESIDENTIAL_PROXY_URL", "http://user:secret@proxy.example:823");
  expect(proxyForProvider("chatgpt")).toBeUndefined();
});
it("rejects invalid configuration without exposing credentials", () => {
  vi.stubEnv("PROXY_PROVIDERS", "gemini");
  vi.stubEnv("RESIDENTIAL_PROXY_URL", "not-a-url-secret");
  expect(() => proxyForProvider("gemini")).toThrow(
    /^Invalid proxy configuration/,
  );
  vi.stubEnv("RESIDENTIAL_PROXY_URL", "");
  expect(() => proxyForProvider("gemini")).toThrow("no proxy URL configured");
});
