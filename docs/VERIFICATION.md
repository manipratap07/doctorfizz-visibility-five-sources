# Verification — v1.5.0, five sources

This record supersedes v1.4's test record. Local fixtures are distinct from live upstream evidence.

| Check | Result |
| --- | --- |
| Dependency install | npm ci succeeded using the supplied lockfile |
| TypeScript | Passed |
| Unit/security/SQL | 41 passed across four suites |
| Local Playwright browser/UI | 18 passed: 13 capture/barrier tests, four responsive flow tests and one motion/chrome test |
| Production build | Next.js 16.4 webpack build passed |
| Upgrade script syntax | bash -n passed |
| Responsive flow | Five questions and five source choices; 25-run progress; question tabs and response drawer at 360, 390, 768 and 1440 pixels |

The SQL harness runs the migration against PGlite and dispatches all 25 rows through the actual worker processor using a test-only browser adapter. It verifies exact five-question bounds, ownership, quotas, idempotency, stages, per-question answers, partial completion, refunds and old single-question migration compatibility. Production imports no fixture adapter.

Capture tests verify ordinary terms footers versus blocking dialogs, empty Cloudflare pages, provider error exclusion, Gemini response-only text and observed search/model fields, ChatGPT turn-specific completion controls, old/partial answer exclusion and Google AI Mode public query navigation. Ordinary Google search results are never used as AI answers.

The local Chromium executable initially failed to launch and the external Playwright browser download failed. Extracting the installed browser bundle to the execution runtime resolved launch; all 18 browser tests then passed. This is a local test-environment detail, not a provider access fix. The production worker uses the official matching Playwright image.

## User VPS observations before v1.5 packaging

- Gemini: a generic Playwright script submitted one question and received a real guest answer. The interface displayed Flash-Lite, source labels and Searching the web. This demonstrates one raw interaction, not acceptance of this new scoped adapter, stable availability or all-five prompt completion.
- ChatGPT: Just a moment verification page, zero chat inputs.
- Copilot: redirected to sign-in.
- Duck.ai: prompt submitted, service-unavailable error 02f8.
- Google AI Mode: no live test yet.

No v1.5 VPS deploy, v1.5 Vercel deploy or full live five-source collection was executed from this environment. Run browser:probe -- --provider=gemini --submit on the user's VPS. Success must include ready, completed answer evidence, page URL, timestamp and SHA-256. Inspect real HTML/screenshots before changing selectors when acceptance fails. An input, a successful build or a Vercel Ready label is not answer-collection proof.

All choices must retain truthful readiness/failure states. No fabricated, cached or unrelated replacement answers are allowed. Current selectors are candidates, including Gemini's DOM selectors; the generic successful VPS script captured whole-page text rather than these scoped nodes.
