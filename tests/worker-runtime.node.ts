// Intentionally run with node --import tsx, the worker's actual transformer.
// Playwright's test runner transforms functions differently and missed __name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
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
      assert.equal(result.browserEvidence?.adapterVersion, "browser-1.5.1");
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
