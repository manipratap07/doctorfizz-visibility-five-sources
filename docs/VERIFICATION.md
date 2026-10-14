# Verification — v1.6.0, three sources

Deployed 2026-10-14 to the VPS stack `doctorfizz-visibility-five-sources` (`/root/doctorfizz-visibility-five-sources`, port 8089) and served at **https://visibility-checker.itzfizz.com** (Caddy, Let's Encrypt). The existing `llm.187-127-186-47.sslip.io` route keeps serving the same backend for the Vercel frontend.

## Live acceptance on the VPS (residential proxy, public domain)

`npm run browser:acceptance -- --frontend --provider=<id>` creates a real check through https://visibility-checker.itzfizz.com (API → Postgres → Redis → worker → headed Chrome on Xvfb → DataImpulse residential proxy → provider) with two questions per source:

| Source | Result |
| --- | --- |
| ChatGPT | passed — 2/2 completed answers captured |
| Gemini | passed — 2/2 completed answers captured |
| Google AI Mode | passed — 2/2 completed answers captured |

Every run logged a residential `browser_egress` IP, never the VPS address (187.127.186.47).

## Local checks

| Check | Result |
| --- | --- |
| TypeScript (`npm run typecheck`, no incremental cache) | passed |
| Unit, security and Postgres (PGlite) integration — vitest | 62 passed |
| Worker capture under `tsx` — `npm run test:runtime` | 11 passed |
| Playwright fixture capture + responsive UI flow (360/390/768/1440 px) | 21 passed (`--workers=1`) |
| Production build | passed |

## Not verified

- Long-run behaviour under real visitor load (one browser at a time; 90 s per run).
- Provider UI changes after 2026-10-14; selectors live in `src/worker/browser.config.ts`.
- Residential proxy quota: one full check (5 questions × 3 sources) uses roughly 60 MB through the proxy.
