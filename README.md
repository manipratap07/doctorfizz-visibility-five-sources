# DoctorFizz LLM Visibility Checker — Five Sources v1.5

This separate package is ready to initialise as a new GitHub repository. It has **exactly five browser sources**: ChatGPT, Gemini, Microsoft Copilot, Google AI Mode and Duck.ai. There are no LLM API credentials or API adapters. Perplexity and Grok have been removed from the current source list.

Enter a business or website, write **exactly five questions** (8–1,000 characters each), select one to five sources, and run. The VPS opens a fresh Playwright session for every question/source pair. One source creates five runs; all five create 25. One batch uses one of the five free checks per 30-day window.

Real queued, opening, submitting, waiting, collecting and completed/failed stages are saved to the database. Answers appear while the remaining runs continue. Each question has a results tab, captured answer text, visible source URLs, timestamps, hashes and CSV export. Failed runs are excluded from the score; an entirely failed batch is refunded.

## What is actually verified?

| Source | Browser website | Evidence from the user's VPS before this release |
| --- | --- | --- |
| ChatGPT | https://chatgpt.com/ | Verification page; no prompt input reached |
| Gemini | https://gemini.google.com/ | A guest question produced a real answer; interface displayed Flash-Lite and source labels |
| Microsoft Copilot | https://copilot.microsoft.com/ | Redirected to sign-in |
| Google AI Mode | https://www.google.com/ai | Not tested on the VPS |
| Duck.ai | https://duck.ai/ | Question submitted, then service-unavailable error 02f8 |

**Only Gemini has demonstrated a raw guest answer. The v1.5 production capture adapter still needs its own full VPS acceptance test.** The five choices are not a promise of five working anonymous services. The frontend shows actual recent probe status; it never marks a source ready just because an input exists. Access restrictions, unavailable services and changed selectors are reported as failures. There is no CAPTCHA bypass, account creation, private API replay or fabricated answer.

Google AI Mode is a Google Search experience, separate from the Gemini app; it is not the AI Overview section in ordinary search. Duck.ai is labelled as the service, not as a native ChatGPT/Claude session. Model and web-search activity are recorded only when the interface actually exposes them.

## What changed from v1.4

- Five named sources and server validation for up to five selected sources.
- Gemini contenteditable input and scoped model-response capture, completion controls, visible model label and observed search activity.
- ChatGPT response-turn scoping; Google AI Mode public query navigation with scoped AI-answer selectors.
- Ordinary terms footers no longer falsely trigger a consent wall. Blocking consent dialogs still stop the job.
- Cloudflare verification, sign-in requirements, service-unavailable errors and usage limits have separate messages.
- Probe one source at a time; operator diagnostics save page HTML, screenshot and redacted request-error metadata.
- An older VPS cannot silently replace the new frontend's five choices with its old source list. Missing sources show a backend-update message.
- Broader secret-file exclusions for GitHub uploads.

## Open the project

Extract this ZIP to a new folder. **package.json is directly at the ZIP root**; open that extracted folder in VS Code. Node 24 is required. Do not copy an existing .env into a GitHub repository.

## Deploy and test

Start with [START_HERE.md](START_HERE.md). It explains uploading the new source to the existing VPS, preserving its database/secrets, creating a new repository, configuring Vercel and running your own tests. The detailed existing-server commands are in [docs/DEPLOYMENT_VPS_VERCEL.md](docs/DEPLOYMENT_VPS_VERCEL.md).

**Vercel alone cannot run the worker.** Deploy this version to the VPS as well as Vercel. PostgreSQL, Redis and the frontend-to-backend shared secret remain necessary infrastructure settings; they are not LLM API credentials. The upgrade script changes only the `doctorfizz-llm` Docker project on 127.0.0.1:8089 and retains the existing .env and volumes. It does not alter Caddy or the rank/SEO projects.

For the first functionality test, clear the source selection and choose **Gemini only**, after its adapter probe passes. All-five testing can include real failures from the other sources; those failures must not become zero-visibility results.

## VPS acceptance and diagnostics

Run from `/opt/doctorfizz-llm-visibility/doctorfizz-visibility` in the SSH terminal:

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:probe -- --provider=gemini --submit
```

Expected success is `status: ready` with visible DOM evidence, capture timestamp, answer hash and a completion signal. Anything else is a failed acceptance test, even if a separate generic script captured whole-page text.

If selectors need inspection:

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:inspect -- --provider=gemini --submit
```

Diagnostics are written to the worker's `internal-debug` directory and excluded from Git and Docker uploads. The JSON summary prints the directory. For the other sources use `chatgpt`, `copilot`, `google-ai` or `duckai`. The inspect command does not change provider readiness. The probe does, and only a complete answer establishes readiness.

## Local checks

```bash
npm ci
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Local browser tests use explicit fixtures; they do not establish external availability. See [docs/VERIFICATION.md](docs/VERIFICATION.md). The one-browser queue keeps memory bounded on the shared 2-core/8-GB VPS. Each attempt has 90 seconds and the batch deadline is run count × 90 + 120 seconds: at most **39 minutes 30 seconds** for 25 runs. This is an upper deadline, not a promised completion time.

## Capture maintenance

Selectors are in `src/worker/browser.config.ts`. Unknown UI must fail closed. The collector never scores whole-page menus, ordinary Google links, error messages, old answers or partial answers. It preserves ordered-list numbering and captures source links only when actual URLs can be read inside the response root. Source labels without readable URLs are not invented into citations. Model/search identity remains unknown when not exposed.
