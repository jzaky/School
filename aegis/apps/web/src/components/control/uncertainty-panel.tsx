"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { labelOutcomeAction } from "@/server/actions/uncertainty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Note } from "@/components/ui/note";
import type { Tone } from "@/lib/status";

export interface UncertaintyView {
  level: "low" | "elevated" | "high" | "unknown";
  indicators: { key: string; label: string; basis: "measured" | "heuristic" | "self_reported" | "calibrated"; status: "ok" | "warning" | "fail" | "unknown"; detail: string }[];
  missing: string[];
  contradictions: string[];
  confidence: { value: number; basis: string; calibratedAccuracy: number | null; sampleSize: number | null } | null;
  requirementsApplied: boolean;
  escalated?: boolean;
}

const LEVEL_TONE: Record<UncertaintyView["level"], Tone> = { low: "allow", elevated: "approval", high: "deny", unknown: "deny" };
const LEVEL_TEXT: Record<UncertaintyView["level"], string> = {
  low: "Low: nothing checked raised a concern",
  elevated: "Elevated: warnings only; the decision was not changed for them",
  high: "High: a check failed",
  unknown: "Unknown: something needed to judge this was missing, which is never treated as safe",
};
export const BASIS_TEXT: Record<UncertaintyView["indicators"][number]["basis"], string> = {
  measured: "measured fact",
  heuristic: "heuristic, suggests risk but proves nothing",
  self_reported: "reported by the agent; not checked by AEGIS",
  calibrated: "calibrated on labelled outcomes",
};
const STATUS_TONE: Record<string, Tone> = { ok: "allow", warning: "approval", fail: "deny", unknown: "deny" };

export function UncertaintyPanel({ u, requestId, canLabel, label }: { u: UncertaintyView; requestId: string; canLabel: boolean; label: { correct: boolean; source: string } | null }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<boolean | null>(null);
  async function mark(correct: boolean) {
    setPending(correct);
    const r = await labelOutcomeAction({ actionRequestId: requestId, correct, note: "" });
    setPending(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Outcome recorded; calibration uses it at the next hourly recompute");
    router.refresh();
  }
  return (
    <div className="space-y-3" data-testid="uncertainty-panel" data-level={u.level}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={LEVEL_TONE[u.level]}>{LEVEL_TEXT[u.level]}</Badge>
        {u.escalated ? <Badge tone="approval">Made the decision stricter</Badge> : null}
        {!u.requirementsApplied ? <span className="text-xs text-fg-muted">This tool has no uncertainty requirements; only contradictions and the agent&apos;s own gaps change a decision.</span> : null}
      </div>
      {u.indicators.length === 0 ? (
        <p className="text-sm text-fg-muted">The request carried no evidence or confidence, and the tool asks for none.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {u.indicators.map((i) => (
            <li key={i.key} className="flex flex-wrap items-start gap-2" data-indicator={i.key} data-basis={i.basis}>
              <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Badge>
              <span className="min-w-0 flex-1">
                <span className="text-fg">{i.label}</span>
                <span className="block text-xs text-fg-muted">
                  {i.detail} <span className="text-fg-dim">({BASIS_TEXT[i.basis]})</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Note tone="info">AEGIS does not produce its own confidence score. A confidence is shown only as the agent reported it, and called calibrated only when at least 50 labelled outcomes support it.</Note>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        <span className="text-fg-muted">{label ? `Outcome recorded (${label.source}): ${label.correct ? "the right action" : "the wrong action"}.` : "Was this the right action?"}</span>
        <Button size="sm" variant="secondary" loading={pending === true} disabled={!canLabel || pending !== null} disabledReason={!canLabel ? "Requires the monitoring:write permission" : undefined} onClick={() => void mark(true)}>
          Right action
        </Button>
        <Button size="sm" variant="secondary" loading={pending === false} disabled={!canLabel || pending !== null} disabledReason={!canLabel ? "Requires the monitoring:write permission" : undefined} onClick={() => void mark(false)}>
          Wrong action
        </Button>
      </div>
    </div>
  );
}
