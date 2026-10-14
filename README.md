# DoctorFizz LLM Visibility Checker — Three Sources v1.6

This package has **exactly three browser sources**: ChatGPT, Gemini and Google AI Mode. Microsoft Copilot and Duck.ai were removed in v1.6 (Copilot now requires sign-in; Duck.ai was not needed). There are no LLM API credentials or API adapters.

Enter a business or website, write **two to five questions** (8–1,000 characters each; leave unused boxes empty), select one to three sources, and run. The VPS worker opens each question/source pair in real Google Chrome inside its Docker container (headed on an Xvfb virtual display — nothing opens on any user's screen), through the residential proxy. Each question/source pair is one run: five questions on all three sources create 15. One batch uses one of the five free checks per 30-day window.

Real queued, opening, submitting, waiting, collecting and completed/failed stages are saved to the database. Answers appear while the remaining runs continue. Each question has a results tab, captured answer text, visible source URLs, timestamps, hashes and CSV export. Failed runs are excluded from the score; an entirely failed batch is refunded.

## What is actually verified?

Live runs of the v1.6 adapter on 2026-10-14 from an Indian residential connection (not yet from the VPS + proxy):

| Source | Browser website | Result |
| --- | --- | --- |
| ChatGPT | https://chatgpt.com/ | Completed answers captured from the logged-out UI in repeated runs (4.2k–5.5k chars; source links captured when the answer shows them) |
| Gemini | https://gemini.google.com/ | Completed answers captured; model label (Flash-Lite) and web-search activity recorded |
| Google AI Mode | https://www.google.com/ai | Completed answers captured when the question is typed into the /ai page |

**Run the VPS acceptance probe for each source after deploying.** Datacenter IPs are blocked far more often than residential ones, so the worker must browse through the residential proxy (check the `browser_egress` log line). Access restrictions, unavailable services and changed selectors are reported as failures. There is no CAPTCHA solving, account creation, private API replay or fabricated answer.

Google AI Mode is a Google Search experience, separate from the Gemini app; it is not the AI Overview section in ordinary search. Model and web-search activity are recorded only when the interface actually exposes them.

## What changed from v1.5

See [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md) for the full list. In short:

- The in-page answer reader crashed under `tsx` (`__name is not defined`), so no answer was ever read; fixed.
- Real Chrome, headed on Xvfb, a throwaway profile per run (deleted afterwards: no stored questions, no shared device identity), locale/timezone matching the proxy, no fake user agent.
- Residential proxy is verified at worker start (`browser_egress` log) and can be made mandatory (`REQUIRE_PROXY=true`).
- New ChatGPT and Google AI Mode selectors; Google AI Mode is typed into, not opened by query URL.
- Verification pages inside iframes, Google `/sorry/`, consent redirects and inline terms cards are detected immediately.
- Citations exclude the provider's own pages and unwrap Google redirect links.
- probe/inspect use exactly the production browser setup; `BROWSER_DEBUG=1` logs every poll and saves failure snapshots.

## Open the project

Extract this ZIP to a new folder. **package.json is directly at the ZIP root**; open that extracted folder in VS Code. Node 24 is required. Do not copy an existing .env into a GitHub repository.

## Deploy and test

Start with [START_HERE.md](START_HERE.md). It explains uploading the new source to the existing VPS, preserving its database/secrets, creating a new repository, configuring Vercel and running your own tests. The detailed existing-server commands are in [docs/DEPLOYMENT_VPS_VERCEL.md](docs/DEPLOYMENT_VPS_VERCEL.md).

**Vercel alone cannot run the worker.** Deploy this version to the VPS as well as Vercel. PostgreSQL, Redis and the frontend-to-backend shared secret remain necessary infrastructure settings; they are not LLM API credentials. The upgrade script changes only the `doctorfizz-llm` Docker project on 127.0.0.1:8089 and retains the existing .env and volumes. It does not alter Caddy or the rank/SEO projects.

For the first functionality test, run the probe for each source, then try one source at a time before selecting all three. Real failures must never become zero-visibility results.

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

Diagnostics are written to the worker's `internal-debug` directory and excluded from Git and Docker uploads. The JSON summary prints the directory. For the other sources use `chatgpt` or `google-ai`. Add `-e BROWSER_DEBUG=1` to `docker compose exec` to log every poll and save a snapshot of any failed run. The inspect command does not change provider readiness. The probe does, and only a complete answer establishes readiness.

## Local checks

```bash
npm ci
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Local browser tests use explicit fixtures; they do not establish external availability. See [docs/VERIFICATION.md](docs/VERIFICATION.md). The one-browser queue keeps memory bounded on the shared 2-core/8-GB VPS. Each attempt has 90 seconds and the batch deadline is run count × 90 + 120 seconds: at most **24 minutes 30 seconds** for 15 runs. This is an upper deadline, not a promised completion time.

## Capture maintenance

Selectors are in `src/worker/browser.config.ts`. Unknown UI must fail closed. The collector never scores whole-page menus, ordinary Google links, error messages, old answers or partial answers. It preserves ordered-list numbering and captures source links only when actual URLs can be read inside the response root. Source labels without readable URLs are not invented into citations. Model/search identity remains unknown when not exposed.
