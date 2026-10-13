import { type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import type { ProviderResult, BrowserInput } from "../lib/types";
import { browserTargets, type BrowserTarget } from "./browser.config";

import { withBrowserPage } from "./browser-launch";
import { ADAPTER_VERSION } from "./runtime-info";

const visible = async (page: Page, selector: string) =>
  page
    .locator(selector)
    .filter({ visible: true })
    .first()
    .isVisible()
    .catch(() => false);

export async function sessionBarrier(
  page: Page,
  answerSelector?: string,
): Promise<{
  status: "blocked" | "rate_limited" | "error";
  reason: string;
} | null> {
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  // Only inspect interface text, excluding known assistant/user conversation roots.
  const interfaceText = await page
    .locator("body")
    .evaluate((body, answerSelector) => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (
          !parent ||
          parent.closest(
            'script,style,noscript,[hidden],[aria-hidden="true"],model-response,user-query,[data-message-author-role],[data-role="assistant"],[data-role="user"],[data-testid="assistant-message"],[data-testid="answer"],[data-testid="chat-message-assistant"],[data-content="ai-message"]',
          ) ||
          (answerSelector && parent.closest(answerSelector))
        )
          continue;
        let isVisible = true;
        for (let el: HTMLElement | null = parent; el; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") {
            isVisible = false;
            break;
          }
        }
        if (isVisible) parts.push(walker.currentNode.textContent || "");
      }
      return parts.join(" ");
    }, answerSelector)
    .catch(() => text);

  if (
    /too many requests|rate limit reached|daily limit reached/i.test(
      interfaceText,
    )
  )
    return {
      status: "rate_limited",
      reason: "The free browser session reached its limit.",
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
      reason:
        "The provider displayed a security verification page; no answer was collected.",
    };

  if (
    /duck\.ai is temporarily unavailable|something went wrong|unable to generate a response|service (?:is )?temporarily unavailable/i.test(
      interfaceText,
    )
  )
    return {
      status: "error",
      reason:
        "The provider displayed a service error; no answer was collected.",
    };

  // A standard footer such as 'By clicking Ask you agree...' is not a wall.
  // Keep explicit consent dialogs separate; never automatically accept them.
  const dialogs = await page
    .locator('[role="dialog"],dialog[open],[aria-modal="true"]')
    .filter({ visible: true })
    .allTextContents();

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
    /sign in to continue|log in to continue|sign into copilot|sign in to use (?:gemini|copilot|chatgpt)|log in to use (?:gemini|copilot|chatgpt)/i.test(
      interfaceText,
    )
  )
    return {
      status: "blocked",
      reason: "The provider requires sign-in before this session can continue.",
    };

  return null;
}

export async function readVisibleAnswer(
  answer: import("@playwright/test").Locator,
) {
  // This expression is intentionally plain JavaScript. tsx/esbuild injects
  // __name into nested TypeScript functions, but that helper does not exist
  // in the page VM. Keeping browser-only code as a string prevents that rewrite.
  return answer.evaluate(
    new Function(
      "root",
      String.raw`
    const blocks = new Set([
      "P",
      "DIV",
      "LI",
      "H1",
      "H2",
      "H3",
      "H4",
      "PRE",
      "UL",
      "OL",
      "BLOCKQUOTE",
    ]);
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (!(node instanceof HTMLElement)) return "";
      if (
        node.matches(
          'button,input,textarea,script,style,nav,[role="toolbar"],[aria-hidden="true"]',
        )
      )
        return "";
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return "";
      if (node.tagName === "BR") return "\n";
      let text = Array.from(node.childNodes).map(walk).join("");
      if (node.tagName === "LI" && node.parentElement?.tagName === "OL") {
        const siblings = Array.from(node.parentElement.children).filter(
          (n) => n.tagName === "LI",
        );
        const start = Number(node.parentElement.getAttribute("start") || 1);
        text = (Number(node.getAttribute("value")) || start + siblings.indexOf(node)) + ". " + text.trim();
      }
      return blocks.has(node.tagName) ? "\n" + text + "\n" : text;
    };
    return walk(root)
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  `,
    ) as (root: HTMLElement) => string,
  );
}

