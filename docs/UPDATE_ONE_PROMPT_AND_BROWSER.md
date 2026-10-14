# One-question flow and VPS browser update

## What changed

- One question field. Submit one question at a time across one to five selected providers. Five submitted questions per visitor/IP in a 30-day window; the sixth is rejected in the backend. A failed provider is unavailable, not a negative brand finding. A submitted question still uses one of the five runs.
- The worker uses installed Google Chrome on Xvfb with the current browser user agent, GPU enabled, `en-IN` and `Asia/Kolkata` defaults. Production, probe and inspect share the launcher.
- When `REQUIRE_PROXY=true`, every run requires a residential proxy URL whose username contains `{session}`. A random session token is generated per browser run. At worker startup and before each provider run, a browser page checks `api.ipify.org` through that context and logs `browser_egress` with the exit IP. Failure or a match with `VPS_PUBLIC_IP` stops the worker or run.
- Successful provider sessions save cookies, local storage and IndexedDB in a private Docker volume. Optional operator-authorised login state can seed each provider. Challenges in frames and Google `/sorry` are reported as blocked. No CAPTCHA is solved and a challenge is not reported as “not found.”

## Deploy only the stack serving port 8089

The known active source path is `/root/doctorfizz-visibility-five-sources`, Compose project `doctorfizz-visibility-five-sources`. Check the actual stack and keep a backup before replacing any source. Do not deploy to the older `/opt/doctorfizz-llm-visibility/doctorfizz-visibility` stack.

Set these values in the active stack's `.env` without printing the proxy credential:

```dotenv
REQUIRE_PROXY=true
RESIDENTIAL_PROXY_URL=http://USERNAME%3Bsessid.%7Bsession%7D:PASSWORD@gw.dataimpulse.com:823
PROXY_PROVIDERS=
VPS_PUBLIC_IP=187.127.186.47
BROWSER_HEADLESS=false
BROWSER_TIMEZONE_ID=Asia/Kolkata
BROWSER_LOCALE=en-IN
```

Replace `USERNAME` and `PASSWORD` with the actual URL-encoded credentials; do not commit `.env`. An empty `PROXY_PROVIDERS` applies the required proxy to every provider. If the proxy exits outside India, set locale and timezone to match the target region. `BROWSER_SESSION_PROVIDERS` is optional and should list only providers for which you completed an authorised `browser:login` session.

After the updated source is on this VPS:

```bash
cd /root/doctorfizz-visibility-five-sources
docker compose -p doctorfizz-visibility-five-sources build web worker
docker compose -p doctorfizz-visibility-five-sources up -d --no-deps --force-recreate --wait web worker
docker compose -p doctorfizz-visibility-five-sources logs --tail=100 worker
```

Run one provider probe and inspect its result and `browser_egress` entry:

```bash
docker compose -p doctorfizz-visibility-five-sources exec -T worker npm run browser:probe -- --provider=gemini --submit
docker compose -p doctorfizz-visibility-five-sources logs --tail=100 worker
```

The exit IP must differ from `187.127.186.47`. A working proxy route does not guarantee that a provider accepts the browser or supplies a completed answer. Keep blocked, sign-in, timeout and service-error results unavailable until a live run returns evidence. This update has local tests only; no live VPS credentials or deployment were available in this workspace.
