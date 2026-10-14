# DoctorFizz LLM Visibility Checker v1.6: bugs aur fixes

Folder: `~/DoctorFizz_LLM_Visibility_fixed`, branch `fix/browser-detection`. Commit nahi kiya hai; `git diff` se saare changes dikhenge.

## Product changes (aapke kehne par)

- Sources ab sirf teen hain: **ChatGPT, Gemini, Google AI Mode**. Microsoft Copilot (ab bina login ke chalta hi nahi) aur Duck.ai (zaroorat nahi thi) poori tarah hata diye gaye.
- Sawaal ab **2 se 5** tak, jitne chahein. Kam se kam 2 zaroori hain, aur khaali boxes bheje nahi jaate. UI ("Question 3–5 · optional", live count "2 questions × 3 sources = 6"), API validation, docs aur tests sab update hain.

## Kya verify hua

| Check | Result |
| --- | --- |
| Live run, asli adapter, Indian residential IP (Mac, 2026-10-14) | ChatGPT ✅ 4241 chars · Gemini ✅ 3337 chars, model "Flash-Lite", web search detect · Google AI Mode ✅ 3728 chars |
| `tsc --noEmit --incremental false` | ✅ 0 errors |
| vitest (unit + Postgres integration) | ✅ 54/54 |
| Playwright fixture tests (adapter + UI, 4 screen widths) | ✅ 20/20 |
| Code audit: 6 areas, har finding 2 independent skeptics se verify | 26 confirmed bugs, saare fix |

**Abhi verify nahi hua:** VPS + residential proxy par run. VPS ka SSH access nahi tha. Neeche ke deploy steps ke baad `browser:probe` chalana zaroori hai.

## Asli wajah ki kuch kaam kyun nahi kar raha tha

1. **Answer kabhi padha hi nahi jaata tha.** Worker `tsx` se chalta hai. `tsx` compile karte waqt andar ke named functions ko `__name(...)` mein wrap kar deta hai, aur browser ke andar ye helper exist nahi karta. Isliye answer padhne wala function har baar `ReferenceError: __name is not defined` throw karta tha, error nigal liya jaata tha, answer khaali milta tha, aur run timeout ho jaata tha. Fixture tests Playwright ke runner mein chalte hain, jo `__name` nahi daalta, isliye ye bug tests mein kabhi pakda nahi gaya.
2. **ChatGPT aur Google AI Mode ke selectors purane the.** ChatGPT ka naya logged-out UI aur Google ka AI Mode DOM badal chuke hain.
3. **Google AI Mode ko seedha `search?udm=50&q=...` URL se kholna** Google ka `/sorry/` (CAPTCHA) page trigger karta tha.
4. **Browser bot jaisa dikhta tha:** fake Chrome 122 user agent, headless mode, GPU band, ulta asar karne wala "stealth" script, aur timezone ka mismatch.

## Saare bugs aur fixes

### A. Live testing mein mile (browser capture)

