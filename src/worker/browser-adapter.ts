import type { BrowserContext, Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProviderResult,
  BrowserInput,
  CaptureDiagnostics,
} from "../lib/types";
import { browserTargets, type BrowserTarget } from "./browser.config";
import { egressIp, launchContext } from "./launch";
import { toCitations } from "./citations";
import { ADAPTER_VERSION } from "./runtime-info";

export const CHALLENGE_REASON =
  "The provider displayed a security verification page; no answer was collected.";

export const SIGNIN_REASON =
  "The provider requires sign-in before this session can continue.";

export const CONSENT_REASON =
  "The provider requires accepting its terms before it answers.";

const CHALLENGE_HOST =
  /(^|\.)(challenges\.cloudflare\.com|hcaptcha\.com|arkoselabs\.com|captcha-delivery\.com)$/i;
function urlParts(raw: string) {
  try {
    const u = new URL(raw);
    return { host: u.hostname, path: u.pathname };
  } catch {
    return { host: "", path: "" };
  }
}
const isChallengePath = (raw: string) =>
  /\/sorry\/|\/cdn-cgi\/challenge-platform\//i.test(urlParts(raw).path);

// Page reads may fail while a provider navigates or re-renders; those are
// retried on the next poll. Anything else (a bad selector, a script error such
// as the old "__name is not defined") is a bug and must surface as an error,
// not be swallowed into a silent timeout.
const TRANSIENT =
  /timeout|execution context was destroyed|frame (?:was|got) detached|not attached to the dom|target page, context or browser has been closed|has been closed|navigat/i;
const soft =
  <T>(fallback: T) =>
  (e: unknown): T => {
    if (TRANSIENT.test(e instanceof Error ? e.message : String(e)))
      return fallback;
    throw e;
  };

const visible = async (page: Page, selector: string) =>
  page
    .locator(selector)
    .filter({ visible: true })
    .first()
    .isVisible()
    .catch(soft(false));

const INTERFACE_TEXT = new Function(
  "body",
  "answerSelector",
  String.raw`
  const skip = 'script,style,noscript,[hidden],[aria-hidden="true"],model-response,user-query,[data-message-author-role],[data-message-role],[data-role="assistant"],[data-role="user"],[data-testid="assistant-message"],[data-testid="answer"],[data-testid="chat-message-assistant"],[data-content="ai-message"]';
  const seen = new Map();
  const shown = (el) => {
    if (seen.has(el)) return seen.get(el);
    let ok;
    if (el.closest(skip) || (answerSelector && el.closest(answerSelector))) ok = false;
    else if (typeof el.checkVisibility === "function")
      ok = el.checkVisibility({ visibilityProperty: true });
    else {
      ok = true;
      for (let e = el; e; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (st.display === "none" || st.visibility === "hidden") { ok = false; break; }
      }
    }
    seen.set(el, ok);
    return ok;
  };
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const parts = [];
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent && shown(parent)) parts.push(walker.currentNode.textContent || "");
  }
  return parts.join(" ");
`,
) as (body: Element, answerSelector: string) => string;

