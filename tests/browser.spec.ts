import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { collectOnPage, sessionBarrier } from "../src/worker/browser-adapter";
import { analyze } from "../src/lib/analysis";
import type { BrowserTarget } from "../src/worker/browser.config";
import { browserTargets } from "../src/worker/browser.config";
const target: BrowserTarget = {
  url: "http://127.0.0.1:3000/local-browser-fixture",
  input: "textarea",
  answer: '[data-role="assistant"]',
  completion: 'button[aria-label="Copy"]',
  stop: 'button[aria-label="Stop"]',
};
async function fixture(page: import("@playwright/test").Page, html: string) {
  await page.route("**/local-browser-fixture", (r) =>
    r.fulfill({ contentType: "text/html", body: html }),
  );
}
test("captures only a completed assistant answer, visible ordered recommendations and scoped citations", async ({
  page,
}) => {
  await fixture(
    page,
    `<a href="https://navigation.example">Navigation</a><textarea></textarea>
  <script>document.querySelector('textarea').addEventListener('keydown',e=>{if(e.key==='Enter'){
    const user=document.createElement('div');user.dataset.role='user';user.textContent=e.target.value;document.body.append(user);
    const answer=document.createElement('div');answer.dataset.role='assistant';answer.innerHTML='<ol><li><p><strong>Acme</strong>: helpful accounting software.</p></li><li>Beta: another option.</li></ol><a href="https://acme.com/reviews">Review evidence</a><button aria-label="Copy">Copy</button><span hidden>invisible invented answer</span><a hidden href="https://fake.example">Hidden citation</a>';document.body.append(answer);
  }});</script>`,
  );
  const stages: string[] = [];
  const result = await collectOnPage(page, target, {
    onProgress: async (phase) => {
      stages.push(phase);
    },
    prompt: "Which accounting tools should small businesses consider?",
    signal: AbortSignal.timeout(8000),
  });
  expect(result.status).toBe("ok");
  expect(stages).toEqual([
    "opening",
    "submitting",
    "waiting",
    "collecting",
    "collecting",
  ]);
  expect(await page.locator('[data-role="user"]').innerText()).toBe(
    "Which accounting tools should small businesses consider?",
  );
  expect(result.answerText).toContain("1. Acme");
  expect(result.answerText).not.toMatch(
    /Copy|Navigation|invisible|Which accounting/,
  );
  expect(result.citations).toEqual([
    {
      url: "https://acme.com/reviews",
      domain: "acme.com",
      title: "Review evidence",
    },
  ]);
  expect(result.browserEvidence?.answerHash).toBe(
    createHash("sha256").update(result.answerText!).digest("hex"),
  );
  expect(result.browserEvidence?.pageUrl).toBe(target.url);
  expect(result.modelReported).toBeUndefined();
  expect(result.webSearchUsed).toBe(false);
  expect(
    analyze(result.answerText!, result.citations!, {
      name: "Acme",
      aliases: [],
      domain: "acme.com",
    }).position,
  ).toBe(1);
});
test("refuses an existing assistant answer or a echoed prompt", async ({
  page,
}) => {
  await fixture(
    page,
    '<textarea></textarea><div data-role="assistant">An old assistant answer about the wrong business.<button aria-label="Copy">Copy</button></div>',
  );
  const result = await collectOnPage(page, target, {
    prompt: "Which services should I consider?",
    signal: AbortSignal.timeout(1800),
  });
  expect(result.status).toBe("timeout");
  expect(result.answerText).toBeUndefined();
});
test("does not score stable partial text without a completion signal", async ({
  page,
}) => {
  await fixture(
    page,
    `<textarea></textarea><script>document.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'){const d=document.createElement('div');d.dataset.role='assistant';d.textContent='Partial answer that might eventually recommend a brand.';document.body.append(d);}};</script>`,
  );
  const result = await collectOnPage(page, target, {
    prompt: "Which tools are useful?",
    signal: AbortSignal.timeout(4000),
  });
  expect(result.status).toBe("timeout");
  expect(result.browserEvidence).toBeUndefined();
});
test("stops at login, human verification or consent without submitting", async ({
  page,
}) => {
  await fixture(page, "<p>Sign in to continue</p><textarea></textarea>");
  const result = await collectOnPage(page, target, {
    prompt: "Do not submit this.",
    signal: AbortSignal.timeout(3000),
  });
  expect(result.status).toBe("blocked");
  expect(await page.locator("textarea").inputValue()).toBe("");
});
test("returns a free limit failure separately from a completed answer", async ({
  page,
}) => {
  await fixture(page, "<p>Daily limit reached</p><textarea></textarea>");
  const result = await collectOnPage(page, target, {
    prompt: "Do not submit this.",
    signal: AbortSignal.timeout(3000),
  });
  expect(result.status).toBe("rate_limited");
  expect(result.answerText).toBeUndefined();
});
test("challenge phrases inside an answer are not mistaken for a session barrier", async ({
  page,
}) => {
  await fixture(
    page,
    '<div style="display:none">Verify you are human</div><div data-role="assistant">The product can verify you are human.</div><textarea></textarea>',
  );
  await page.goto(target.url);
  expect(await sessionBarrier(page)).toBeNull();
});