| # | Severity | Bug | Fix |
|---|---|---|---|
| 1 | Critical | `readVisibleAnswer` browser mein `__name is not defined` throw karta tha, isliye har provider ka answer "" tha aur run timeout | In-page code ab `new Function(...)` ke andar plain JS source hai (`READ_VISIBLE_ANSWER`, `INTERFACE_TEXT`), jise compiler chhoota nahi |
| 2 | Critical | ChatGPT: input `#mobile-composer-prompt` ban gaya; answer `li[data-message-role="assistant"]`; purana `conversation-turn` completion scope ab exist nahi karta | Naye selectors. Completion ab turn ka apna `data-message-complete` marker hai |
| 3 | Critical | Google AI Mode: direct query URL se `/sorry/`; answer selectors match nahi karte the | `/ai` page par sawaal type hota hai. Answer `[data-subtree="aimc"]`, text `[data-container-id="main-col"]`, completion `data-complete="true"` |
| 4 | High | Sawaal bhejne ke baad `locator.press("Enter")` throw karta tha (composer badal jaata hai), aur poora run error ho jaata tha | `page.keyboard.press("Enter")` |
| 5 | Medium | Map widget ka "Map data ©2026 Terms" answer text mein aata tha; Mapbox/OSM links citations bante the | Map regions text aur citations dono se bahar |
| 6 | Medium | Citations mein provider ke apne pages (policies.google.com, support.google.com) gine jaate the; Google `/url?q=` redirect nahi khulta tha | `src/worker/citations.ts`: har provider ke `ownDomains` hatte hain, redirect unwrap hota hai (unit tests ke saath) |
| 7 | Medium | Block-check user ke apne sawaal ka text bhi padhta tha, isliye "rate limit"/"unusual traffic" jaise shabd wala sawaal galat "blocked" hota tha | Sawaal ka text (whitespace normalize karke) aur `[data-message-role]` check se bahar |
| 8 | Medium | Block-check har text node ke saare parents par `getComputedStyle` chalata tha, isliye bade pages par har poll mein kai second lagte the | `checkVisibility()` aur per-element cache |
| 9 | Medium | Poll ek aise sub-locator par 6 second ruk jaata tha jo abhi render nahi hua tha; model label bhi 6 second | Pehle count check hota hai, evaluate par 3s timeout, model par 1.5s |
| 10 | Medium | Deadline par abort browser ko beech call mein band kar deta tha, isliye error galat aate the aur evidence nahi bachta tha | `deadlineAt` + soft deadline: loop 2.5s pehle saaf "timeout" ke saath ruk jaata hai |
| 11 | Medium | Text ke tukdon mein bante phrases ("Sign into *Copilot*") match nahi hote the | Matching se pehle whitespace normalize |
| 12 | Medium | Inline terms card ("By clicking 'Continue' you agree...") 90s timeout tak latakta tha | Turant consent wall ki tarah report hota hai (kabhi auto-accept nahi) |
| 13 | Medium | `npm run typecheck` purane `.tsbuildinfo` cache ki wajah se type errors chhupa leta tha | `tsc --noEmit --incremental false` |

### B. Browser setup (bot detection aur proxy)

| # | Severity | Bug | Fix |
|---|---|---|---|
| 14 | Critical | Fake `Chrome/122 Windows` user agent, jabki asli browser Linux par naya Chrome hai | Override hata diya |
| 15 | Critical | Headless mode (user agent mein khud "HeadlessChrome" likha hota hai) | Asli Google Chrome headed mode mein, Xvfb virtual display par, container ke andar. Kisi ki screen par kuch nahi khulta |
| 16 | Critical | `--disable-gpu` ki wajah se WebGL "SwiftShader" dikhta tha | Flag hata diya |
| 17 | Critical | "Stealth" script (`plugins=[1,2,3]`, `webdriver` override) ulta bot signal deta tha | Script hata diya |
| 18 | High | Timezone UTC, locale en-US, jabki proxy ka IP India ka hai | `BROWSER_TIMEZONE=Asia/Kolkata`, `BROWSER_LOCALE=en-IN` |
| 19 | High | Proxy chupchap optional tha, aur VPS IP se chalne par koi log nahi aata tha | `REQUIRE_PROXY`, aur startup par `browser_egress` log mein exit IP |
| 20 | High | `host:port` ya `user:pass@host:port` proxy URL par port/credentials gum ho jaate the, ya worker crash hota tha | Scheme apne aap judta hai, galat URL par saaf error |
| 21 | High | SOCKS proxy username/password ke saath Chromium mein chalta hi nahi | Saaf error message |
| 22 | High | Rotating proxy ka IP beech conversation mein badal jaata tha | `{session}` placeholder: har run ek sticky IP |
| 23 | High | `probe`/`inspect` production se alag browser setup use karte the | Teeno ek hi `launchContext()` use karte hain, aur `egressIp` print karte hain |
| 24 | High | Iframe ke andar ka Cloudflare/captcha challenge detect nahi hota tha | Frame URL check, Google `/sorry/` aur consent redirect URL check |

### C. Code audit mein mile (har finding 2 skeptics se verify)

