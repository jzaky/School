"use client";
import * as React from "react";
import Link from "next/link";
import { CHECKER_QUESTIONS, checkerSummaryText, scoreChecker, type CheckerAnswer } from "@aegis/core/audit/checker";

const ANSWERS: { value: CheckerAnswer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "partial", label: "Partly" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

const LEVEL_COPY: Record<string, { title: string; body: string }> = {
  starting: { title: "Starting", body: "Most of the basic controls are missing or unknown. The first three gaps below are the ones that stop an agent doing damage; start there." },
  developing: { title: "Developing", body: "The foundations exist but there are gaps a regulator or auditor would ask about. Close the weakest answers first; most of them are a policy and a control point, not a project." },
  established: { title: "Established", body: "The controls an auditor expects are in place. The remaining work is keeping evidence current and reviewing limits when agents change." },
};

/**
 * Runs entirely in the browser. Answers never leave the page: no request, no storage, no cookie.
 */
export function GovernanceChecker() {
  const [answers, setAnswers] = React.useState<Partial<Record<string, CheckerAnswer>>>({});
  const [copied, setCopied] = React.useState(false);
  const result = React.useMemo(() => scoreChecker(answers), [answers]);
  const started = result.answered > 0;
  const complete = result.answered === result.total;
  const resultsRef = React.useRef<HTMLDivElement>(null);

  function set(id: string, v: CheckerAnswer) {
    setAnswers((a) => ({ ...a, [id]: v }));
    setCopied(false);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(checkerSummaryText(result, answers));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mk-checker" data-testid="governance-checker">
      <ol className="space-y-4">
        {CHECKER_QUESTIONS.map((q, i) => (
          <li key={q.id} className="rounded-xl border border-(--mk-line) bg-(--mk-bg-2) p-4 md:p-5">
            <fieldset>
              <legend className="text-base font-medium text-(--mk-fg)">
                <span className="me-2 inline-block w-6 shrink-0 text-(--mk-muted)">{i + 1}.</span>
                {q.text}
              </legend>
              <p className="mt-1 ps-8 text-sm text-(--mk-muted)">{q.help}</p>
              <div className="mt-3 flex flex-wrap gap-2 ps-8" role="radiogroup" aria-label={`Answer to question ${i + 1}`}>
                {ANSWERS.map((a) => {
                  const on = answers[q.id] === a.value;
                  return (
                    <button key={a.value} type="button" role="radio" aria-checked={on} onClick={() => set(q.id, a.value)} className={`mk-btn mk-btn-sm ${on ? "mk-btn-primary" : "mk-btn-secondary"}`} data-answer={a.value}>
                      {a.label}
                    </button>
                  );
                })}
              </div>
              {answers[q.id] && answers[q.id] !== "yes" ? (
                <p className="mt-3 ps-8 text-sm text-(--mk-fg)">
                  <span className="text-(--mk-muted)">What AEGIS does here: </span>
                  {q.aegis}
                </p>
              ) : null}
            </fieldset>
          </li>
        ))}
      </ol>

      <div ref={resultsRef} className="mt-8 rounded-xl border border-(--mk-line) bg-(--mk-bg-2) p-5 md:p-6" aria-live="polite" data-testid="checker-results">
        {!started ? (
          <p className="text-sm text-(--mk-muted)">Answer the questions above. The score and the framework coverage appear here as you go. Nothing you enter leaves your browser.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm text-(--mk-muted)">{complete ? "Your self-check" : `Your self-check so far (${result.answered} of ${result.total} answered)`}</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                  <span className="text-4xl font-semibold tabular-nums text-(--mk-fg)" data-testid="checker-score">
                    {result.score}
                  </span>
                  <span className="text-(--mk-muted)">of 100</span>
                  <span className="rounded-md border border-(--mk-line) px-2 py-0.5 text-sm text-(--mk-fg)" data-testid="checker-level">
                    {LEVEL_COPY[result.level]!.title}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="mk-btn mk-btn-secondary mk-btn-sm" onClick={copy}>
                  {copied ? "Copied" : "Copy summary"}
                </button>
                <button
                  type="button"
                  className="mk-btn mk-btn-secondary mk-btn-sm"
                  onClick={() => {
                    setAnswers({});
                    setCopied(false);
                  }}
                >
                  Start over
                </button>
              </div>
            </div>
            <p className="mt-3 text-sm text-(--mk-fg)">{LEVEL_COPY[result.level]!.body}</p>

            <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-(--mk-muted)">Coverage by framework</h3>
            <p className="mt-1 text-xs text-(--mk-muted)">The share of this checker&apos;s questions for each framework that you answered yes. Open control references are the ones a reviewer would ask about first.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-xs text-(--mk-muted)">
                    <th className="py-1 pe-3 text-start font-medium">Framework</th>
                    <th className="py-1 pe-3 text-end font-medium">Questions</th>
                    <th className="py-1 pe-3 text-end font-medium">Coverage</th>
                    <th className="py-1 text-start font-medium">Open references</th>
                  </tr>
                </thead>
                <tbody>
                  {result.frameworks.map((f) => (
                    <tr key={f.key} className="border-t border-(--mk-line)" data-framework={f.key}>
                      <td className="py-1.5 pe-3 text-(--mk-fg)">{f.name}</td>
                      <td className="py-1.5 pe-3 text-end tabular-nums text-(--mk-muted)">{f.questions}</td>
                      <td className="py-1.5 pe-3 text-end tabular-nums text-(--mk-fg)">{f.percent}%</td>
                      <td className="py-1.5 text-xs text-(--mk-muted)">{f.openCodes.length ? f.openCodes.join(", ") : "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.gaps.length ? (
              <>
                <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-(--mk-muted)">Where to start</h3>
                <ol className="mt-2 list-decimal space-y-1.5 ps-5 text-sm text-(--mk-fg)">
                  {result.gaps.slice(0, 5).map((g) => (
                    <li key={g.id}>
                      {g.text} <span className="text-(--mk-muted)">({answers[g.id] ?? "not answered"})</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            <p className="mt-6 text-xs text-(--mk-muted)">
              This is a self-assessment against AEGIS&apos;s own summaries of public frameworks. It is not a compliance opinion, a certification or legal advice. To see the controls behind each reference, <Link href="/site/demo" className="underline underline-offset-2">open the demo</Link> and visit Standards.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