export async function collectOnPage(
  page: Page,
  target: BrowserTarget,
  input: BrowserInput,
): Promise<ProviderResult> {
  const start = Date.now();
  let phase = "opening";
  const diagnostics = {
    phase,
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
    diagnostics: { ...diagnostics, phase },
    webSearchUsed: false,
    latencyMs: Date.now() - start,
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
      timeout: 60000,
    });

    let barrier = await sessionBarrier(page, target.answer);
    if (barrier) return failure(barrier.status, barrier.reason);

    let before = await page
      .locator(target.answer)
      .filter({ visible: true })
      .count();

    if (!target.queryUrl) {
      const box = page.locator(target.input).filter({ visible: true }).first();
      await box.waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
      barrier = await sessionBarrier(page, target.answer);
      if (barrier) return failure(barrier.status, barrier.reason);
      if (!(await box.isVisible()) || !(await box.isEditable()))
        return failure(
          "blocked",
          "No usable public chat input found. Inspect the live page for a sign-in requirement or changed selectors.",
        );

      phase = "submitting";
      await input.onProgress?.(
        "submitting",
        "Sending your question.",
        page.url(),
      );
      await box.fill(input.prompt);

      const send = target.submit
        ? page.locator(target.submit).filter({ visible: true }).first()
        : undefined;
      if (send && (await send.isEnabled().catch(() => false)))
        await send.click();
      else await box.press("Enter");
    } else {
      const url = new URL(target.queryUrl);
      url.searchParams.set("q", input.prompt);
      phase = "submitting";
      await input.onProgress?.(
        "submitting",
        "Opening your question in Google AI Mode.",
        target.url,
      );
      before = 0;
      await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    }

    phase = "waiting";
    await input.onProgress?.(
      "waiting",
      "Question sent; waiting for the provider to answer.",
      page.url(),
    );

    let receivingReported = false;
    let previous = "",
      stable = 0,
      sawGenerating = false,
      searchObserved = false;

    while (!input.signal.aborted) {
      barrier = await sessionBarrier(page, target.answer);
      if (barrier) return failure(barrier.status, barrier.reason);

      searchObserved ||=
        !!target.search && (await visible(page, target.search));

      const answers = page.locator(target.answer).filter({ visible: true });
      const count = await answers.count();
      diagnostics.answerRoots = Math.max(0, count - before);
      const answer = answers.last();
      const contents = target.answerText
        ? answer.locator(target.answerText).filter({ visible: true }).first()
        : answer;

      const text =
        count > before && (await contents.isVisible())
          ? await readVisibleAnswer(contents)
          : "";

      diagnostics.answerCharacters = text.length;
      if (text && !receivingReported) {
        receivingReported = true;
        phase = "collecting";
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
      diagnostics.generationSeen = sawGenerating;

      // Copy control must belong to the captured answer, not an old answer/page header.
      const controls =
        target.completionScope === "page"
          ? page
          : target.completionAncestor
            ? answer.locator(target.completionAncestor)
            : answer;

      const complete =
        count > before &&
        (await controls
          .locator(target.completion)
          .filter({ visible: true })
          .first()
          .isVisible()
          .catch(() => false));

      diagnostics.completionSeen = complete;
      stable = text && text === previous && !generating ? stable + 1 : 0;
      previous = text;

      if (
        text.trim().length >= 20 &&
        text.trim() !== input.prompt.trim() &&
        stable >= 3 &&
        (complete || sawGenerating)
      ) {
        input.signal.throwIfAborted();
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
                getComputedStyle(n).visibility !== "hidden",
            )
            .map((n) => ({
              url: (n as HTMLAnchorElement).href,
              title: (n.textContent || "").trim(),
            })),
        );

        const seen = new Set<string>();
        const citations = links.flatMap((link) => {
          try {
            const u = new URL(link.url);
            if (
              !["https:", "http:"].includes(u.protocol) ||
              u.username ||
              u.password ||
              u.hostname === new URL(target.url).hostname ||
              seen.has(u.href)
            )
              return [];
            seen.add(u.href);
            return [{ url: u.href, title: link.title, domain: u.hostname }];
          } catch {
            return [];
          }
        });

        const model = target.model
          ? await page
              .locator(target.model)
              .filter({ visible: true })
              .first()
              .innerText()
              .catch(() => "")
          : "";

        input.signal.throwIfAborted();
        return {
          status: "ok",
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
      `Browser deadline exceeded during ${phase} (${diagnostics.answerRoots} response nodes, ${diagnostics.answerCharacters} characters, completion ${diagnostics.completionSeen ? "seen" : "not seen"}).`,
    );
  } catch (e) {
    return failure(
      input.signal.aborted ? "timeout" : "error",
      input.signal.aborted
        ? `Browser deadline exceeded during ${phase} (${diagnostics.answerRoots} response nodes, ${diagnostics.answerCharacters} characters, completion ${diagnostics.completionSeen ? "seen" : "not seen"}).`
        : "Public browser UI could not be captured. " +
            (e instanceof Error
              ? e.message.split("\n")[0].slice(0, 200)
              : "Unknown browser error"),
    );
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

  const start = Date.now();
  try {
    return await withBrowserPage(id, input.signal, (page) =>
      collectOnPage(page, target, input),
    );
  } catch (error) {
    return {
      status: input.signal.aborted ? "timeout" : "error",
      errorReason: input.signal.aborted
        ? "Browser deadline exceeded during startup."
        : error instanceof Error &&
            /proxy configuration|proxy URL configured/.test(error.message)
          ? error.message
          : "Browser could not start. Check the worker image and browser installation.",
      webSearchUsed: false,
      latencyMs: Date.now() - start,
      diagnostics: {
        phase: "startup",
        answerRoots: 0,
        answerCharacters: 0,
        completionSeen: false,
        generationSeen: false,
      },
    };
  }
}