export async function sessionBarrier(
  page: Page,
  answerSelector?: string,
  prompt?: string,
): Promise<{
  status: "blocked" | "rate_limited" | "error";
  reason: string;
} | null> {
  // Only inspect interface text, excluding known assistant/user conversation roots.
  // checkVisibility() replaces a getComputedStyle walk up every ancestor of every
  // text node, which made each poll take seconds on large chat pages.
  const rawInterfaceText = await page
    .locator("body")
    .evaluate(INTERFACE_TEXT, answerSelector || "")
    .catch(() => page.locator("body").innerText().catch(() => ""));
  // The user's own question is echoed on the page; words in it ("rate limit",
  // "sign in to continue") must not read as a provider wall. Text nodes are
  // joined with spaces, so collapse whitespace before matching phrases.
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const asked = prompt ? norm(prompt) : "";
  const interfaceText = asked
    ? norm(rawInterfaceText).split(asked).join(" ")
    : norm(rawInterfaceText);

  if (
    /too many requests|rate limit reached|daily limit reached/i.test(
      interfaceText,
    )
  )
    return {
      status: "rate_limited",
      reason: "The free browser session reached its limit.",
    };

  // Challenge widgets live in cross-origin iframes, so body text never shows them.
  // Only host and path are matched: a Google AI Mode URL carries the user's
  // question in ?q=, which may itself name a CAPTCHA vendor's domain.
  const url = page.url();
  const challengeFrame = page.frames().some((f) => {
    const { host, path } = urlParts(f.url());
    return CHALLENGE_HOST.test(host) || /\/recaptcha\//i.test(path);
  });
  if (challengeFrame || isChallengePath(url))
    return {
      status: "blocked",
      reason: CHALLENGE_REASON,
    };
  if (/^https:\/\/consent\.(google|youtube)\.com\//i.test(url))
    return {
      status: "blocked",
      reason: "The provider requires consent in a blocking dialog.",
    };

  const title = await page.title().catch(() => "");
  if (
    /^just a moment\s*[.!…]*$/i.test(title.trim()) ||
    /performing security verification|verify you are human|verifies you are not a bot|unusual traffic|complete the captcha/i.test(
      interfaceText,
    )
  )
    return {
      status: "blocked",
      reason: CHALLENGE_REASON,
    };

  // Generic phrases only count inside alert/status regions; page-wide matching
  // also hit stale toasts and hidden templates.
  const alerts = (
    await page
      .locator('[role="alert"],[role="alertdialog"],[role="status"],[aria-live="assertive"]')
      .filter({ visible: true })
      .allTextContents()
      .catch(() => [] as string[])
  ).join(" ");
  if (
    /service (?:is )?temporarily unavailable/i.test(
      interfaceText,
    ) ||
    /something went wrong|unable to generate a response/i.test(alerts)
  )
    return {
      status: "error",
      reason:
        "The provider displayed a service error; no answer was collected.",
    };

  // Inline terms card ("By clicking 'Continue' you agree to our Privacy Policy
  // and Terms of Service" + a Continue button) that holds the answer back.
  if (
    /by clicking ['"\u2018\u2019]?continue['"\u2018\u2019]?,? you agree/i.test(interfaceText) &&
    (await visible(page, 'button:has-text("Continue")'))
  )
    return { status: "blocked", reason: CONSENT_REASON };

  // A standard footer such as 'By clicking Ask you agree...' is not a wall.
  // Keep explicit consent dialogs separate; never automatically accept them.
  const dialogs = await page
    .locator('[role="dialog"],dialog[open],[aria-modal="true"]')
    .filter({ visible: true })
    .allTextContents()
    .catch(() => [] as string[]);

  if (
    dialogs.some(
      (t) => /agree|accept/i.test(t) && /terms|privacy|consent/i.test(t),
    )
  )
    return {
      status: "blocked",
      reason: "The provider requires consent in a blocking dialog.",
    };

  if (
    /sign in to continue|log in to continue|sign in to use (?:gemini|chatgpt)|log in to use (?:gemini|chatgpt)/i.test(
      interfaceText,
    )
  )
    return {
      status: "blocked",
      reason: SIGNIN_REASON,
    };

  return null;
}

// Runs inside the page. Kept as plain JavaScript source on purpose: tsx/esbuild
// compiles TypeScript with keepNames, which wraps named inner functions in a
// `__name(...)` helper that does not exist in the browser, so a TS callback
// here threw "ReferenceError: __name is not defined" and every answer read as "".
// new Function keeps the source verbatim; Playwright serialises it via toString().
const READ_VISIBLE_ANSWER = new Function(
  "root",
  String.raw`
  const blocks = new Set(["P","DIV","LI","H1","H2","H3","H4","PRE","UL","OL","BLOCKQUOTE"]);
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (!(node instanceof HTMLElement)) return "";
    if (node.matches('button,input,textarea,script,style,nav,[role="toolbar"],[aria-hidden="true"],[data-artifact-type="map"],[role="region"][aria-label*="map" i]')) return "";
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return "";
    if (node.tagName === "BR") return "\n";
    let text = Array.from(node.childNodes).map(walk).join("");
    if (node.tagName === "LI" && node.parentElement && node.parentElement.tagName === "OL") {
      const siblings = Array.from(node.parentElement.children).filter((n) => n.tagName === "LI");
      const start = Number(node.parentElement.getAttribute("start") || 1);
      text = (Number(node.getAttribute("value")) || start + siblings.indexOf(node)) + ". " + text.trim();
    } else if (node.tagName === "LI" && node.parentElement && node.parentElement.tagName === "UL" && !node.parentElement.closest("li")) {
      // Top-level bullets keep a marker so list items can be recognised as entities.
      text = "- " + text.trim();
    }
    return blocks.has(node.tagName) ? "\n" + text + "\n" : text;
  };
  return walk(root).replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
`,
) as (root: Element) => string;

export async function readVisibleAnswer(
  answer: import("@playwright/test").Locator,
  timeout = 3000,
): Promise<string> {
  return answer.evaluate(READ_VISIBLE_ANSWER, undefined, { timeout });
}

export async function collectOnPage(
  page: Page,
  target: BrowserTarget,
  input: BrowserInput,
): Promise<ProviderResult> {
  const start = Date.now();
  const diagnostics: CaptureDiagnostics = {
    phase: "opening",
    answerRoots: 0,
    answerCharacters: 0,
    completionSeen: false,
    generationSeen: false,
  };
  const failure = (
    status: ProviderResult["status"],
    errorReason: string,
  ): ProviderResult => ({
    status,
    errorReason,
    webSearchUsed: false,
    latencyMs: Date.now() - start,
    diagnostics: { ...diagnostics },
  });

  page.setDefaultTimeout(6000);
  try {
    input.signal.throwIfAborted();
    await input.onProgress?.(
      "opening",
      "Opening the public chat page.",
      target.url,
    );
    await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    let barrier = await sessionBarrier(page, target.answer, input.prompt);
    // Cloudflare's interstitial often passes on its own in a real browser and
    // reloads into the app; give it a moment before reporting a block. Google's
    // /sorry/ page is a CAPTCHA wall that never clears, so it is not waited on.
    // Challenges are never solved, only waited out.
    const graceUntil = Math.min(
      Date.now() + 15000,
      (input.deadlineAt ?? Infinity) - 30000,
    );
    while (
      barrier?.reason === CHALLENGE_REASON &&
      !/\/sorry\//i.test(urlParts(page.url()).path) &&
      Date.now() < graceUntil &&
      !input.signal.aborted
    ) {
      await page.waitForTimeout(1000);
      barrier = await sessionBarrier(page, target.answer, input.prompt);
    }
    if (barrier) return failure(barrier.status, barrier.reason);

    const before = await page
      .locator(target.answer)
      .filter({ visible: true })
      .count();

    const box = page.locator(target.input).filter({ visible: true }).first();
    await box.waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    barrier = await sessionBarrier(page, target.answer, input.prompt);
    if (barrier) return failure(barrier.status, barrier.reason);
    if (!(await box.isVisible()) || !(await box.isEditable()))
      return failure(
        "blocked",
        "No usable public chat input found. Inspect the live page for a sign-in requirement or changed selectors.",
      );

    await input.onProgress?.(
      "submitting",
      "Sending your question.",
      page.url(),
    );
    await box.fill(input.prompt);

    const send = target.submit
      ? page.locator(target.submit).filter({ visible: true }).first()
      : undefined;
    // fill() focused the box. Keyboard Enter avoids locator.press re-resolving
    // a composer that the page swaps out the moment the message is sent,
    // which threw after the question had already gone out.
    if (send && (await send.isEnabled({ timeout: 1500 }).catch(() => false)))
      await send.click({ timeout: 3000 }).catch(() => page.keyboard.press("Enter"));
    else await page.keyboard.press("Enter");

    await input.onProgress?.(
      "waiting",
      "Question sent; waiting for the provider to answer.",
      page.url(),
    );
    diagnostics.phase = "waiting";

    let receivingReported = false;
    let previous = "",
      stable = 0,
      sawGenerating = false,
      searchObserved = false;

    const softDeadline = (input.deadlineAt ?? Infinity) - 2500;
    while (!input.signal.aborted && Date.now() < softDeadline) {
      barrier = await sessionBarrier(page, target.answer, input.prompt);
      if (barrier) return failure(barrier.status, barrier.reason);

      searchObserved ||=
        !!target.search && (await visible(page, target.search));

      const answers = page.locator(target.answer).filter({ visible: true });
      const count = await answers.count();
      const answer = answers.last();
      const contents = target.answerText
        ? answer.locator(target.answerText).filter({ visible: true }).first()
        : answer;

      // Never let one poll block on a text root that has not rendered yet.
      const text =
        count > before &&
        (!target.answerText || (await contents.count().catch(soft(0))) > 0)
          ? await readVisibleAnswer(contents).catch(soft(""))
          : "";

      if (text && !receivingReported) {
        receivingReported = true;
        diagnostics.phase = "collecting";
        await input.onProgress?.(
          "collecting",
          "Receiving answer text from this source.",
          page.url(),
        );
      }

      if (text.length > 60000)
        return failure("error", "The answer exceeded the capture limit.");

      const generating = await visible(page, target.stop);
      sawGenerating ||= generating;

      // Copy control must belong to the captured answer, not an old answer/page header.
      const controls =
        target.completionScope === "page"
          ? page
          : target.completionAncestor
            ? answer.locator(target.completionAncestor)
            : answer;

      // A disabled control (e.g. Copy greyed out while streaming) is not completion.
      const control = controls
        .locator(target.completion)
        .filter({ visible: true })
        .first();
      const complete =
        count > before &&
        (await control.isVisible().catch(soft(false))) &&
        (await control.isEnabled({ timeout: 500 }).catch(soft(false)));

      // Whitespace-only re-renders do not count as the answer still changing.
      const settled = text.replace(/\s+/g, " ").trim();
      stable = settled && settled === previous && !generating ? stable + 1 : 0;
      previous = settled;
      Object.assign(diagnostics, {
        answerRoots: count,
        answerCharacters: text.length,
        completionSeen: diagnostics.completionSeen || complete,
        generationSeen: sawGenerating,
        generatingNow: generating,
        stablePolls: stable,
        generationControl: generating
          ? ((await page
              .locator(target.stop)
              .filter({ visible: true })
              .first()
              .getAttribute("aria-label")
              .catch(soft(null))) ?? undefined)
          : undefined,
      });
      if (process.env.BROWSER_DEBUG)
        console.error(
          JSON.stringify({
            debug: "browser_poll",
            t: Date.now() - start,
            count,
            before,
            textLen: text.length,
            generating,
            sawGenerating,
            complete,
            stable,
            url: page.url().slice(0, 120),
          }),
        );

      if (
        text.trim().length >= 20 &&
        text.trim() !== input.prompt.trim() &&
        stable >= 3 &&
        (complete || sawGenerating)
      ) {
        await input.onProgress?.(
          "collecting",
          "Collecting the completed answer and its visible citations.",
          page.url(),
        );

        const links = await answer.locator("a[href]").evaluateAll((ns) =>
          ns
            .filter(
              (n) =>
                (n as HTMLElement).getClientRects().length > 0 &&
                getComputedStyle(n).visibility !== "hidden" &&
                // Map widgets carry tile/attribution links (Mapbox, OSM), not sources.
                !n.closest(
                  '[data-artifact-type="map"],[role="region"][aria-label*="map" i]',
                ),
            )
            .map((n) => ({
              url: (n as HTMLAnchorElement).href,
              title: (n.textContent || "").trim(),
            })),
        );

        const citations = toCitations(links, target.url, target.ownDomains);

        const model = target.model
          ? await page
              .locator(target.model)
              .filter({ visible: true })
              .first()
              .innerText({ timeout: 1500 })
              .catch(soft(""))
          : "";

        diagnostics.phase = "completed";
        return {
          status: "ok",
          diagnostics: { ...diagnostics },
          answerText: text,
          citations,
          modelReported: model.slice(0, 100) || undefined,
          webSearchUsed: searchObserved,
          latencyMs: Date.now() - start,
          browserEvidence: {
            captureMethod: "visible_dom",
            adapterVersion: ADAPTER_VERSION,
            pageUrl: page.url(),
            capturedAt: new Date().toISOString(),
            answerHash: createHash("sha256").update(text).digest("hex"),
            completion: complete ? "answer_control" : "generation_finished",
            searchObservation: searchObserved ? "confirmed" : "not_confirmed",
          },
        };
      }

      await page.waitForTimeout(750);
    }

    return failure(
      "timeout",
      "No completed browser answer before the deadline; partial text was not scored.",
    );
  } catch (e) {
    return failure(
      input.signal.aborted ? "timeout" : "error",
      input.signal.aborted
        ? "Browser deadline exceeded."
        : "Public browser UI could not be captured. " +
            (e instanceof Error
              ? e.message.split("\n")[0].slice(0, 200)
              : "Unknown browser error"),
    );
  }
}

// Operator-only failure evidence (same internal-debug folder as browser:inspect).
async function saveDebugSnapshot(page: Page, id: string) {
  const directory = join("internal-debug", `${id}-run-${Date.now()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "page.html"), await page.content(), {
    mode: 0o600,
  });
  await page.screenshot({ path: join(directory, "page.png") });
  console.error(JSON.stringify({ debug: "browser_snapshot", directory }));
}

// Walls tied to the anonymous device or exit IP, which a new identity can clear.
const needsFreshIdentity = (r: ProviderResult) =>
  r.errorReason === CHALLENGE_REASON ||
  r.errorReason === SIGNIN_REASON ||
  r.status === "rate_limited";

async function runOnce(
  id: string,
  target: BrowserTarget,
  input: BrowserInput,
): Promise<ProviderResult> {
  let context: BrowserContext | undefined;
  try {
    input.signal.throwIfAborted();
    context = await launchContext(id);
  } catch (e) {
    return {
      status: input.signal.aborted ? "timeout" : "error",
      errorReason:
        "Browser could not start. " +
        (e instanceof Error
          ? e.message.split("\n")[0].slice(0, 200)
          : "Unknown launch error"),
      webSearchUsed: false,
      latencyMs: 0,
    };
  }
  // One shared close promise: after an abort, the finally block must wait for
  // the same shutdown instead of returning while Chrome is still exiting.
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= context!.close().catch(() => {}));
  const abort = () => void close();
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    // With a required proxy, prove this run's exit IP is not the VPS before
    // any provider page is opened.
    if (process.env.REQUIRE_PROXY === "true" && process.env.VPS_PUBLIC_IP) {
      const exit = await egressIp(context).catch(() => "");
      console.log(
        JSON.stringify({ event: "browser_egress", provider: id, egressIp: exit }),
      );
      if (!exit || exit === process.env.VPS_PUBLIC_IP)
        return {
          status: "error",
          errorReason: exit
            ? "The proxy exit IP is the VPS address; refusing to browse without the residential proxy."
            : "The residential proxy exit could not be verified.",
          webSearchUsed: false,
          latencyMs: 0,
        };
    }
    const page = context.pages()[0] ?? (await context.newPage());
    const result = await collectOnPage(page, target, input);
    if (result.status !== "ok" && process.env.BROWSER_DEBUG)
      await saveDebugSnapshot(page, id).catch(() => {});
    return result;
  } finally {
    input.signal.removeEventListener("abort", abort);
    await close();
  }
}

export async function runBrowser(
  id: string,
  input: BrowserInput,
): Promise<ProviderResult> {
  const target = browserTargets[id];
  if (!target)
    return {
      status: "error",
      errorReason: "Unknown browser target.",
      webSearchUsed: false,
      latencyMs: 0,
    };

  const retries = Number(process.env.BROWSER_BLOCK_RETRIES ?? 1);
  let result = await runOnce(id, target, input);
  for (
    let attempt = 0;
    attempt < retries &&
    needsFreshIdentity(result) &&
    !input.signal.aborted &&
    (input.deadlineAt ?? Infinity) - Date.now() > 45000;
    attempt++
  ) {
    // Each run already uses a throwaway profile; a retry also gets a new
    // sticky proxy session, i.e. a new exit IP and a new anonymous device.
    await input.onProgress?.(
      "opening",
      "The source blocked this session; retrying with a fresh browser identity.",
      target.url,
    );
    result = await runOnce(id, target, input);
  }
  return result;
}
