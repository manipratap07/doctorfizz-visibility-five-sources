# Repair 1.5.2: business context and completed-answer capture

The production report showed one saved Gemini answer discussing Bengaluru instead of the company, and another Gemini run timing out after receiving 1,991 characters and seeing a completion control. The other providers reported security verification, missing public input, or service errors.

## What is verified

- Before this change, the business profile was used for scoring but the worker sent the question exactly as entered. A fresh provider session had no meaning for “we” or “our company”.
- New company-referencing questions include the saved business name and domain. The original question and effective question are retained in batch metadata; the effective question is stored on each run and shown/copied in results. These are direct brand queries. General discovery questions do not receive brand context.
- A question about rankings asks the provider to disclose when no verified ranking exists. A visibility score or recommendation-list position is not an independently established market ranking.
- Two real-browser fixtures reproduced the reported collecting timeout: an unrelated Stop reading aloud button and whitespace-only DOM changes. The fix recognises Gemini generation controls specifically and compares whitespace-normalised text while preserving the captured text.
- Gemini completion controls must belong to the new answer and be enabled. Old-answer Copy buttons, disabled controls, active generation, changing words, and missing completion evidence cannot establish a completed answer.
- The exact cause of the original production Question 2 still requires live observation. Diagnostics now record stable polls, active generation, response busy state and the matched generation-control label every five seconds without logging answer text.
- BullMQ stores the Redis worker identity in `rawname`; `name` is the queue name. Health/diagnostic outputs and the acceptance gate now use the correct identity.
- Optional provider-specific saved sessions are supported. Passwords are entered directly by the operator in a headed browser. Cookies/local storage/IndexedDB are saved outside Git and Docker images and mounted read-only in the worker.

## Validation

52 unit/integration cases, 12 real-Chromium runtime cases, and 18 browser/UI cases passed locally. TypeScript and the production build passed. The runtime tests include five separate browser sessions, the two reproduced timeouts, incomplete-answer rejection, cancellation and isolated session restoration. These are local fixtures, not successful live access to all providers.

## Deploy to the stack serving port 8089

Use `/root/doctorfizz-visibility-five-sources` and Compose project `doctorfizz-visibility-five-sources`. The old `/opt/doctorfizz-llm-visibility/doctorfizz-visibility` deployment has a separate database/queue and does not serve port 8089. Do not use its probe as evidence for this website.

Keep the source backup and old image tags created during the 1.5.1 deployment. Update and test before activation:

```bash
cd /root/doctorfizz-visibility-five-sources
git pull --ff-only origin main
docker compose -p doctorfizz-visibility-five-sources build web worker
docker compose -p doctorfizz-visibility-five-sources run --rm --no-deps \
  -e PROXY_PROVIDERS= -e RESIDENTIAL_PROXY_URL= -e BROWSER_SESSION_PROVIDERS= \
  --entrypoint node worker --import tsx --test tests/worker-runtime.node.ts
```

After the tests pass, activate only web/worker, then inspect readiness:

```bash
docker compose -p doctorfizz-visibility-five-sources up -d \
  --no-deps --force-recreate --wait --wait-timeout 120 web worker
docker compose -p doctorfizz-visibility-five-sources exec -T worker npm run runtime:diagnose
```

## Authorised login

On your own desktop, in the existing repository's terminal:

```powershell
git pull --ff-only origin main
npm ci --include=dev
npx playwright install chromium
npm run browser:login -- --provider=gemini
```

Complete sign-in/verification yourself in the opened browser. Return to Gemini's chat page, then press Enter in the terminal. This writes `browser-sessions/gemini.json`. Treat it as private login state. Do not send it through chat or commit it. A session saved on your desktop may need renewed verification on the VPS; do not assume signing in removes a provider's security challenge.

Transfer directly from PowerShell:

```powershell
scp .\browser-sessions\gemini.json root@187.127.186.47:/root/doctorfizz-visibility-five-sources/browser-sessions/gemini.json
```

The deployment creates the destination directory. On the VPS, set file ownership to the worker's actual UID/GID and restrict access:

```bash
cd /root/doctorfizz-visibility-five-sources
sessionUid=$(docker compose -p doctorfizz-visibility-five-sources exec -T worker id -u)
sessionGid=$(docker compose -p doctorfizz-visibility-five-sources exec -T worker id -g)
chown "$sessionUid:$sessionGid" browser-sessions browser-sessions/gemini.json
chmod 700 browser-sessions
chmod 600 browser-sessions/gemini.json
```

Set `BROWSER_SESSION_PROVIDERS=gemini` in this deployment's `.env`, preserving all other settings. Recreate only its worker to load the updated environment. No real password belongs in `.env`, source code, or logs. Use a provider-specific JSON file and explicit allowlist entry for each separately authorised provider. With an empty allowlist, all jobs remain logged out. An expired session is an access problem and requires a new operator login.

Session reuse follows [Playwright's authentication documentation](https://playwright.dev/docs/auth).

## Live acceptance

Start a fresh five-question Gemini check through the Vercel frontend or run:

```bash
docker compose -p doctorfizz-visibility-five-sources exec -T worker \
  npm run browser:acceptance -- --frontend --provider=gemini
```

The script checks backend/worker identity before creating a real batch, consumes the normal allowance, and verifies completed answer evidence for all five questions. If Turnstile is enabled, use the ordinary website flow. It never resets quota or fabricates answers.

If a live question fails, obtain its stage observations:

```bash
docker compose -p doctorfizz-visibility-five-sources logs --since=20m --tail=400 worker
```

Read events by checkId and runId. A captured answer that does not mention the company is a valid negative visibility observation for a discovery query. A verification wall, missing chat input, or provider service failure is an unavailable source, never a zero ranking. Login session support does not guarantee access to every provider.
