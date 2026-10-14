import { test, expect } from "@playwright/test";
const questions = [
  "Is Acme a good accounting tool for small businesses?",
  "Compare bookkeeping software for a small shop.",
  "Which services offer reliable customer support?",
  "Recommend tools for a new business in Bengaluru.",
  "कौन से सॉफ्टवेयर छोटे व्यवसाय के लिए उपयोगी हैं?",
];
const sources = ["chatgpt", "gemini", "copilot", "google-ai", "duckai"];
for (const width of [1440, 768, 390, 360])
  test(`one-question input, live progress and results at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let stage = 0,
      posted: string[] = [];
    const prompts = questions.slice(0, 1).map((text, index) => ({
      id: `question-${index}`,
      index,
      text,
      bias: index === 0,
    }));
    const snapshot = () => ({
      id: "test-check",
      brand: { name: "Acme", aliases: [], domain: "acme.com" },
      prompt_text: questions[0],
      prompt_kind: "custom_batch",
      prompt_bias: true,
      prompts,
      status: stage === 2 ? "completed" : "running",
      created_at: new Date().toISOString(),
      refunded: false,
      runs: prompts.flatMap((p) =>
        sources.map((provider, i) => {
          const completed =
            stage === 2 || (stage === 1 && p.index === 0 && i === 0);
          const failed = stage === 2 && i === 4;
          const collecting = stage === 1 && p.index === 0 && i === 1;
          const opening = stage === 0 && p.index === 0 && i === 0;
          return {
            id: `run-${p.index}-${i}`,
            provider_id: provider,
            prompt_index: p.index,
            prompt_id: p.id,
            prompt_text: p.text,
            prompt_bias: p.bias,
            status: failed
              ? "rate_limited"
              : completed
                ? "ok"
                : collecting || opening
                  ? "running"
                  : "queued",
            phase: failed
              ? "failed"
              : completed
                ? "completed"
                : collecting
                  ? "collecting"
                  : opening
                    ? "opening"
                    : "queued",
            phase_message: failed
              ? "Daily guest limit reached."
              : completed
                ? "Answer and evidence saved."
                : collecting
                  ? "Collecting the visible assistant answer."
                  : opening
                    ? "Opening the public chatbot site."
                    : "Waiting for an available browser.",
            source_url: "https://copilot.microsoft.com/",
            reason: failed ? "Daily guest limit reached." : null,
            answer_text:
              completed && !failed
                ? `1. Acme: fixture response for question ${p.index + 1}.`
                : null,
            browser_evidence:
              completed && !failed
                ? {
                    pageUrl: "https://copilot.microsoft.com/",
                    capturedAt: new Date().toISOString(),
                    answerHash: `fixture-hash-${p.index + 1}`,
                    captureMethod: "visible_dom",
                    completion: "answer_control",
                    adapterVersion: "browser-1",
                    searchObservation: "not_confirmed",
                  }
                : undefined,
            citations: [],
            web_search_used: false,
            from_cache: false,
            created_at: new Date().toISOString(),
            repeat_index: 0,
            analysis:
              completed && !failed
                ? {
                    mentioned: true,
                    score: 82,
                    position: 1,
                    totalEntities: 1,
                    cited: false,
                    sentiment: "neutral",
                    snippet: `Fixture answer ${p.index + 1}`,
                    competitors: [],
                  }
                : null,
          };
        }),
      ),
    });
    await page.route("**/api/usage", (r) =>
      r.fulfill({ json: { attemptsLeft: 5 } }),
    );
    await page.route("**/api/events", (r) => r.fulfill({ json: { ok: true } }));
    await page.route("**/api/site/analyze", (r) =>
      r.fulfill({
        json: {
          profileId: "profile",
          brand: { name: "Acme", aliases: [], domain: "acme.com" },
          profile: { category: "User questions" },
        },
      }),
    );
    await page.route("**/api/checks", (r) => {
      posted = r.request().postDataJSON().prompts;
      expect(r.request().postDataJSON().providers).toHaveLength(5);
      expect(r.request().postDataJSON()).not.toHaveProperty("promptId");
      return r.fulfill({ json: { checkId: "test-check", attemptsLeft: 4 } });
    });
    await page.route("**/api/checks/test-check", (r) =>
      r.fulfill({ json: snapshot() }),
    );
    await page.goto("/");
    await expect(page.locator("main")).toHaveAttribute("data-ready", "true");
    await page.getByLabel("Brand / company name").fill("Acme");
    await page.getByRole("button", { name: "Analyse my brand" }).click();
    await expect(page.locator(".batch-prompt-field textarea")).toHaveCount(1);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Use my own prompt" }),
    ).toHaveCount(0);
    const run = page.getByRole("button", { name: "Run this question" });
    await expect(run).toBeDisabled();
    await page.locator("#batch-prompt-0").fill(questions[0]);
    // A maximum-length unbroken question must also wrap on small screens.
    await page.locator("#batch-prompt-0").fill("x".repeat(1000));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.locator("#batch-prompt-0").fill(questions[0]);
    await expect(run).toBeEnabled();
    await page
      .locator(".workspace")
      .screenshot({ path: `docs/qa-input-${width}.png` });
    await run.click();
    expect(posted).toEqual([questions[0]]);
    await expect(page).toHaveURL(/\/\?check=test-check$/);
    const progress = page.getByRole("region", { name: "Collection progress" });
    await expect(progress.getByText("0 / 5 finished")).toBeVisible();
    await expect(
      progress.getByText("Opening the public chatbot site."),
    ).toBeVisible();
    await expect(page.locator("#batch-prompt-0")).toBeDisabled();
    stage = 1;
    await expect(progress.getByText("1 / 5 finished")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      progress.getByText("Collecting the visible assistant answer."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("tabpanel")
        .getByRole("button", { name: "View response" })
        .first(),
    ).toBeEnabled();
    stage = 2;
    await expect(progress.getByText("5 / 5 finished")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      progress.getByText("4 answers saved · 1 unavailable · 0 remaining"),
    ).toBeVisible();
    await expect(page.locator(".used-prompt p")).toHaveText(questions[0]);
    await expect(page.getByRole("tabpanel").locator(".result-row")).toHaveCount(
      5,
    );
    await expect(
      page.getByRole("tabpanel").getByText("Daily guest limit reached."),
    ).toBeVisible();
    await page
      .getByRole("tabpanel")
      .getByRole("button", { name: "View response" })
      .first()
      .click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(".drawer-question")).toHaveText(questions[0]);
    await expect(drawer.getByText(/fixture-hash-1/)).toBeVisible();
    await expect(drawer.getByText(/Direct brand query/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("tabpanel")
      .getByRole("button", { name: "View response" })
      .first()
      .click();
    await expect(drawer.getByText(/Direct brand query/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .locator(".batch-progress")
      .screenshot({ path: `docs/qa-progress-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
test("shared chrome, pinned steps and reduced-motion fallback remain readable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "ready");
  await expect(page.locator(".brand img")).toHaveAttribute(
    "src",
    "/brand/doctorfizz-white.png",
  );
  await page.getByRole("link", { name: "What it does", exact: true }).click();
  await expect(page.locator("#nav")).toHaveClass(/stuck/);
  await expect(page.locator("#does .does").first()).toBeVisible();
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(page.locator("#pin-stack .pcard").first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.abs(
          document.getElementById("how")!.getBoundingClientRect().top - 88,
        ),
      ),
    )
    .toBeLessThan(12);
  await page.mouse.wheel(0, 1200);
  await expect(page.locator("#pin-nav li.on")).not.toHaveText(
    /Enter your brand/,
  );
  await page.getByRole("link", { name: "FAQ", exact: true }).click();
  await page.locator(".faq summary").nth(1).click();
  await expect(page.locator(".faq details").nth(1)).toHaveAttribute("open", "");
  await page.screenshot({ path: "docs/preview-faq.png" });
  expect(errors.filter((x) => !x.includes("hydration"))).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("#pin-stack .pcard")).toHaveCount(4);
  expect(
    await page
      .locator("#pin-stack .pcard")
      .evaluateAll((cards) =>
        cards.every((c) => getComputedStyle(c).position === "static"),
      ),
  ).toBe(true);
});