| # | Severity | Bug | Fix |
|---|---|---|---|
| 25 | High | Cloudflare ka "Just a moment" page dikhte hi run "blocked" ho jaata tha. Asli browser mein ye page aksar 2-5s mein apne aap clear ho jaata hai | 15s grace wait (Google `/sorry/` par nahi). Challenge kabhi solve nahi kiya jaata, sirf intezaar |
| 26 | High | Ek hi saved Chrome profile mein users ke sawaal disk par rehte the (privacy). Saare users ek device identity share karte the, isliye rate-limit/sign-in wall kabhi clear nahi hoti. Crash ke baad bacha profile lock us provider ko hamesha tod deta | Har run ka naya throwaway profile, jo run ke baad delete hota hai. Crash ke bache profiles 1 ghante baad saaf ho jaate hain |
| 27 | High | 7 din baad checks delete hone par `usage_events` cascade se delete ho jaate the, isliye "5 free checks / 30 din" har hafte reset hota tha | FK ab `ON DELETE SET NULL` (idempotent migration) |
| 28 | High | CamelCase brand ("BigBasket") jab AI "Big Basket" likhta tha to "Not found" aata tha, aur brand khud competitor ban jaata tha | `brandMatches`: CamelCase split aur legal-suffix ("Pvt Ltd") forms, sirf whole-word aur case-sensitive |
| 29 | Medium | Abort ke baad Chrome band hone se pehle hi agla run shuru ho jaata tha | Ek shared close promise |
| 30 | Medium | Async "failed" listener ka error worker crash kar deta tha, aur failed job run ko dobara queue hone se rokta tha | Listener safe banaya, `removeOnFail: true`, aur crash mein atke `running` runs dobara queue hote hain |
| 31 | Medium | Startup browser probe fail hone par worker crash-loop karta tha, aur deadlines/cleanup bhi ruk jaate the | Probe ab non-fatal, aur deadlines/reconcile pehle start hote hain |
| 32 | Medium | Common-word guard sirf poore naam par lagta tha ("monday.com", "Apple Inc") | Har alias par guard |
| 33 | Medium | Answer mein "factors to consider" ki numbered list brand ki rank neeche kar deti thi | Criteria/attribute labels entities nahi bante |
| 34 | Medium | Bullet wale answers se entities nahi milti thi | Top-level bullets par "- " marker; bullets sirf fallback; "Best overall: X" se X entity banta hai |
| 35 | Medium | `safeFetch` ka DNS lookup Node 20+ par fail hota tha, isliye business-name auto-detect kabhi kaam nahi karta tha | Lookup ke dono callback forms support |
| 36 | Medium | VPS down ho to Vercel ka homepage aur result pages 500 dete the | `getToolConfig` fallback: page khulta hai, sources disabled dikhte hain, aur error log hota hai |
| 37 | Medium | Expired/deleted check link par polling kabhi nahi rukti thi | 404 par polling band |
| 38 | Low | Postgres restart par idle client ka error worker crash kar deta tha | `pool.on("error")` |
| 39 | Low | "we/our" warning "US" (United States) par bhi aata tha | Sirf lowercase "us" pronoun gina jaata hai |
| 40 | Low | Ek purana polling error check complete hone ke baad bhi screen par rehta tha | Agle successful poll par clear |
| 41 | Low | Follow-up GET fail hone par idempotency key reset nahi hoti thi, isliye agla batch purana check replay karta tha | Key POST ke turant baad reset |
| 42 | Low | CSV formula guard pehla character hata deta tha | Prefix lagta hai, character hat-ta nahi |
| 43 | Low | Data delete ke baad `usage_events.domain` mein brand ka naam plaintext mein rehta tha | Keyed HMAC store hota hai |
| 44 | Low | `BROWSER_DISABLED_PROVIDERS` mein spaces/case par provider band nahi hota tha | trim + lowercase |

### D. Deploy

| # | Bug | Fix |
|---|---|---|
| 45 | Xvfb ke ready hone se pehle Chrome launch ho sakta tha; restart par purana lock reh jaata tha | `deploy/worker-entrypoint.sh` display ka socket aane tak rukta hai, aur purana lock hata deta hai |
| 46 | Windows checkout par CRLF line endings aur exec bit kho jaana entrypoint tod deta | `.gitattributes` (`*.sh eol=lf`) aur `sh` se launch |
| 47 | `upgrade-vps.sh` local `internal-debug/` (page HTML) VPS par copy kar deta tha, aur naye env vars add nahi karta tha | Exclude kiya; naye browser vars sirf tab add hote hain jab missing hon, aur `REQUIRE_PROXY` tabhi true hota hai jab proxy set ho |

