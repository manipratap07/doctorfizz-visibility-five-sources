import { Loader2, CheckCircle2, AlertCircle, Clock3 } from "lucide-react";
import type { Check, Run } from "@/lib/types";
const labels: Record<string, string> = {
  queued: "Queued",
  opening: "Opening browser",
  submitting: "Sending question",
  waiting: "Waiting for answer",
  collecting: "Collecting answer",
  analysing: "Saving evidence",
  completed: "Answer saved",
  failed: "Source unavailable",
};
function source(url: string) {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? u : null;
  } catch {
    return null;
  }
}
export default function BatchProgress({
  check,
  providers,
}: {
  check: Check;
  providers: { id: string; displayName: string }[];
}) {
  const total = check.runs.length;
  const finished = check.runs.filter(
    (r) => !["queued", "running"].includes(r.status),
  ).length;
  const captured = check.runs.filter((r) => r.status === "ok").length;
  const failed = finished - captured;
  const prompts = check.prompts?.length
    ? check.prompts
    : [
        {
          id: "legacy",
          index: 0,
          text: check.prompt_text,
          bias: !!check.prompt_bias,
        },
      ];
  const stage = (run: Run) =>
    run.status === "ok"
      ? "completed"
      : run.status === "queued"
        ? "queued"
        : run.status === "running"
          ? run.phase || "opening"
          : "failed";
  return (
    <section className="batch-progress" aria-label="Collection progress">
      <div className="batch-progress-head">
        <div>
          <span className="mono">LIVE COLLECTION</span>
          <h3>
            {check.status === "completed"
              ? "Collection finished"
              : "Collecting answers from your selected sources"}
          </h3>
        </div>
        <strong>
          {finished} / {total} finished
        </strong>
      </div>
      <div
        className="batch-track"
        role="progressbar"
        aria-label="Completed source runs"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={finished}
      >
        <span
          style={{ width: total ? `${(finished / total) * 100}%` : "0%" }}
        />
      </div>
      <p className="secondary" aria-live="polite">
        {captured} answers saved · {failed} unavailable · {total - finished}{" "}
        remaining
      </p>
      <details
        className="batch-progress-details"
        open={check.status !== "completed"}
      >
        <summary>Question and source statuses</summary>
        <div className="batch-source-grid">
          {prompts.map((prompt) => (
            <article key={prompt.id} className="batch-source-card">
              <h4>Question {prompt.index + 1}</h4>
              <p className="batch-question-preview" title={prompt.text}>
                {prompt.text}
              </p>
              <ul>
                {check.runs
                  .filter((r) => (r.prompt_index ?? 0) === prompt.index)
                  .map((run) => {
                    const provider = providers.find(
                      (p) => p.id === run.provider_id,
                    );
                    const phase = stage(run);
                    const url = source(run.source_url || "");
                    return (
                      <li key={run.id} data-phase={phase}>
                        <div className="source-status-icon">
                          {phase === "completed" ? (
                            <CheckCircle2 size={16} />
                          ) : phase === "failed" ? (
                            <AlertCircle size={16} />
                          ) : phase === "queued" ? (
                            <Clock3 size={16} />
                          ) : (
                            <Loader2 className="spin" size={16} />
                          )}
                        </div>
                        <div>
                          <b>{provider?.displayName || run.provider_id}</b>
                          <span>{labels[phase] || phase}</span>
                          <small>
                            {run.phase_message ||
                              run.reason ||
                              "Waiting for an available browser."}
                          </small>
                          {url && (
                            <a href={url.href} target="_blank" rel="noreferrer">
                              {url.hostname}
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}
