import * as React from "react";
import { cn } from "@/lib/utils";
import { statusLabel, statusTone, TONE_DOT, type Tone } from "@/lib/status";
import { Badge } from "./badge";

export function StatusDot({ status, tone, className }: { status?: string | null; tone?: Tone; className?: string }) {
  const t = tone ?? statusTone(status);
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", TONE_DOT[t], className)} />;
}

export function StatusBadge({ status, label, tone, className }: { status: string | null | undefined; label?: string; tone?: Tone; className?: string }) {
  const t = tone ?? statusTone(status);
  return (
    <Badge tone={t} className={className}>
      <StatusDot tone={t} className="h-1.5 w-1.5" />
      {label ?? statusLabel(status)}
    </Badge>
  );
}

/** Dot plus label for table cells, without the badge chrome. */
export function StatusCell({ status, label }: { status: string | null | undefined; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot status={status} />
      <span>{label ?? statusLabel(status)}</span>
    </span>
  );
}
