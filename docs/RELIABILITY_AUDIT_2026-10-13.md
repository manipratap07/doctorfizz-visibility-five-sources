# DoctorFizz reliability audit and repair

13 October 2026 | Repair release 1.5.1 | Status: verified locally, not deployed to the user's VPS

## What is established

The uploaded archive has a reproducible answer-capture bug. Its normal unit tests, browser fixture tests and TypeScript check did not detect that bug. Running the actual adapter through the worker's `tsx` transformer produced:

```text
DIRECT_READ_ERROR locator.evaluate: ReferenceError: __name is not defined
COLLECT {"status":"timeout", ...}
```

A completed answer was already present in the browser. The nested `walk` function in `readVisibleAnswer` was rewritten by the transformer to use a Node-side helper that did not exist in the browser. The surrounding `.catch(() => "")` hid that failure, so capture kept waiting for text until the deadline expired. Playwright documents that page evaluation and the Node process execute in separate environments: https://playwright.dev/docs/evaluating.

The repair serializes a static JavaScript reader without transpiler-injected helpers. It does not install `window.__name` or change third-party page globals. Unexpected capture errors are now returned immediately instead of becoming empty text and misleading timeouts.

**This proves a defect in the uploaded archive. It does not prove that the same defect is the sole cause of the current VPS failure.** The supplied handoff says the VPS already has a temporary `__name` workaround, longer navigation timeout and provider-specific proxy routing that are missing from the archive. That version mismatch must be resolved. No live VPS filesystem or SSH session was available here.

## Findings and changes

| Finding | Evidence | Repair |
| --- | --- | --- |
| Answer reader crashes under `tsx` | Reproduced with an actual Chromium page and the original adapter | Static browser-only reader; production-runtime regression test |
| Exceptions become blank answers | Reader errors were caught and replaced with an empty string | Report capture errors; retain timeout stage, response-node count, text length and completion observation |
| Inspection settings differ from production | `inspect.ts` and non-submit probes launch their own default Chromium | Jobs, probes and inspections now share one browser/context launcher |
| Proxy selection is missing from this archive | A configured proxy URL was applied to every provider | `PROXY_PROVIDERS` is an explicit, trimmed allowlist; an empty list uses direct connections |
| Proxy credentials need separate fields | Confirmed by code inspection and dedicated tests | Parse and decode server, username and password separately; do not log credentials |
| Probe result is insufficient deployment proof | User's single probe passed, five website jobs failed | Add a five-question acceptance script through the actual API, queue and worker |
| Normal failed captures leave no worker log | Returned failure objects do not fire BullMQ's `failed` event | Log each run's start, phases and outcome, with IDs and a prompt hash but no prompt/answer content |
| Running code cannot be identified | Startup previously logged only `worker_ready` | Source fingerprint in worker name, probe output and run logs; health endpoint identifies backend instance and workers |
| Health previously ignored the worker | Endpoint checked only database and Redis | Missing queue workers now make health return HTTP 503 |
| Shutdown could interrupt a 90-second capture | Default container stop grace is shorter than a capture | Give worker 110 seconds to stop and enable container init |
| Browser metadata is internally inconsistent | Chrome 122 Windows user agent and fake plugin array over a newer Linux Chromium | Use the installed browser's own user agent and APIs |
| A successful answer might finish after cancellation during an iteration | Capture only tested cancellation at loop boundaries | Recheck cancellation before collecting and returning evidence |
| Existing deployment could overwrite VPS-only fixes | Uploaded files differ from the handoff | Full repaired source package, checksums, backup/rollback, image tests before activation and CI regression checks |

No UI layouts, fonts, colours, animations, scoring weights or database schema were changed. Provider failures still remain unavailable rather than becoming zero scores; a completely failed batch still refunds the visitor allowance. The returned answer is a snapshot, not a permanent ranking.

## Tests actually run

| Check | Result | Scope |
| --- | --- | --- |
| Original unit/integration suite | 41 passed | Includes PGlite database tests; queue and provider adapters are mocked there |
| Original Playwright suite | 18 passed | Controlled provider pages and mocked UI API responses; not live-provider evidence |
| Original reader under worker `tsx` loader | Failed as expected | Actual Chromium reproduced missing `__name` and timeout |
| Repaired unit/integration suite | 46 passed | Adds proxy-routing tests and five failed job-handler runs with full-batch refund/no scores |
| Repaired worker-runtime suite | 5 passed | Actual Chromium and `tsx`; includes five fresh sessions with the exact five submitted questions, no global helper, explicit capture errors and cancellation |
| Repaired Playwright suite | 18 passed | Capture rules, five-question UI flow, desktop/tablet/mobile layouts and existing animation checks |
| TypeScript | Passed | Full project |
| Next.js production build | Passed | Next.js 16.4.0, Node 24.19.0 |
| Deployment script | Syntax checked | Docker is unavailable in this environment; actual image build/recreate/rollback remains a VPS gate |

