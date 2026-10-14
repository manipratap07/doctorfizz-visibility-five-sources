"use client";
import { SharedHeader, SharedFooter } from "./SharedChrome";
import BatchProgress from "./BatchProgress";
import SharedLanding, { Stack } from "./SharedLanding";
import { track } from "./events";
import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Check as CheckIcon,
  Copy,
  Download,
  Globe,
  Search,
  Radio,
  ChevronDown,
  X,
  Loader2,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import type { Brand, SiteProfile, Check, Run } from "@/lib/types";
import { summarize } from "@/lib/analysis";
import { weights } from "@/lib/scoring.config";
type Provider = {
  id: string;
  displayName: string;
  tier: string;
  webSearch: boolean;
  configured?: boolean;
  enabled?: boolean;
  readiness?: string;
  reason?: string;
};
declare global {
  interface Window {
    DFMotion?: {
      openModal: (element: HTMLElement) => void;
      revealResult: (
        result: HTMLElement,
        summary: HTMLElement | null,
        rows: HTMLElement | null,
      ) => void;
      scrollToTool: (element: HTMLElement) => void;
    };
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}
const faq = [
  [
    "What does this check measure?",
    "It sends your five questions to the selected chatbot websites in fresh browser sessions and collects their visible answers, recommendations and citations.",
  ],
  [
    "Is this the same as using each consumer AI app?",
    "These are public, logged-out browser snapshots. Free access can change or require login. The tool captures only completed answers; it reports blocked sessions separately.",
  ],
  [
    "Can I write any five questions?",
    "Yes. Write five questions with 8 to 1,000 characters each. Company references such as ‘we’ and ‘our company’ use your business profile and are labelled direct brand queries. General recommendation questions run without adding your brand.",
  ],
  [
    "What happens if a provider fails?",
    "It is marked unavailable and excluded from the score. If all selected providers fail, the check is refunded automatically.",
  ],
  [
    "How do the five free checks work?",
    "One batch of five questions across your selected providers counts as one check. You receive five checks per 30-day visitor window, with additional daily limits to protect the free tool.",
  ],
  [
    "Are these permanent rankings?",
    "No. Each answer is a snapshot. A different prompt, model, search state or date can produce a different result.",
  ],
  [
    "Can I see or export the evidence?",
    "Yes. Open any completed response to read the exact answer, citations, model, timestamp and browser evidence. You can also export a CSV.",
  ],
];
async function api(path: string, data?: unknown) {
  const r = await fetch(path, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(
      `The service returned an unreadable response (HTTP ${r.status}). Please try again shortly.`,
    );
  }
  if (!r.ok) throw new Error(j.error || "Request could not be completed.");
  return j;
}
const short = (p: Provider) => p.displayName.split(" · ")[0];
function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (s: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<string | undefined>(undefined);
  const render = () => {
    if (window.turnstile && ref.current && !id.current)
      id.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: "dark",
        action: "visibility",
        callback: onToken,
        "expired-callback": () => onToken(""),
      });
  };
  useEffect(() => {
    render();
    return () => {
      if (id.current) window.turnstile?.remove(id.current);
    };
  }, [siteKey]);
  if (!siteKey)
    return <p className="note">Live checks are awaiting verification setup.</p>;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={render}
      />
      <div ref={ref} />
    </>
  );
}
function Highlight({ text, brand }: { text: string; brand: Brand }) {
  const names = [brand.name, ...brand.aliases]
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!names.length) return <>{text}</>;
  const regex = new RegExp("(" + names.join("|") + ")", "gi");
  return (
    <>
      {text
        .split(regex)
        .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}
export default function Tool({
  providers,
  turnstileKey,
  initialCheckId,
}: {
  providers: Provider[];
  turnstileKey: string;
  initialCheckId?: string;
}) {
  const [url, setUrl] = useState(""),
    [name, setName] = useState(""),
    [location, setLocation] = useState(""),
    [alias, setAlias] = useState("");
  const [profile, setProfile] = useState<SiteProfile | null>(null),
    [profileId, setProfileId] = useState(""),
    [brand, setBrand] = useState<Brand | null>(null),
    [promptTexts, setPromptTexts] = useState<string[]>(Array(5).fill(""));
  const [resultPrompt, setResultPrompt] = useState(0);
  const [chosen, setChosen] = useState(
      providers
        .filter(
          (p) =>
            p.enabled !== false &&
            p.configured !== false &&
            !["blocked", "rate_limited", "error", "timeout"].includes(
              p.readiness || "",
            ),
        )
        .map((p) => p.id),
    ),
    [token, setToken] = useState(""),
    [left, setLeft] = useState<number | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [check, setCheck] = useState<Check | null>(null),
    [watchId, setWatchId] = useState(initialCheckId || ""),
    [drawer, setDrawer] = useState<Run | null>(null),
    [scoring, setScoring] = useState(false),
    [leadSent, setLeadSent] = useState(false),
    [cookie, setCookie] = useState(true);
  const resultsRef = useRef<HTMLElement>(null),
    promptRef = useRef<HTMLElement>(null),
    modalRef = useRef<HTMLDivElement>(null),
    requestKey = useRef<string>("");
  const [allowanceFailed, setAllowanceFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const completionTracked = useRef("");
  useEffect(() => {
    if (left === 0) track("limit_reached");
  }, [left]);
  const active = !!check && check.status !== "completed";
  useEffect(() => {
    setHydrated(true);
    window.dispatchEvent(new Event("df:mount"));
    try {
      setCookie(sessionStorage.getItem("df_visibility_notice") !== "1");
    } catch {}
    api("/api/usage")
      .then((j) => {
        setLeft(j.attemptsLeft);
        setAllowanceFailed(false);
      })
      .catch((e) => {
        setAllowanceFailed(true);
        setError(e.message);
      });
    return () => {
      window.dispatchEvent(new Event("df:unmount"));
    };
  }, []);
  useEffect(() => {
    if (!watchId) return;
    let cancelled = false;
    let finished = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const update = (c: Check) => {
      if (cancelled) return;
      setCheck(c);
      if (c.status === "completed") {
        finished = true;
        if (completionTracked.current !== c.id) {
          completionTracked.current = c.id;
          track("check_completed");
        }
        if (poll) clearTimeout(poll);
        api("/api/usage")
          .then((j) => setLeft(j.attemptsLeft))
          .catch(() => {});
        setBusy("");
      }
    };
    const refresh = async () => {
      try {
        update(await api("/api/checks/" + watchId));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled && !finished) poll = setTimeout(refresh, 2500);
    };
    void refresh();
    return () => {
      cancelled = true;
      if (poll) clearTimeout(poll);
    };
  }, [watchId]);
  useEffect(() => {
    if (!drawer && !scoring) return;
    if (modalRef.current) window.DFMotion?.openModal(modalRef.current);
    const previous = document.activeElement as HTMLElement;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(null);
        setScoring(false);
      }
      if (e.key === "Tab") {
        const nodes = modalRef.current?.querySelectorAll<HTMLElement>(
          'button,a,[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", close);
    modalRef.current?.querySelector<HTMLElement>("button")?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [drawer, scoring]);
  useEffect(() => {
    window.dispatchEvent(new Event("df:layout"));
  }, [profile, check?.id, left]);
  useEffect(() => {
    if (
      check?.id &&
      resultsRef.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      window.DFMotion?.revealResult(resultsRef.current, null, null);
  }, [check?.id]);
  function scrollTo(el: HTMLElement | null) {
    if (!el) return;
    if (window.DFMotion) window.DFMotion.scrollToTool(el);
    else
      el.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  }
  async function prefillBrand() {
    if (!url || name) return;
    try {
      const j = await api("/api/site/title", { url });
      setName((current) => current || j.name || "");
    } catch {
      /* Optional title detection must not block manual input. */
    }
  }
  async function analyzeSite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("Preparing your business profile");
    setError("");
    setNotice("");
    try {
      const j = await api("/api/site/analyze", {
        url,
        name,
        location,
        aliases: alias
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      track("site_analyzed");
      setCheck(null);
      setWatchId("");
      setProfile(j.profile);
      setProfileId(j.profileId);
      setBrand(j.brand);
      setResultPrompt(0);
      setNotice(j.languageNote || j.note || "");
      requestKey.current = "";
      setTimeout(() => scrollTo(promptRef.current), 100);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function run() {
    setBusy("Preparing your five-question batch");
    setError("");
    try {
      requestKey.current ||= crypto.randomUUID();
      if (promptTexts.some((text) => text.trim().length < 8))
        throw new Error(
          "Enter all five questions, with at least 8 characters each.",
        );
      const j = await api("/api/checks", {
        profileId,
        prompts: promptTexts.map((text) => text.trim()),
        providers: chosen,
        turnstileToken: token,
        idempotencyKey: requestKey.current,
      });
      track("check_started");
      setLeft(j.attemptsLeft);
      setWatchId(j.checkId);
      setCheck(await api("/api/checks/" + j.checkId));
      window.history.replaceState({}, "", "/?check=" + j.checkId);
      requestKey.current = "";
      window.turnstile?.reset();
      setToken("");
      setTimeout(() => scrollTo(resultsRef.current), 100);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied.");
    } catch {
      setNotice("Your browser could not copy this text.");
    }
  }
  const summary = check ? summarize(check.runs) : null;
  const ok = check?.runs.filter((r) => r.status === "ok") || [];
  const positions = ok.flatMap((r) =>
    r.analysis?.position ? [r.analysis.position] : [],
  );
  const competitors = new Map<
    string,
    { name: string; providers: Set<string> }
  >();
  ok.forEach((r) =>
    r.analysis?.competitors.forEach((e) => {
      const key = e.name.toLowerCase();
      const value = competitors.get(key) || {
        name: e.name,
        providers: new Set<string>(),
      };
      value.providers.add(r.provider_id);
      competitors.set(key, value);
    }),
  );
  const repeatStats = new Map<string, { ok: number; mentioned: number }>();
  ok.forEach((r) => {
    const stats = repeatStats.get(r.provider_id) || { ok: 0, mentioned: 0 };
    stats.ok++;
    if (r.analysis?.mentioned) stats.mentioned++;
    repeatStats.set(r.provider_id, stats);
  });
  const repeated = !!check && check.runs.some((r) => r.repeat_index > 0);
  const complete = check?.status === "completed";
  const uniqueOk = new Set(ok.map((r) => r.provider_id));
  const uniqueVisible = new Set(
    ok.filter((r) => r.analysis?.mentioned).map((r) => r.provider_id),
  );
  return (
    <>
      <a href="#tool" className="skip">
        Skip to the tool
      </a>
      <SharedHeader />
      <Script src="/reference/js/bootstrap.js" strategy="afterInteractive" />
      <main data-ready={hydrated}>
        {cookie && (
          <div className="cookie">
            <p>
              We use an essential cookie to keep your free-check allowance.{" "}
              <Link href="/privacy">Details</Link>
            </p>
            <button
              aria-label="Dismiss cookie notice"
              onClick={() => {
                setCookie(false);
                try {
                  sessionStorage.setItem("df_visibility_notice", "1");
                } catch {}
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        <section className="hero" id="tool">
          <canvas id="hero-canvas" aria-hidden="true" />
          <div className="hero-glow" aria-hidden="true" />
          <div className="shell hero-in">
            <div className="hero-copy">
              <p className="kicker" data-kicker>
                <span className="dot" aria-hidden="true" />
                Free LLM visibility checker
              </p>
              <Stack first="WHERE DOES" last="AI SEE YOU?" level={1} />
              <p className="hero-description" data-deck>
                One brand. Five questions from you. See which AI providers name
                you, which competitors they recommend and the evidence behind
                every answer.
              </p>
              <dl className="facts" data-facts>
                {[
                  ["Free checks", 5],
                  ["AI providers", providers.length],
                  ["Your questions", 5],
                  ["Signup fields", 0],
                ].map(([label, n]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd data-count={n}>{n}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div
              className={"input-panel" + (busy ? " busy" : "")}
              id="tool-card"
            >
              <div className="tool-top">
                <h2>Check your brand</h2>
                <span className="allowance">
                  <i />
                  {left === null
                    ? "Checking allowance"
                    : `${left} checks remaining`}
                </span>
              </div>
              {error && !profile && (
                <p className="error tool-error" role="alert">
                  {error}
                </p>
              )}
              {notice && !profile && (
                <p className="note" role="status">
                  {notice}
                </p>
              )}
              <form onSubmit={analyzeSite}>
                <label>
                  Website URL
                  <div className="input-icon">
                    <Globe size={17} />
                    <input
                      autoComplete="url"
                      aria-label="Website URL"
                      placeholder="yourwebsite.com"
                      value={url}
                      onBlur={prefillBrand}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </div>
                </label>
                <label>
                  Brand / company name
                  <input
                    minLength={2}
                    maxLength={100}
                    autoComplete="organization"
                    placeholder="The name customers know"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <div className="field-row">
                  <label>
                    Country or city <span>Optional</span>
                    <input
                      maxLength={100}
                      placeholder="e.g. Bengaluru, India"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </label>
                  <label>
                    Brand aliases <span>Optional</span>
                    <input
                      placeholder="Acme, AcmeCloud"
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="primary wide"
                  disabled={!!busy || active}
                  type="submit"
                >
                  {busy && !active ? (
                    <>
                      <Loader2 className="spin" size={17} />
                      {busy}
                    </>
                  ) : (
                    <>
                      Analyse my brand
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </form>
              <p className="footnote">
                <ShieldCheck size={14} /> Site analysis does not use a free
                check.
              </p>
              <div className="input-bottom">
                <span className="mono">REAL RESPONSES. TRACEABLE SOURCES.</span>
                <div className="meter">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </div>
        </section>
        {busy && !profile && (
          <section className="wrap analysis-loading" role="status">
            <div className="kicker">
              <Loader2 size={14} className="spin" />
              READING YOUR WEBSITE
            </div>
            <p className="secondary">
              Preparing your business profile for your five questions.
            </p>
            <div className="skeleton-row">
              <i />
              <i />
              <i />
            </div>
          </section>
        )}
        <div className="wrap notices" aria-live="polite">
          {error && profile && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && profile && <p className="note">{notice}</p>}
        </div>
        {profile && (
          <section className="wrap workspace" ref={promptRef}>
            <div className="section-top">
              <div>
                <div className="kicker">02 / WRITE YOUR FIVE QUESTIONS</div>
                <h2>
                  Your questions.
                  <br />
                  <span className="gradient">Real browser answers.</span>
                </h2>
              </div>
              <p className="secondary">
                Enter five questions in your own words.
                <br />
                Each one runs across the sources you select below.
              </p>
            </div>
            <div className="batch-prompt-inputs">
              {promptTexts.map((text, index) => (
                <label
                  className="batch-prompt-field"
                  key={index}
                  htmlFor={`batch-prompt-${index}`}
                >
                  <span className="batch-field-head">
                    <b>Question {index + 1}</b>
                    <small>{text.length}/1,000</small>
                  </span>
                  <textarea
                    id={`batch-prompt-${index}`}
                    rows={3}
                    minLength={8}
                    maxLength={1000}
                    disabled={active || !!busy}
                    value={text}
                    placeholder={`Write question ${index + 1} for the selected AI sources…`}
                    onChange={(e) => {
                      setPromptTexts((values) =>
                        values.map((value, i) =>
                          i === index ? e.target.value : value,
                        ),
                      );
                      requestKey.current = "";
                    }}
                    aria-describedby={`question-hint-${index}`}
                  />
                  <span
                    id={`question-hint-${index}`}
                    className="batch-field-hint"
                  >
                    {text.trim().length > 0 && text.trim().length < 8
                      ? "Add a little more detail: at least 8 characters."
                      : "Company references such as ‘we’ use your business profile."}
                  </span>
                </label>
              ))}
            </div>
            <p className="secondary batch-input-note">
              Questions that name your brand or refer to your company use your
              business profile and are marked as direct brand queries. General
              recommendation questions run without adding your brand.
            </p>
            <div className="selection-head">
              <div>
                <div className="kicker">03 / SELECT YOUR PROVIDERS</div>
                <h3>Who should answer?</h3>
              </div>
              <div className="select-actions">
                <button
                  disabled={active || !!busy}
                  onClick={() =>
                    setChosen(
                      providers
                        .filter(
                          (p) => p.enabled !== false && p.configured !== false,
                        )
                        .map((p) => p.id),
                    )
                  }
                >
                  Select all
                </button>
                <span>/</span>
                <button
                  disabled={active || !!busy}
                  onClick={() => setChosen([])}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="providers">
              {providers.map((p) => (
                <button
                  className={
                    "llm-chip " + (chosen.includes(p.id) ? "selected" : "")
                  }
                  key={p.id}
                  disabled={
                    active ||
                    !!busy ||
                    p.enabled === false ||
                    p.configured === false
                  }
                  title={p.reason || "Public browser session"}
                  aria-disabled={p.enabled === false}
                  aria-pressed={chosen.includes(p.id)}
                  onClick={() => {
                    setChosen(
                      chosen.includes(p.id)
                        ? chosen.filter((id) => id !== p.id)
                        : [...chosen, p.id],
                    );
                    requestKey.current = "";
                  }}
                >
                  <span className="provider-logo">{short(p).slice(0, 2)}</span>
                  <span>
                    <b>{short(p)}</b>
                    <small>
                      {p.enabled === false
                        ? "Disabled"
                        : p.readiness === "ready"
                          ? "Last browser check passed"
                          : p.readiness === "not_tested" || !p.readiness
                            ? "Browser access not tested"
                            : `Last check: ${p.readiness.replaceAll("_", " ")}`}
                    </small>
                  </span>
                  <span className="checkbox">
                    {chosen.includes(p.id) && <CheckIcon size={13} />}
                  </span>
                </button>
              ))}
            </div>
            <p className="note">
              Each question opens a fresh browser session on each selected site.
              Finished answers appear as they are collected.
            </p>
            <div className="run-bar">
              <div>
                <b>
                  {left === null
                    ? allowanceFailed
                      ? "Allowance unavailable"
                      : "Checking allowance…"
                    : `${left} of 5 free checks left`}
                </b>
                <p className="secondary">
                  Five questions × {chosen.length} sources = {5 * chosen.length}{" "}
                  browser runs. One batch uses one free check.
                </p>
              </div>
              <div className="run-controls">
                {turnstileKey && (
                  <Turnstile siteKey={turnstileKey} onToken={setToken} />
                )}
                <button
                  className="primary"
                  disabled={
                    active ||
                    !!busy ||
                    !chosen.length ||
                    promptTexts.some((text) => text.trim().length < 8) ||
                    left === 0 ||
                    (!!turnstileKey && !token)
                  }
                  onClick={run}
                >
                  {active ? (
                    <>
                      <Loader2 size={17} className="spin" />
                      Reading answers
                    </>
                  ) : (
                    <>
                      Run my five questions
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </div>
            </div>
            <p className="footnote">
              Batches can take several minutes. Progress stays linked to this
              result URL. Sources that block access are reported separately.
            </p>
          </section>
        )}
        {check && (
          <section className="wrap results" ref={resultsRef} aria-live="polite">
            <div className="section-top">
              <div>
                <div className="kicker">04 / YOUR VISIBILITY READOUT</div>
                <h2>{check.brand.name || "Deleted check"}</h2>
                <p className="secondary">{check.brand.domain}</p>
              </div>
              <span className={"tiny-badge " + (complete ? "success" : "")}>
                {complete ? "CHECK COMPLETE" : "READING THE SIGNAL"}
              </span>
            </div>
            <BatchProgress check={check} providers={providers} />
            <p className="batch-summary-note">
              Overall readout across your questions.{" "}
              {check.prompt_bias
                ? "This batch includes direct brand queries; use the question tabs to compare their answers separately."
                : "Failed sources are excluded from the score."}
            </p>
            <div className="summary">
              <div
                className="score-ring"
                style={
                  {
                    "--score": `${(summary?.score || 0) * 3.6}deg`,
                  } as React.CSSProperties
                }
              >
                <div>
                  <strong>{summary?.score ?? "—"}</strong>
                  <span>{summary?.label}</span>
                </div>
              </div>
              <div className="summary-data">
                <div className="mono">OBSERVED AI VISIBILITY</div>
                <h3>
                  Visible on{" "}
                  <span>
                    {uniqueVisible.size} of {uniqueOk.size}
                  </span>{" "}
                  providers
                </h3>
                <div className="metrics">
                  <div>
                    <b>
                      {positions.length
                        ? (
                            positions.reduce((a, b) => a + b, 0) /
                            positions.length
                          ).toFixed(1)
                        : "—"}
                    </b>
                    <span>Average position</span>
                  </div>
                  <div>
                    <b>
                      {
                        new Set(
                          ok
                            .filter((r) => r.analysis?.cited)
                            .map((r) => r.provider_id),
                        ).size
                      }
                    </b>
                    <span>Providers citing you</span>
                  </div>
                  <div>
                    <b>
                      {
                        check.runs.filter(
                          (r) =>
                            !["ok", "queued", "running"].includes(r.status),
                        ).length
                      }
                    </b>
                    <span>Unavailable runs</span>
                  </div>
                </div>
                <button
                  className="text-button"
                  onClick={() => setScoring(true)}
                >
                  How we score <ArrowUpRight size={14} />
                </button>
              </div>
            </div>
            <div
              className="batch-result-tabs"
              role="tablist"
              aria-label="Question results"
            >
              {(check.prompts?.length
                ? check.prompts
                : [
                    {
                      id: "legacy",
                      index: 0,
                      text: check.prompt_text,
                      bias: !!check.prompt_bias,
                    },
                  ]
              ).map((prompt) => (
                <button
                  type="button"
                  key={prompt.id}
                  role="tab"
                  id={`question-tab-${prompt.index}`}
                  aria-selected={resultPrompt === prompt.index}
                  aria-controls="question-results"
                  tabIndex={resultPrompt === prompt.index ? 0 : -1}
                  onClick={() => setResultPrompt(prompt.index)}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      const count = check.prompts?.length || 1;
                      const next =
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? count - 1
                            : (resultPrompt +
                                (e.key === "ArrowRight" ? 1 : -1) +
                                count) %
                              count;
                      setResultPrompt(next);
                      document.getElementById(`question-tab-${next}`)?.focus();
                    }
                  }}
                >
                  Question {prompt.index + 1}
                  <span>
                    {
                      check.runs.filter(
                        (r) =>
                          (r.prompt_index ?? 0) === prompt.index &&
                          r.status === "ok",
                      ).length
                    }{" "}
                    answers
                  </span>
                </button>
              ))}
            </div>
            <div className="used-prompt">
              <span className="mono">QUESTION {resultPrompt + 1}</span>
              <p>{check.prompts?.[resultPrompt]?.text || check.prompt_text}</p>
              <button
                className="icon-button"
                aria-label="Copy tested question"
                onClick={() =>
                  copy(check.prompts?.[resultPrompt]?.text || check.prompt_text)
                }
              >
                <Copy size={15} />
              </button>
            </div>
            {(check.prompts?.[resultPrompt]?.bias ?? check.prompt_bias) && (
              <p className="batch-summary-note">
                Direct brand query: this question names your business or uses
                your business profile. Compare it separately from unaided
                discovery.
              </p>
            )}
            <div
              className="result-list"
              role="tabpanel"
              id="question-results"
              aria-labelledby={`question-tab-${resultPrompt}`}
            >
              {check.runs
                .filter((r) => (r.prompt_index ?? 0) === resultPrompt)
                .map((r) => {
                  const p = providers.find((p) => p.id === r.provider_id);
                  const pending = ["queued", "running"].includes(r.status);
                  const found = r.analysis?.mentioned;
                  const label = pending
                    ? r.status === "running"
                      ? r.phase_message || "Opening browser"
                      : "Queued"
                    : r.status !== "ok"
                      ? "Unavailable"
                      : found
                        ? r.analysis?.position
                          ? `Visible #${r.analysis.position}`
                          : "Mentioned · unranked"
                        : "Not found";
                  return (
                    <div className="result-row" key={r.id}>
                      <span className="provider-logo">
                        {p ? short(p).slice(0, 2) : "AI"}
                      </span>
                      <div className="result-name">
                        <b>{p ? short(p) : r.provider_id}</b>
                        <small>
                          {r.model_reported || "Model not reported"}
                          {repeated
                            ? ` · Run ${r.repeat_index + 1} · Mentioned in ${repeatStats.get(r.provider_id)?.mentioned || 0} of ${repeatStats.get(r.provider_id)?.ok || 0} successful runs`
                            : ""}
                        </small>
                      </div>
                      <span
                        className={
                          "result-status " +
                          (r.status === "ok" && found
                            ? "success"
                            : pending
                              ? "pending"
                              : "")
                        }
                      >
                        {pending && <Loader2 size={13} className="spin" />}
                        {label}
                      </span>
                      <div className="result-evidence">
                        {r.status === "ok" ? (
                          <>
                            <span>
                              {r.analysis?.cited
                                ? "Domain cited"
                                : "Domain not cited"}
                            </span>
                            <small>
                              {r.analysis?.sentiment || "neutral"}
                              {r.analysis?.position
                                ? ` · #${r.analysis.position} of ${r.analysis.totalEntities}`
                                : ""}
                            </small>
                          </>
                        ) : (
                          <small>
                            {r.reason || "Waiting for the provider"}
                          </small>
                        )}
                      </div>
                      <button
                        className="secondary-button"
                        disabled={!r.answer_text}
                        onClick={() => setDrawer(r)}
                      >
                        View response
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  );
                })}
            </div>
            {check.refunded && (
              <p className="note">
                No provider returned a usable answer. Your free check was
                refunded.
              </p>
            )}
            {competitors.size > 0 && (
              <div className="competitors">
                <div>
                  <div className="kicker">ALSO IN THE ANSWER</div>
                  <h3>The brands appearing alongside you.</h3>
                </div>
                <div>
                  {[...competitors.values()]
                    .sort((a, b) => b.providers.size - a.providers.size)
                    .slice(0, 10)
                    .map((c, i) => (
                      <div className="competitor" key={c.name}>
                        <span className="mono">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <b>{c.name}</b>
                        <span>
                          {c.providers.size} provider
                          {c.providers.size === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
            <div className="result-actions">
              <button
                className="primary"
                disabled={!complete || left === 0}
                onClick={() => {
                  setWatchId("");
                  setCheck(null);
                  setBusy("");
                  window.history.replaceState({}, "", "/");
                  scrollTo(promptRef.current);
                }}
              >
                Run another batch
                <ArrowRight size={16} />
              </button>
              <a
                className="secondary-button"
                href={"/api/checks/" + check.id + "/export.csv"}
              >
                <Download size={15} />
                Export CSV
              </a>
              <button
                className="secondary-button"
                onClick={() =>
                  copy(
                    `${check.brand.name}: ${summary?.score ?? "unavailable"}/100 across ${check.prompts?.length || 1} questions. Captured ${check.created_at}. Public browser snapshot, not a permanent ranking.`,
                  )
                }
              >
                <Copy size={15} />
                Copy summary
              </button>
            </div>
            <p className="footnote">
              AI answers change over time. This is a snapshot taken on{" "}
              {new Date(check.created_at).toLocaleString()}. Results are
              retained for seven days.
            </p>
          </section>
        )}
        {left === 0 && (!check || complete) && (
          <section className="wrap lead-panel">
            <div>
              <div className="kicker">YOU HAVE THE FIRST SIGNAL</div>
              <h2>
                Now find
                <br />
                <span className="gradient">the next move.</span>
              </h2>
              <p className="secondary">
                Your five checks are complete. Request a full LLM visibility
                audit to examine more prompts and the gaps worth fixing.
              </p>
            </div>
            {leadSent ? (
              <p role="status">
                Request received. Your details have been saved for the
                DoctorFizz team.
              </p>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  try {
                    await api("/api/leads", {
                      name: f.get("name"),
                      email: f.get("email"),
                      phone: f.get("phone"),
                      consent: f.get("consent") === "on",
                    });
                    setLeadSent(true);
                    track("lead_submitted");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label>
                  Name
                  <input name="name" required autoComplete="name" />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  Phone <span>Optional</span>
                  <input name="phone" autoComplete="tel" />
                </label>
                <label className="consent">
                  <input type="checkbox" name="consent" required />I agree to be
                  contacted about this audit.{" "}
                  <Link href="/privacy">Privacy policy</Link>
                </label>
                <button className="primary wide">
                  Get a full visibility audit
                  <ArrowRight size={17} />
                </button>
              </form>
            )}
          </section>
        )}
        <SharedLanding faq={faq} />
      </main>
      <SharedFooter />
      {(drawer || scoring) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDrawer(null);
            setScoring(false);
          }}
        >
          <div
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            ref={modalRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <h2 id="drawer-title">
                {scoring
                  ? "How we score"
                  : providers.find((p) => p.id === drawer?.provider_id)
                      ?.displayName + " response"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => {
                  setDrawer(null);
                  setScoring(false);
                }}
              >
                <X />
              </button>
            </div>
            {scoring ? (
              <>
                <p>
                  The overall score is the mean of successful runs. Failed runs
                  are excluded. This is a diagnostic score, not a provider
                  ranking.
                </p>
                <dl className="metadata">
                  <dt>Brand mentioned</dt>
                  <dd>+{weights.mention}</dd>
                  <dt>Position bonus</dt>
                  <dd>
                    #1 +40 · #2 +32 · #3 +26 · #4 +20 · #5 +15 · lower or
                    unordered +10
                  </dd>
                  <dt>Domain cited</dt>
                  <dd>+15</dd>
                  <dt>Sentiment</dt>
                  <dd>Positive +5 · neutral +2 · negative +0</dd>
                </dl>
                <p>
                  No mention scores 0. Maximum 100. Strong 70+, moderate 40–69,
                  weak 1–39.
                </p>
              </>
            ) : (
              drawer && (
                <>
                  <dl className="metadata">
                    <dt>Model reported</dt>
                    <dd>
                      {drawer.model_reported || "Not shown in the browser"}
                    </dd>
                    <dt>Search observed</dt>
                    <dd>
                      {drawer.web_search_used
                        ? "Used"
                        : "Not confirmed / knowledge only"}
                    </dd>
                    <dt>Captured</dt>
                    <dd>
                      {new Date(
                        drawer.completed_at || drawer.created_at,
                      ).toLocaleString()}
                    </dd>
                    <dt>Cache</dt>
                    <dd>
                      {drawer.from_cache
                        ? `Cached · ${Math.max(0, (Date.now() - new Date(drawer.cache_created_at || drawer.created_at).getTime()) / 3600000).toFixed(1)} hours old`
                        : "Fresh response"}
                    </dd>
                    <dt>Provider latency</dt>
                    <dd>{drawer.latency_ms} ms</dd>
                  </dl>
                  {(drawer.prompt_bias ?? check?.prompt_bias) && (
                    <p className="note">
                      Direct brand query: the question names your business or
                      uses your business profile. Compare it separately from
                      unaided discovery.
                    </p>
                  )}
                  {drawer.browser_evidence?.pageUrl && (
                    <div className="note">
                      <p>
                        Browser source:{" "}
                        <a
                          href={drawer.browser_evidence.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {drawer.browser_evidence.pageUrl}
                        </a>
                      </p>
                      <p>
                        {drawer.browser_evidence.capturedAt} ·{" "}
                        {drawer.browser_evidence.captureMethod}
                      </p>
                      <p style={{ overflowWrap: "anywhere" }}>
                        Answer SHA-256: {drawer.browser_evidence.answerHash}
                      </p>
                    </div>
                  )}
                  <h3>Question {(drawer.prompt_index ?? 0) + 1}</h3>
                  <p className="drawer-question">
                    {drawer.prompt_text || check?.prompt_text}
                  </p>
                  <h3>Captured answer</h3>
                  <pre className="raw-answer">
                    <Highlight
                      text={drawer.answer_text || ""}
                      brand={check!.brand}
                    />
                  </pre>
                  <h3>Citations</h3>
                  {drawer.citations.length ? (
                    drawer.citations.map((c) => (
                      <a
                        className="citation"
                        href={c.url}
                        key={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Globe size={15} />
                        <span>
                          {c.title || c.domain}
                          <small>{c.url}</small>
                        </span>
                        <ExternalLink size={13} />
                      </a>
                    ))
                  ) : (
                    <p className="secondary">
                      No citations were returned by this provider.
                    </p>
                  )}
                </>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
