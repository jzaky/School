import * as React from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export function StatPanel({ label, value, delta, hint, tone, sparkline, className, footer }: { label: string; value: React.ReactNode; delta?: { value: number; label?: string }; hint?: string; tone?: "allow" | "deny" | "approval" | "info" | "critical" | "neutral"; sparkline?: number[]; className?: string; footer?: React.ReactNode }) {
  const toneText = tone === "allow" ? "text-allow" : tone === "deny" ? "text-deny" : tone === "approval" ? "text-approval" : tone === "critical" ? "text-critical" : tone === "info" ? "text-info" : "text-fg";
  const body = (
    <div className={cn("rounded-panel border border-line bg-bg-elev p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
        {sparkline && sparkline.length > 1 ? <Sparkline data={sparkline} /> : null}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular leading-none", toneText)}>{value}</div>
      {delta ? (
        <div className={cn("mt-2 text-xs tabular", delta.value > 0 ? "text-allow" : delta.value < 0 ? "text-deny" : "text-fg-dim")}>
          {delta.value > 0 ? "+" : ""}
          {delta.value}
          {delta.label ? <span className="text-fg-dim"> {delta.label}</span> : null}
        </div>
      ) : null}
      {footer ? <div className="mt-2 text-xs text-fg-muted">{footer}</div> : null}
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

export function Sparkline({ data, width = 72, height = 20 }: { data: number[]; width?: number; height?: number }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="text-fg-dim">
      <polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={points} />
    </svg>
  );
}
