# Start here — new repository, existing VPS, Vercel

This ZIP contains v1.6.0. It takes two to five manual questions and exactly three sources: ChatGPT, Gemini and Google AI Mode. Extraction places package.json at the folder root. The frontend is Vercel; browser collection is the VPS. Both must run this release.

## 1. Open and inspect locally

Extract to a new folder named DoctorFizz_Visibility_v1_6. In VS Code open that folder, then use a **local Windows PowerShell terminal**. Its prompt starts with PS C:\, not root@.

```powershell
Test-Path .\package.json
(Get-Content .\package.json -Raw | ConvertFrom-Json).version
```

Expected: True and 1.6.0. If False, enter the extracted folder that directly contains package.json first.

## 2. Upload this ZIP to the existing VPS

In local PowerShell, use the actual download location. This example assumes the Downloads folder:

```powershell
scp "$env:USERPROFILE\Downloads\DoctorFizz_LLM_Visibility_Checker_v1_6.zip" root@187.127.186.47:/root/DoctorFizz_v1_6.zip
```

Expected: file transfer reaches 100%. Enter the VPS password privately. If the ZIP is elsewhere, replace only its local path.

Connect using local PowerShell:

```powershell
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 root@187.127.186.47
```

Expected: root@srv1780228:~#. Only now run Linux commands. Use Ctrl+C if PowerShell is stuck at a continuation prompt before connecting.

In the **VPS SSH terminal**:

```bash
python3 -m zipfile -e /root/DoctorFizz_v1_6.zip /root/doctorfizz-v16
python3 -c 'import json; print(json.load(open("/root/doctorfizz-v16/package.json"))["version"])'
```

Expected: 1.6.0. Before upgrading, put the residential proxy in the existing VPS `.env` (the upgrade keeps values that are already there, and the worker reads `.env` only when its container is created):

```bash
nano /opt/doctorfizz-llm-visibility/doctorfizz-visibility/.env
```

Add or edit these two lines with your proxy provider's HTTP gateway. Keep the literal text `{session}` where your provider expects a sticky-session id (for example Bright Data `-session-{session}`, Oxylabs `-sessid-{session}`); the worker replaces it with a new id for every run:

```text
RESIDENTIAL_PROXY_URL=http://USER-session-{session}:PASS@GATEWAY:PORT
REQUIRE_PROXY=true
```

Then, when no DoctorFizz check is currently running:

```bash
bash /root/doctorfizz-v16/deploy/upgrade-vps.sh
```

Expected: backup confirmation, Docker builds (the first build also installs Google Chrome), healthy PostgreSQL/Redis and started web/worker. The script retains runtime secrets/database volumes and only upgrades doctorfizz-llm. Do not use Docker down/prune or remove volumes.

## 3. Verify the backend, the proxy and each source

In the VPS SSH terminal:

```bash
cd /opt/doctorfizz-llm-visibility/doctorfizz-visibility
docker compose -p doctorfizz-llm exec -T web node -e 'fetch("http://127.0.0.1:3000/api/health",{headers:{"x-doctorfizz-backend-key":process.env.BACKEND_SHARED_SECRET}}).then(async r=>{console.log("HTTP",r.status);console.log(await r.text())}).catch(e=>{console.error(e.message);process.exit(1)})'
```

Expected: HTTP 200 and {"status":"ready"}. This checks the app/database, not external LLM availability.

```bash
docker compose -p doctorfizz-llm logs worker | grep browser_egress
```

Expected: `"proxy":true` and an `egressIp` that is **not** 187.127.186.47. If it shows the VPS IP, the proxy is not applied: fix `.env`, then run `docker compose -p doctorfizz-llm up -d --no-deps worker` (a plain restart or exec does not reload `.env`) and check again.

```bash
docker compose -p doctorfizz-llm exec -T worker npm run browser:probe -- --provider=gemini --submit
```

