# DoctorFizz Browser Visibility Checker — current v1.5 brief

This replaces the original API/suggested-question brief. The owner's current requirements govern this package.

## Customer workflow

1. User enters a website or business name and optional brand aliases/location.
2. Prepare the brand profile without consuming a check. No category classification, prompt generation or suggested-question cards.
3. User writes exactly five questions, 8–1,000 characters each, in any language. Outer whitespace is trimmed; wording is preserved. Users must enter all five.
4. User selects one to five browser sources: ChatGPT, Gemini, Microsoft Copilot, Google AI Mode and Duck.ai. These remain candidates until separately verified on the VPS.
5. One batch creates five × selected source count durable jobs. Each job stores its own question index/text, provider, status and collection stages.
6. VPS Playwright opens a fresh isolated browser session, submits that job's question to the source's visible interface, waits for a completed assistant answer and captures visible text/citations/evidence.
7. Vercel serves the interface and short API relay requests. It polls persisted job state. Browser generation runs on the VPS.
8. Show real stage changes and source URLs during collection. Progress counts completed/failed runs, not elapsed time. Partial answers that have not completed are not scored.
9. Show completed answers immediately, with five question tabs, response drawers and CSV export. Collapse the detailed collection log at completion so mobile users can reach their results quickly; the log can be reopened.

## Evidence and availability

No LLM API keys, paid API adapters, account creation or account/session sharing. Infrastructure database/Redis credentials, IP salt and the frontend-backend bridge secret remain required.

Capture only a new assistant answer with an observed completion control or generation-stop transition. Store its original text, visible citations, page URL, capture timestamp and SHA-256. Keep unknown model/search identity unknown. Stop at login, consent, verification or usage limits and report the failure. Never substitute cached, unrelated or fabricated answers.

Flag questions naming the user's brand as direct brand queries. Exclude unsuccessful runs from scoring. Refund a batch if every run fails. One batch uses one of five checks in the 30-day visitor window; daily and global queue limits also apply.

## Deployment and performance

Existing VPS Compose project: `doctorfizz-llm`; web binding: `127.0.0.1:8089`; worker concurrency: one browser at a time. Preserve existing `.env`, Docker volumes, Caddy routes and unrelated rank/SEO tools. Use the scoped backup/upgrade script in `deploy` and the VPS/Vercel guide in `docs`.

Each browser attempt has 90 seconds. Batch deadline equals run count × 90 seconds + 120 seconds (39 minutes 30 seconds maximum for 25 runs). No fixed completion-time promise. Jobs continue after a tab closes; unguessable result links remain available for seven days.

Mobile, tablet and desktop must fit without horizontal overflow, including long questions. Use labelled textareas, touch-friendly controls, keyboard question tabs, a keyboard-dismissable response drawer and reduced-motion support.

## Acceptance

- TypeScript and unit/security/SQL tests pass, including five-question bounds, ownership, quotas, idempotency, correct dispatch for all 25 runs, real stage persistence, partial results and migration compatibility.
- Local Playwright capture fixtures verify assistant-only completed evidence and barrier failures.
- Full browser UI flow passes at 360, 390, 768 and 1440 pixels.
- Production build and bridge/schema HTTP smoke pass.
- Public source selectors and generation must separately pass `browser:probe --submit` on the user's VPS before deployment is accepted as live.
