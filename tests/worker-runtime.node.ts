// Intentionally run with node --import tsx, the worker's actual transformer.
// Playwright's test runner transforms functions differently and missed __name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBrowserPage } from "../src/worker/browser-launch";
import { browserTargets } from "../src/worker/browser.config";
import {
  collectOnPage,
  readVisibleAnswer,
  runBrowser,
} from "../src/worker/browser-adapter";

function fixture(body: string) {
  return "data:text/html;base64," + Buffer.from(body).toString("base64");
}
const answerPage =
  fixture(`<rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea>
<script>document.querySelector('[contenteditable]').onkeydown = e => {
 if (e.key !== 'Enter') return;
 const answer = document.createElement('model-response');
 const text = document.createElement('message-content');
 text.textContent = 'Fixture response to: ' + e.target.textContent;
 const copy = document.createElement('button'); copy.setAttribute('aria-label','Copy'); copy.textContent='Copy';
 answer.append(text,copy); document.body.append(answer);
};</script>`);
const questions = [
  "where our company ranks in bengaluru",
  "What are three project management tools for a small business? Explain your choices.",
  "Which agencies offer SEO services in Bengaluru?",
  "What should I compare when choosing an SEO agency?",
  "How can Itzfizz help my business?",
];

async function geminiFixture(body: string, timeoutMs = 6000) {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  });
  try {
    return await collectOnPage(
      await browser.newPage(),
      {
        ...browserTargets.gemini,
        url: fixture(body),
        model: undefined,
        search: undefined,
      },
      { prompt: questions[0], signal: AbortSignal.timeout(timeoutMs) },
    );
  } finally {
    await browser.close();
  }
}

test("Gemini completes despite an unrelated Stop reading aloud control", async () => {
  const result =
    await geminiFixture(`<rich-textarea><div contenteditable="true"></div></rich-textarea>
  <button aria-label="Stop reading aloud">Stop audio</button>
  <script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){
    const r=document.createElement('model-response');
    r.innerHTML='<message-content>Acme provides software services for small business teams.</message-content><button aria-label="Copy">Copy</button>';
    document.body.append(r);
  }};</script>`);
  assert.equal(result.status, "ok", JSON.stringify(result));
});

test("Gemini completed text ignores whitespace-only DOM updates", async () => {
  const result =
    await geminiFixture(`<rich-textarea><div contenteditable="true"></div></rich-textarea>
  <script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){
    const r=document.createElement('model-response');
    r.innerHTML='<message-content>Acme provides software services for small business teams.</message-content><button aria-label="Copy">Copy</button>';
    document.body.append(r);let n=0;
    setInterval(()=>r.querySelector('message-content').textContent='Acme provides'+ ' '.repeat(++n)+'software services for small business teams.',250);
  }};</script>`);
  assert.equal(result.status, "ok", JSON.stringify(result));
});

test("Gemini refuses partial content when Copy belongs to an old response", async () => {
  const result = await geminiFixture(
    `<model-response><message-content>An old completed response.</message-content><button aria-label="Copy">Copy</button></model-response>
  <rich-textarea><div contenteditable="true"></div></rich-textarea>
  <script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){
    const r=document.createElement('model-response');r.innerHTML='<message-content>New partial answer with no completion evidence.</message-content>';document.body.append(r);
  }};</script>`,
    4000,
  );
  assert.equal(result.status, "timeout", JSON.stringify(result));
  assert.equal(result.answerText, undefined);
});

test("Gemini refuses a disabled Copy control while response generation continues", async () => {
  const result = await geminiFixture(
    `<rich-textarea><div contenteditable="true"></div></rich-textarea>
  <script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){
    const r=document.createElement('model-response');r.innerHTML='<message-content>New partial answer with a disabled control.</message-content><button aria-label="Copy" disabled>Copy</button>';document.body.append(r);
  }};</script>`,
    4000,
  );
  assert.equal(result.status, "timeout", JSON.stringify(result));
  assert.equal(result.answerText, undefined);
});

test("Gemini refuses enabled Copy while a real generation Stop control remains", async () => {
  const result = await geminiFixture(
    `<rich-textarea><div contenteditable="true"></div></rich-textarea>
  <script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){
    const r=document.createElement('model-response');r.innerHTML='<message-content>A paused partial answer that has not finished generating.</message-content><button aria-label="Copy">Copy</button>';document.body.append(r);
    const stop=document.createElement('button');stop.setAttribute('aria-label','Stop response');stop.textContent='Stop';document.body.append(stop);
  }};</script>`,
    4000,
  );
  assert.equal(result.status, "timeout", JSON.stringify(result));
  assert.equal(result.diagnostics?.generatingNow, true);
  assert.equal(result.diagnostics?.generationControl, "Stop response");
  assert.equal(result.answerText, undefined);
});

