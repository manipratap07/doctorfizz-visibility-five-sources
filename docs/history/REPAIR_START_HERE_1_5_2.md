# DoctorFizz repair 1.5.1

Read `docs/RELIABILITY_AUDIT_2026-10-13.md` for findings, test results and live-access limitations.

**This file documents the earlier 1.5.1 repair. For the current one-question flow and headed browser deployment, follow [docs/UPDATE_ONE_PROMPT_AND_BROWSER.md](docs/UPDATE_ONE_PROMPT_AND_BROWSER.md). Live VPS/provider acceptance is still pending.**

## Install on the existing VPS

1. Upload `DoctorFizz_Repair_v1_5_1.zip` to `/root/` using SCP from a local PowerShell terminal:

```powershell
scp "$HOME\Downloads\DoctorFizz_Repair_v1_5_1.zip" root@187.127.186.47:/root/
```

2. In the SSH terminal, paste:

```bash
mkdir -p /root/doctorfizz-repair-1.5.1 &&
unzip -q /root/DoctorFizz_Repair_v1_5_1.zip -d /root/doctorfizz-repair-1.5.1 &&
bash /root/doctorfizz-repair-1.5.1/DoctorFizz_Repair_v1_5_1/deploy/upgrade-vps.sh --acceptance
```

The installer operates on `/opt/doctorfizz-llm-visibility/doctorfizz-visibility`, Docker project `doctorfizz-llm`. It checks the package checksum, refuses to interrupt a pending batch, backs up source/database, retains old images, builds web/worker, runs local browser regression tests inside the new image, replaces only web/worker, and checks service health. `.env`, databases, volumes, Caddy and other projects are preserved.

If an installation step fails, the installer attempts rollback and prints the backup location. The database dump is only a precaution; rollback does not import it. Newly added unused source files may remain after rollback, but the previous package and images are restored. A provider-access failure in the subsequent acceptance test does not roll back working code.

The `--acceptance` option then calls your configured `APP_URL` through Vercel and runs a normal Gemini batch of five self-contained questions. It prints a check link and each question's state. **Success requires `"event":"acceptance_result","passed":true,"captured":5`.** A successful build or `worker_ready` alone is not success.

The Vercel frontend does not need a new deployment for this server-side repair. The deployed VPS web API does need its new image; the installer handles both web and worker. If APP_URL does not identify the actual live frontend, the acceptance script will report that routing problem.

## If acceptance fails

The script prints specific stages and reasons. Do not repeatedly submit more batches. Read the new logs:

```bash
cd /opt/doctorfizz-llm-visibility/doctorfizz-visibility
docker compose -p doctorfizz-llm logs --since=20m --tail=200 worker
docker compose -p doctorfizz-llm exec -T worker npm run runtime:diagnose
```

If the frontend reports a backend/worker fingerprint mismatch, compare the returned backend instance and worker names with the `doctorfizz-llm` containers. Do not stop similarly named unrelated projects. This gate is intended to reveal an older backend or different worker handling the website jobs.

If the result is a consent, login or security-verification wall, the browser session did not yield an answer. Do not count it as brand invisibility or assume another timeout increase will fix it.

To compare the internal VPS API with the Vercel path, run the same automated check without `--frontend`:

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:acceptance -- --provider=gemini
```

That creates another normal five-question check. Do not use it repeatedly after an explicit provider wall. All-failed checks refund the regular allowance; daily anti-abuse caps still apply.

## Useful diagnostics

Test a specific prompt with the same production launcher:

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:probe -- --provider=gemini --submit '--prompt=Which agencies offer SEO services in Bengaluru?'
```

Inspect an actual page (operator-only artifacts are written under container `internal-debug/`):

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:inspect -- --provider=gemini --submit
```

`PROXY_PROVIDERS=` means direct access. Configure a comma-separated allowlist only when a route has been tested. Having `RESIDENTIAL_PROXY_URL` set no longer silently proxies every source. Proxy credentials remain in the existing `.env`, outside Git.

## Keep the fix on your PC and GitHub

Copy the repaired source from this package into your local repository while preserving `.git` and your private `.env`. Review `git status` and the diff, then commit the repair source and tests. There are no new external package dependencies. Do not use an older deployment ZIP afterwards. The new GitHub Actions workflow includes the worker-runtime regression test that detects the original capture bug.

## What was verified here

- 46 unit/integration cases passed.
- 5 worker-runtime cases passed, including five fresh browser sessions.
- 18 Playwright capture/UI cases passed.
- TypeScript and Next.js production build passed.
- Shell syntax and package checksums passed.
- Live Gemini from this execution environment reached a blocking consent dialog after submitting the question. No completed live answer was claimed.
- Docker deployment, real VPS PostgreSQL/Redis execution, the Vercel-to-VPS route and all-five-provider availability were not verified here. They remain production acceptance gates.