### E. Final diff review (poore v1.6 diff ka dobara audit, har finding 2 skeptics se verify)

| # | Severity | Bug | Fix |
|---|---|---|---|
| 48 | Medium | Proxy ka step main deploy guide mein tha hi nahi, aur warning ye nahi batati thi ki `.env` badalne ke baad container recreate karna padta hai | `START_HERE.md` aur deploy guide mein upgrade se pehle proxy step; warning mein sahi command |
| 49 | Medium | v1.6 frontend agar purane v1.5 VPS se baat kare to koi warning nahi aati thi, aur 2–4 sawaal wale batch reject hote | `BACKEND_CONTRACT`: mismatch par saare sources "Update the VPS to v1.6" ke saath disabled (test ke saath) |
| 50 | Medium | WebRTC/STUN UDP proxy ko bypass karke page ko VPS ka IP dikha sakta tha | Proxy set ho to `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` |
| 51 | Low | Google AI Mode mein sawaal URL ke `?q=` mein hota hai. Sawaal mein "hcaptcha.com" jaisa domain ho to galat "blocked" aata tha | Challenge check sirf host/path padhta hai, query nahi (test ke saath) |
| 52 | Low | v1.6 se pehle ke `usage_events` rows mein brand plaintext mein rehta tha, aur naya hashed cap unhe ginta nahi tha | Migration purane rows ko usi key se hash karti hai, aur dobara chalne par kuch nahi badalta (test ke saath) |
| 53 | Low | Kuch docs mein abhi bhi v1.5 ki baatein thi (25 runs, 39 min deadline) | `BUILD_BRIEF`, deploy guide aur `VERIFICATION` update |

## VPS par deploy

1. VPS ki `.env` mein proxy daalo (upgrade script `.env` ko chhoota nahi):
   ```
   RESIDENTIAL_PROXY_URL=http://USER-session-{session}:PASS@GATEWAY:PORT
   REQUIRE_PROXY=true
   ```
   `{session}` ka format proxy provider ke hisaab se hota hai (Bright Data `-session-`, Oxylabs `-sessid-`). Baaki browser settings upgrade script apne aap add kar dega.
2. `DoctorFizz_LLM_Visibility_Checker_v1_6.zip` VPS par upload karo, aur `START_HERE.md` ke steps se `deploy/upgrade-vps.sh` chalao. Pehli build mein Google Chrome install hone ki wajah se zyada time lagega.
3. Exit IP check karo. Ye VPS ka `187.127.186.47` **nahi** hona chahiye:
   ```bash
   docker compose -p doctorfizz-llm logs worker | grep browser_egress
   ```
4. Har source ka probe chalao:
   ```bash
   docker compose -p doctorfizz-llm exec -T worker npm run browser:probe -- --provider=chatgpt --submit
   ```
   Isi tarah `gemini` aur `google-ai` ke liye bhi. Fail ho to `-e BROWSER_DEBUG=1` lagakar dobara chalao; har poll log hoga aur `internal-debug/` mein screenshot + HTML save hoga.
5. Vercel par bhi yahi version deploy karo, kyunki UI ab 3 sources dikhata hai.

## Saaf baat

- Teeno sources residential IP par live chal gaye. VPS par sab kuch proxy ki quality par depend karta hai. Agar step 3 mein VPS ka IP aaye, to ChatGPT aur Google block karenge.
- Kuch IPs par Google ka `/sorry/` page phir bhi aa sakta hai (shared/flagged residential IPs). Code ise sahi "blocked" bata kar naye IP ke saath ek retry karta hai, lekin CAPTCHA kabhi solve nahi karta.
- ChatGPT aur Google apna UI badalte rehte hain. Selector toote to `browser:inspect` se naya DOM dekh kar `src/worker/browser.config.ts` update karna hoga.
