import Link from "next/link";
import { ArrowUpRight, Check, Circle } from "lucide-react";
import type { OnboardingStep, OnboardingSummary } from "@aegis/core";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/link-button";
import { Panel } from "@/components/ui/panel";

export function OnboardingProgress({ summary, className }: { summary: OnboardingSummary; className?: string }) {
  const pct = Math.round((summary.done / summary.total) * 100);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-elev-2" role="progressbar" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.done} aria-label="Onboarding progress">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular text-fg-muted" data-testid="onboarding-progress">
        {summary.done} of {summary.total} done
      </span>
    </div>
  );
}

/** Full checklist: one row per step with status, instructions and a button to the right screen. */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  return (
    <ol className="divide-y divide-line" data-testid="onboarding-steps">
      {steps.map((s, i) => (
        <li key={s.key} className="flex flex-wrap items-start gap-3 px-4 py-3" data-step={s.key} data-done={s.done ? "true" : "false"}>
          <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold", s.done ? "border-allow/40 bg-allow/15 text-allow" : "border-line bg-bg text-fg-muted")} aria-hidden>
            {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-fg">{s.title}</span>
              <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-medium", s.done ? "border-allow/30 bg-allow/12 text-allow" : "border-line bg-bg-elev-2 text-fg-muted")}>{s.done ? "Done" : "Not done"}</span>
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">{s.description}</p>
            {!s.done ? <p className="mt-1 text-xs text-fg">How: {s.hint}</p> : null}
          </div>
          <LinkButton href={s.href} size="sm" variant={s.done ? "ghost" : "secondary"} className="shrink-0">
            {s.done ? "Review" : "Open"}
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </LinkButton>
        </li>
      ))}
    </ol>
  );
}

/** Compact card for the Overview: progress, the next step as a primary button, the rest as a list. */
export function NextStepsCard({ steps, summary, className }: { steps: OnboardingStep[]; summary: OnboardingSummary; className?: string }) {
  return (
    <Panel title="Next steps" description={summary.complete ? "Pilot setup is complete." : "Guided pilot setup, derived from what already exists in this organization."} className={className} actions={<Link href="/getting-started" className="text-xs text-accent hover:underline">All steps</Link>} data-testid="next-steps">
      <OnboardingProgress summary={summary} />
      {summary.next ? (
        <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-3">
          <div className="text-sm font-medium text-fg">{summary.next.title}</div>
          <p className="mt-0.5 text-xs text-fg-muted">{summary.next.hint}</p>
          <LinkButton href={summary.next.href} variant="primary" size="sm" className="mt-2" data-testid="next-step-button">
            {summary.next.title}
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </LinkButton>
        </div>
      ) : (
        <p className="mt-3 text-xs text-fg-muted">Every step is done. You can hide this card from Settings.</p>
      )}
      <ul className="mt-3 space-y-1">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-xs">
            {s.done ? <Check className="h-3.5 w-3.5 shrink-0 text-allow" aria-hidden /> : <Circle className="h-3 w-3 shrink-0 text-fg-dim" aria-hidden />}
            <Link href={s.href} className={cn("truncate hover:underline", s.done ? "text-fg-muted" : "text-fg")}>
              {s.title}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
