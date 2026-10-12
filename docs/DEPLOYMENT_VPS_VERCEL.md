# v1.5 note

For the new flat-root ZIP and a new GitHub/Vercel project, follow ../START_HERE.md. The older staging paths below belong to the v1.4 ZIP with a nested project folder. Do not reuse its archive upload path for this release.

# Upgrade your existing VPS + Vercel app

This guide is for your existing server **187.127.186.47**, app folder **/opt/doctorfizz-llm-visibility/doctorfizz-visibility**, Compose project **doctorfizz-llm**, backend **https://llm.187-127-186-47.sslip.io**, and frontend **https://doctorfizz-visibility.vercel.app**.

## 1. Download and transfer the ZIP

Save `DoctorFizz_LLM_Visibility_Checker_Browser.zip` in Windows Downloads. Run in **PowerShell on your computer**:

```powershell
scp "$env:USERPROFILE\Downloads\DoctorFizz_LLM_Visibility_Checker_Browser.zip" root@187.127.186.47:/root/
```

Expected: an SSH password prompt if needed, then a transfer progress line ending at `100%`. The VPS password does not appear as you type. Do not paste secrets into chat.

Reconnect in PowerShell if needed:

```powershell
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 root@187.127.186.47
```

Expected: Ubuntu login information, followed by `root@srv1780228:~#`.

## 2. Extract into a separate staging folder

Run in the **VPS terminal**:

```bash
mkdir -p /root/doctorfizz-browser-v14
python3 -m zipfile -e /root/DoctorFizz_LLM_Visibility_Checker_Browser.zip /root/doctorfizz-browser-v14
ls /root/doctorfizz-browser-v14/doctorfizz-visibility
```

Expected: the first two commands normally print nothing. `ls` shows `README.md`, `compose.yaml`, `package.json`, `src`, `deploy` and other project files. Your running app has not been replaced yet.

## 3. Apply the scoped upgrade

Read the script if you want to inspect the exact changes:

```bash
cat /root/doctorfizz-browser-v14/doctorfizz-visibility/deploy/upgrade-vps.sh
```

Expected: the script text. It backs up this app and its PostgreSQL database, preserves `.env` secrets and volumes, keeps port 8089, builds the new images and upgrades only this Compose project.

Run:

```bash
bash /root/doctorfizz-browser-v14/doctorfizz-visibility/deploy/upgrade-vps.sh
```

Expected, in order:

- `Source and database backups saved: /root/doctorfizz-browser-backup-...`
- `Browser runtime settings saved; existing runtime secrets retained.`
- Docker build output. Initial build can take several minutes.
- `migrate` finishes with `Schema ready.` (may appear in service logs rather than the detached startup output).
- PostgreSQL and Redis remain healthy; web/worker start. Web maps `127.0.0.1:8089->3000/tcp`.
- `Browser upgrade started. Next run the health check...`

The script stops if backup/config/build fails. It does not run `docker compose down`, `docker system prune`, remove volumes, edit Caddy or affect `seo-analyzer-vps`/your port-3000 rank worker. Running DoctorFizz checks should finish before you upgrade its worker.

## 4. Check local backend health

```bash
cd /opt/doctorfizz-llm-visibility/doctorfizz-visibility
docker compose -p doctorfizz-llm exec -T web node -e 'fetch("http://127.0.0.1:3000/api/health",{headers:{"x-doctorfizz-backend-key":process.env.BACKEND_SHARED_SECRET},signal:AbortSignal.timeout(10000)}).then(async r=>{console.log("HTTP",r.status);console.log(await r.text())}).catch(e=>{console.error(e.message);process.exit(1)})'
```

Expected:

```text
HTTP 200
{"status":"ready"}
```

If startup is still in progress, rerun after it finishes. A public health request without the backend key still returns **401**, intentionally.

```bash
docker compose -p doctorfizz-llm logs --tail=40 worker
```

Expected: a JSON log containing `"event":"worker_ready"`. Any database/Redis/browser-start error needs investigation before using the tool.

## 5. Verify actual browser access on YOUR VPS

First, detect guest chat inputs without submitting a question:

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:probe
```

Expected: one JSON line per provider. `input_found` means an input was detected, **not** that answers can be captured. `blocked`/`error` includes the observed reason.

Then perform the actual acceptance test:

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:probe -- --submit
```