test("Gemini waits while the meaning of an answer is still changing", async () => {
  const result = await geminiFixture(
    `<rich-textarea><div contenteditable="true"></div></rich-textarea>
  <script>document.querySelector('[contenteditable]').onkeydown=e=>{if(e.key==='Enter'){
    const r=document.createElement('model-response');r.innerHTML='<message-content>A partial recommendation is still growing.</message-content><button aria-label="Copy">Copy</button>';document.body.append(r);
    setInterval(()=>r.querySelector('message-content').textContent+=' more answer text',250);
  }};</script>`,
    4000,
  );
  assert.equal(result.status, "timeout", JSON.stringify(result));
  assert.equal(result.diagnostics?.stablePolls, 0);
  assert.equal(result.answerText, undefined);
});

test("five fresh browser sessions capture the exact five prompts under tsx", async () => {
  const original = browserTargets.gemini;
  browserTargets.gemini = {
    ...original,
    url: answerPage,
    model: undefined,
    search: undefined,
  };
  try {
    for (const prompt of questions) {
      const phases: string[] = [];
      const result = await runBrowser("gemini", {
        prompt,
        signal: AbortSignal.timeout(15000),
        onProgress: async (phase) => {
          phases.push(phase);
        },
      });
      assert.equal(result.status, "ok", JSON.stringify(result));
      assert.equal(result.answerText, "Fixture response to: " + prompt);
      assert.equal(result.browserEvidence?.adapterVersion, "browser-1.5.2");
      assert.equal(result.browserEvidence?.completion, "answer_control");
      assert.deepEqual(phases, [
        "opening",
        "submitting",
        "waiting",
        "collecting",
        "collecting",
      ]);
    }
  } finally {
    browserTargets.gemini = original;
  }
});

test("capture works without polluting the page with a global __name workaround", async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="answer"><ol start="3"><li>Acme helps teams.</li><li>Beta helps too.</li></ol><button>Copy</button><span hidden>Hidden</span></div>',
    );
    assert.equal(await page.evaluate("typeof window.__name"), "undefined");
    const text = await readVisibleAnswer(page.locator("#answer"));
    assert.match(text, /3\. Acme/);
    assert.match(text, /4\. Beta/);
    assert.doesNotMatch(text, /Hidden|Copy/);
  } finally {
    await browser.close();
  }
});

test("capture programming errors are errors, not silent browser timeouts", async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const target = {
      ...browserTargets.gemini,
      url: answerPage,
      answerText: "[invalid=",
    };
    const result = await collectOnPage(page, target, {
      prompt: questions[0],
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(result.status, "error");
    assert.equal(result.diagnostics?.phase, "waiting");
    assert.equal(result.answerText, undefined);
  } finally {
    await browser.close();
  }
});

test("a pre-aborted session cannot produce an answer", async () => {
  const result = await runBrowser("gemini", {
    prompt: questions[0],
    signal: AbortSignal.abort(),
  });
  assert.equal(result.status, "timeout");
  assert.equal(result.answerText, undefined);
});

test("deadline interrupts a pending navigation and closes the browser", async () => {
  const original = browserTargets.gemini;
  browserTargets.gemini = {
    ...original,
    url: fixture("<textarea></textarea>"),
  };
  const start = Date.now();
  try {
    const result = await runBrowser("gemini", {
      prompt: questions[0],
      signal: AbortSignal.timeout(700),
    });
    assert.equal(result.status, "timeout");
    assert.equal(result.answerText, undefined);
    assert.ok(Date.now() - start < 6000);
  } finally {
    browserTargets.gemini = original;
  }
});

test("explicitly selected saved login state is restored in a fresh worker context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "doctorfizz-session-test-"));
  const previousProviders = process.env.BROWSER_SESSION_PROVIDERS;
  const previousDirectory = process.env.BROWSER_STORAGE_STATE_DIR;
  try {
    await writeFile(
      join(directory, "gemini.json"),
      JSON.stringify({
        cookies: [
          {
            name: "fixture_session",
            value: "fixture-only",
            domain: "session-fixture.test",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
      { mode: 0o600 },
    );
    process.env.BROWSER_SESSION_PROVIDERS = "gemini";
    process.env.BROWSER_STORAGE_STATE_DIR = directory;
    await withBrowserPage("gemini", AbortSignal.timeout(5000), async (page) => {
      const cookies = await page
        .context()
        .cookies("https://session-fixture.test");
      assert.equal(
        cookies.find((cookie) => cookie.name === "fixture_session")?.value,
        "fixture-only",
      );
    });
    await withBrowserPage(
      "copilot",
      AbortSignal.timeout(5000),
      async (page) => {
        assert.equal(
          (await page.context().cookies("https://session-fixture.test")).length,
          0,
        );
      },
    );
  } finally {
    if (previousProviders === undefined)
      delete process.env.BROWSER_SESSION_PROVIDERS;
    else process.env.BROWSER_SESSION_PROVIDERS = previousProviders;
    if (previousDirectory === undefined)
      delete process.env.BROWSER_STORAGE_STATE_DIR;
    else process.env.BROWSER_STORAGE_STATE_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