**69 repaired automated test cases passed.** Browser capture tests use explicitly labelled fixtures. They demonstrate code behaviour and are never served as production answers. PGlite tests do not establish a live PostgreSQL/Redis/BullMQ deployment. The separate automated acceptance script is the final production gate.

The local Chromium bundle required manual extraction because its archive helper failed on this filesystem. The tests then used Chromium 153. Production retains the package's matching official Playwright container. No dependency versions were changed; package release metadata was updated to 1.5.1.

## Actual external-provider attempt

One live Gemini attempt was made from this execution environment, using the user's exact question: `where our company ranks in bengaluru`.

The first attempt stopped at the environment proxy's certificate-trust error. For a subsequent diagnostic, only the public key of this environment's already-configured proxy CA was trusted by the test browser. That temporary test code is **not** included in this release and certificate verification is unchanged in the product.

The subsequent attempt opened Gemini, found the input and submitted the question. It then encountered a blocking consent dialog. The adapter returned `blocked`, with zero response nodes and no scored answer. It did not accept the dialog. This is evidence from a different environment and egress route, not from the user's VPS or DataImpulse account. ChatGPT, Copilot, Google AI Mode and Duck.ai were not revalidated live here; their last known failed states come from the supplied handoff.

There is no honest guarantee that anonymous browser access to all five independently operated sites will remain available. Login, consent, rate limits, verification and site changes remain external constraints. This release repairs proven software defects and makes failures diagnosable; it does not claim five working production sources.

## Production acceptance

The installer preserves the existing `.env`, database and unrelated Docker projects. It takes a source/database backup and retains the old images. It builds the repaired images and runs the worker-runtime tests inside the new worker image before replacing the running web and worker services. On a deployment/build/health failure it attempts to restore the previous source and image tags. It does not restore database contents or delete volumes.

Use the installer with `--acceptance` to run five questions through the configured `APP_URL` after deployment. The acceptance script:

1. Calls the live frontend's `/api/health` through the Vercel relay.
2. Checks release 1.5.1 and exactly one browser worker with the expected source fingerprint. A stale backend or unexpected worker fails this gate before submitting questions.
3. Creates a normal visitor/business profile and five-question batch using the real API. It does not reset quotas, insert synthetic results or skip normal allowance checks.
4. Polls the five stored runs and prints their actual phases and failures.
5. Requires all five runs to succeed, preserve the submitted prompts, include analysis and browser evidence, and match the SHA-256 of their saved answer text.
6. Returns a non-zero exit code if any run fails or the expected backend/worker does not match.

A successful Gemini batch is the acceptance target for Gemini only. Each other provider needs its own successful acceptance before it can be described as operational. A consent/login/verification result is not fixed by simply increasing a timeout.

One acceptance run counts as one ordinary five-question check. All-failed batches receive the existing refund; daily anti-abuse caps continue to apply. With Turnstile enabled, use the normal website flow instead of this CLI script. Operator diagnostics must not disable production verification.

## Questions and measurement

The screenshot repeats `where our company ranks in bengaluru` five times. In a fresh anonymous session, “our company” has no context. This is not the cause of the reproduced JavaScript exception, but it can produce a clarification rather than a useful visibility measurement. Prefer self-contained buyer questions such as “Which agencies offer SEO services for small businesses in Bengaluru?” Use an explicit brand name for a direct brand query; do not quietly inject the brand into discovery questions.

## Preventing recurrence

Keep this source on GitHub and the local PC before future deployments. The new CI workflow checks the actual worker transformer as well as the existing suites. Do not redeploy an older archive over the server-only workaround. Use `runtime:diagnose` and the source fingerprint if a terminal probe and website result disagree. Do not stop other Docker projects just because they have similar names.

See `REPAIR_START_HERE.md` at the project root for the deployment command and acceptance commands. Test logs are in `docs/reliability-evidence/`.