This submits one non-sensitive sample question per candidate website, sequentially, and may take up to six minutes.

A passing provider must report:

```text
{"provider":"copilot","status":"ready","reason":"","evidence":{"captureMethod":"visible_dom",...}}
```

The provider ID varies. Evidence must include the real page URL, capture time and answer hash. `blocked`, `rate_limited`, `timeout` or `error` is **not** a pass. The command returns a nonzero exit code if any provider fails. It does not create a successful result from missing browser data.

If a site has a login/consent/verification wall, the credential-free workflow cannot use that session automatically. If only the site's HTML selectors changed, update `src/worker/browser.config.ts` after inspecting the real UI, rebuild `worker` and repeat the test. Do not treat this as a request for an API key.

To disable failed candidates, edit only `BROWSER_DISABLED_PROVIDERS` in `.env`, using comma-separated IDs (`chatgpt`, `gemini`, `copilot`, `google-ai`, `duckai`), then recreate this app's web/worker:

```bash
nano .env
docker compose -p doctorfizz-llm up -d --no-deps web worker
```

Expected: updated containers start; disabled choices are labelled disabled. This environment-only change does not require a rebuild. Never share `.env` output.

## 6. Deploy this revised source to your existing Vercel project

Your earlier deployment still has the old UI/code until you deploy this revision. Extract the ZIP locally and open its `doctorfizz-visibility` folder in VS Code. Use your own Vercel account; no GitHub push or team repository change is required.

In the existing Vercel project, retain/set these **Production** variables:

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://doctorfizz-visibility.vercel.app` |
| `BACKEND_URL` | `https://llm.187-127-186-47.sslip.io` |
| `BACKEND_SHARED_SECRET` | The same existing secret from the VPS, entered privately |
| `BACKEND_AUTH_REQUIRED` | `false` |

No LLM API keys, model IDs, paid budgets, database or Redis variables are needed on Vercel. The existing bridge secret remains required. Do not print it in screenshots.

In the **local VS Code terminal**, from the extracted project:

```powershell
npx vercel link
```

Expected: Vercel login/setup prompts if needed. Choose the existing scope and **doctorfizz-visibility** project, not a new project. Linking only stores local project association.

```powershell
npx vercel --prod
```

Expected: an upload/build log and a production deployment URL. Wait for `Ready`. A dashboard-only redeploy of the old commit will not upload this revised code.

## 7. Test the user flow

1. Refresh the production URL.
2. Enter `itzfizz.com` or the business name `itzfizz` and prepare the profile.
3. Confirm exactly five blank question fields, with no suggested questions or radio cards.
4. Write five questions of your own (8–1,000 characters each). One can explicitly name `itzfizz` to check the direct-brand-query label.
5. Select the sources that passed the VPS probe and click **Run my five questions**.
6. Follow each question/source stage in **Live collection**. Five selected sources create 25 runs. The finished count must reflect actual completed/failed runs.
7. Open answers as they finish, while other browser runs remain pending. Use the question tabs to check that answers belong to the right question.
8. Check real captured text, citations (when present), source URL, timestamp and hash. A blocked or failed source must show its reason and have no invented answer.
9. Export CSV: each row includes question number, question text, source, actual answer and evidence.
10. Repeat at phone and desktop widths. Fields, progress cards, tabs and the response drawer must fit the screen.

One batch consumes one check. Browser work runs sequentially to limit memory use alongside your existing tools. Each attempt has 90 seconds; the 25-run batch deadline is 39 minutes 30 seconds. This is a maximum, not an estimated completion time. Leaving the results page does not cancel queued work; keep the public result link to return to it.

A success requires actual provider answers, not merely a `Ready` Vercel deployment or a `200` backend health check. Search use is marked confirmed only when the browser exposes a corresponding observed indicator. Duck.ai is not assumed to search the web.

## Restore only DoctorFizz if necessary

Use the backup path printed by the upgrade. Its source archive includes the previous `.env`; the database dump is retained as an additional backup. Since migrations are additive, a code rollback normally does not require database restoration.

Extract the backup source to a separate review folder first. Copy it back to this DoctorFizz app and rebuild/recreate only `doctorfizz-llm` web/worker. Do not restore or delete unrelated VPS containers. If database restoration is needed, review it separately because it can overwrite newer DoctorFizz data.