Repeat with `--provider=chatgpt` and `--provider=google-ai`. Expected acceptance for each: status ready plus browser evidence. If it fails, run browser:inspect as described in README.md and adjust selectors against real DOM; do not call the collector working yet.

## 4. Create your new GitHub repository

Use your own GitHub account. Create an empty **private** repository, for example doctorfizz-visibility. Do not initialise it with another README or gitignore. Keep it private while testing, according to your earlier preference not to share this work with the team.

Switch to **local PowerShell**, in the extracted project folder. These commands do not belong in the SSH terminal:

```powershell
git init -b main
git add .
git status --short
```

Review the file list. .env/.env.local, .vercel, node_modules, .next, internal-debug and test outputs must not be staged. The supplied .gitignore excludes them. The example settings files contain placeholders and may be committed.

```powershell
git commit -m "Add DoctorFizz browser visibility checker v1.6"
git remote add origin https://github.com/YOUR_USERNAME/doctorfizz-visibility.git
git push -u origin main
```

Replace YOUR_USERNAME and the repository name with the actual GitHub URL. Complete GitHub authentication through its normal browser flow; never embed passwords or tokens in the remote URL. Expected: branch main is uploaded.

## 5. Import into Vercel

In Vercel add a new project, import your private repository and choose Next.js. Root Directory is the repository root because package.json is at that root. Use Node 24, install command npm ci and build command npm run build. Keep the default Next.js output setting.

Add these **Production** environment variables privately:

| Name | Value |
| --- | --- |
| BACKEND_URL | https://llm.187-127-186-47.sslip.io |
| BACKEND_SHARED_SECRET | The retained current VPS shared secret, entered privately |
| BACKEND_AUTH_REQUIRED | false |
| APP_URL | Your new final Vercel production origin, such as https://YOUR_PROJECT.vercel.app |

The shared secret is necessary to connect your frontend securely to your backend; no LLM API key is needed. Do not set any secret with NEXT_PUBLIC_. PostgreSQL/Redis credentials belong only on the VPS.

Once Vercel assigns the new production domain, set APP_URL to that exact origin in Vercel and redeploy if necessary. The **VPS APP_URL must also match this new frontend**. On the VPS edit its .env privately:

```bash
cd /opt/doctorfizz-llm-visibility/doctorfizz-visibility
nano .env
```

Change only APP_URL to the new production origin. Keep BACKEND_URL empty, BACKEND_AUTH_REQUIRED=true and all existing runtime secrets unchanged. Save Ctrl+O, Enter; exit Ctrl+X.

```bash
docker compose -p doctorfizz-llm up -d --no-deps web worker
```

This moves the existing DoctorFizz backend's allowed frontend origin to the new domain; the old frontend's write requests will then fail origin checks. Rank/SEO tools are unaffected. To preserve the old DoctorFizz frontend simultaneously you would need an explicitly configured multi-origin deployment or separate backend; do not silently weaken the origin check.

## 6. Test functionality yourself

1. Open the new production domain.
2. Enter your business or website and click Analyse my brand.
3. Type two to five of your own questions. No generated prompt cards should appear.
4. Exactly three source choices should appear (ChatGPT, Gemini, Google AI Mode). For the first test, choose only a source whose adapter probe passed.
5. Write at least two questions and click Run my questions. With one source selected, one browser run per question should appear. Collection stages should update from the worker and completed answers should appear as they arrive.
6. Open each question tab and response drawer. Check that the question matches, answers contain actual collected text, and readable source URLs appear only when captured. Export the CSV.
7. Repeat the layout check on a mobile device or narrow window. Input, progress and result controls should remain usable without horizontal overflow.
8. Test other sources separately. Login/verification/service errors are real failures and must stay excluded from the score. Five questions on all three sources create 15 attempts, not 15 guaranteed answers.

If the source choices say backend_update_required, the VPS has not received this release. If the backend is unavailable, check its health and bridge settings privately. If an external source fails, rebuilding Vercel will not resolve that source's access barrier.