test("recognises an empty Cloudflare interstitial by its title", async ({
  page,
}) => {
  await page.setContent("<title>Just a moment...</title><body></body>");
  expect(await sessionBarrier(page)).toMatchObject({
    status: "blocked",
    reason: expect.stringContaining("security verification"),
  });
});
test("allows ordinary terms footers but stops at a blocking consent dialog", async ({
  page,
}) => {
  await page.setContent(
    "<textarea></textarea><p>By clicking 'Ask' you agree to our Privacy Policy and Terms of Service.</p>",
  );
  expect(await sessionBarrier(page)).toBeNull();
  await page.setContent(
    '<div role="dialog">Accept our terms and privacy policy to continue.</div>',
  );
  expect(await sessionBarrier(page)).toMatchObject({
    status: "blocked",
    reason: expect.stringContaining("consent"),
  });
});
test("a provider service failure never becomes an answer", async ({ page }) => {
  await fixture(
    page,
    "<textarea></textarea><p>The service is temporarily unavailable. Please try again later.</p>",
  );
  const result = await collectOnPage(page, target, {
    prompt: "Which tools should a small business consider?",
    signal: AbortSignal.timeout(3000),
  });
  expect(result.status).toBe("error");
  expect(result.answerText).toBeUndefined();
  expect(result.browserEvidence).toBeUndefined();
});
test("Gemini captures scoped response content, source URLs, model label and search activity", async ({
  page,
}) => {
  await fixture(
    page,
    `<rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea>
  <button>Sign in</button><button data-test-id="bard-mode-menu-button">Flash-Lite</button>
  <p>Sign in to connect to Google apps, create images, and more.</p>
  <a href="https://navigation.example">Site navigation</a>
  <script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){
    const response=document.createElement('model-response');response.innerHTML='<message-content>Acme provides reliable business software. <a href="https://acme.com/reviews">Reviews</a></message-content><button aria-label="Copy">Copy</button>';document.body.append(response);
    const promptCopy=document.createElement('button');promptCopy.setAttribute('aria-label','Copy prompt');document.body.append(promptCopy);
    const activity=document.createElement('p');activity.textContent='Searching the web';document.body.append(activity);setTimeout(()=>activity.remove(),1300);
  }};</script>`,
  );
  const result = await collectOnPage(
    page,
    { ...browserTargets.gemini, url: target.url },
    {
      prompt: "Which business tools are useful?",
      signal: AbortSignal.timeout(8000),
    },
  );
  expect(result.status).toBe("ok");
  expect(result.answerText).toBe(
    "Acme provides reliable business software. Reviews",
  );
  expect(result.answerText).not.toMatch(/Sign in|Flash-Lite|Copy|Searching/);
  expect(result.citations).toEqual([
    { url: "https://acme.com/reviews", title: "Reviews", domain: "acme.com" },
  ]);
  expect(result.modelReported).toBe("Flash-Lite");
  expect(result.webSearchUsed).toBe(true);
  expect(result.browserEvidence?.searchObservation).toBe("confirmed");
});
test("Gemini answer prose mentioning service failures is not a service error", async ({
  page,
}) => {
  await page.setContent(
    '<model-response><message-content>The service is temporarily unavailable during scheduled maintenance.</message-content></model-response><rich-textarea><div contenteditable="true"></div></rich-textarea>',
  );
  expect(await sessionBarrier(page, browserTargets.gemini.answer)).toBeNull();
});
test("ChatGPT waits for the new turn's completion marker and ignores the old turn", async ({
  page,
}) => {
  await fixture(
    page,
    `<textarea id="mobile-composer-prompt" name="prompt"></textarea>
    <ol><li data-message-role="assistant" data-message-complete><div data-assistant-markdown-root>Old unrelated response.</div></li></ol>
    <script>document.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'){
    const turn=document.createElement('li');turn.dataset.messageRole='assistant';turn.innerHTML='<div data-assistant-markdown-root>Acme is a useful tool</div>';document.querySelector('ol').append(turn);
    setTimeout(()=>{turn.firstChild.textContent='Acme is a useful tool for business tasks.';},900);
    setTimeout(()=>{turn.setAttribute('data-message-complete','');},2500);
    }};</script>`,
  );
  const started = Date.now();
  const result = await collectOnPage(
    page,
    { ...browserTargets.chatgpt, url: target.url },
    {
      prompt: "Which tools are useful for businesses?",
      signal: AbortSignal.timeout(9000),
    },
  );
  expect(result.status).toBe("ok");
  expect(result.answerText).toBe("Acme is a useful tool for business tasks.");
  expect(result.browserEvidence?.completion).toBe("answer_control");
  expect(Date.now() - started).toBeGreaterThan(2500);
});
test("Google AI Mode is typed into, and captures only the AI answer without map text or Google's own links", async ({
  page,
}) => {
  await fixture(
    page,
    `<textarea name="q"></textarea><div id="search">Ordinary search result mentioning Beta.</div>
    <script>document.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'){
    const root=document.createElement('div');root.dataset.subtree='aimc';
    root.innerHTML='<div data-container-id="main-col"><div role="region" aria-label="Map of tools" data-artifact-type="map">Map data ©2026 <a href="https://www.mapbox.com/about/maps">Terms</a></div><p>Acme helps small businesses. <a href="https://www.google.com/url?q=https://acme.com/">acme.com</a> <a href="https://policies.google.com/privacy">Privacy</a></p></div>';
    document.body.append(root);setTimeout(()=>root.dataset.complete='true',600);
    }};</script>`,
  );
  const result = await collectOnPage(
    page,
    { ...browserTargets["google-ai"], url: target.url },
    {
      prompt: "Which tools help a small business?",
      signal: AbortSignal.timeout(9000),
    },
  );
  expect(result.status).toBe("ok");
  expect(result.answerText).toBe("Acme helps small businesses. acme.com Privacy");
  expect(result.answerText).not.toMatch(/Map data|Ordinary search/);
  expect(result.citations).toEqual([
    { url: "https://acme.com/", title: "acme.com", domain: "acme.com" },
  ]);
});
test("a Cloudflare interstitial that clears by itself is waited out, not reported as blocked", async ({
  page,
}) => {
  await fixture(
    page,
    `<title>Just a moment...</title><p>Checking your browser.</p>
    <script>setTimeout(()=>{document.title='Chat';document.body.innerHTML='<textarea></textarea>';
    document.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'){
      const a=document.createElement('div');a.dataset.role='assistant';a.innerHTML='Acme is recommended for invoicing. <button aria-label="Copy">Copy</button>';document.body.append(a);
    }};},2000);</script>`,
  );
  const result = await collectOnPage(page, target, {
    prompt: "Which invoicing tools are good?",
    signal: AbortSignal.timeout(12000),
  });
  expect(result.status).toBe("ok");
  expect(result.answerText).toBe("Acme is recommended for invoicing.");
});
test("a Cloudflare interstitial that never clears is still reported as blocked", async ({
  page,
}) => {
  await fixture(page, "<title>Just a moment...</title><p>Checking your browser.</p>");
  const result = await collectOnPage(page, target, {
    prompt: "Which invoicing tools are good?",
    signal: AbortSignal.timeout(3000),
  });
  expect(result.status).toBe("blocked");
  expect(result.errorReason).toMatch(/security verification/);
});
test("a question naming a CAPTCHA vendor in the page URL is not mistaken for a challenge", async ({
  page,
}) => {
  await page.route("**/local-browser-fixture**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<textarea></textarea>" }),
  );
  await page.goto(
    "http://127.0.0.1:3000/local-browser-fixture?q=is+hcaptcha.com+better+than+challenges.cloudflare.com",
  );
  expect(await sessionBarrier(page)).toBeNull();
});
