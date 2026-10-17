"use client";
import { useRegion } from "@/components/region-provider";
import * as React from "react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils";

function describe(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Live countdown to an expiry time. Turns amber under one hour and red when elapsed. */
export function Countdown({ until, className, prefix = "" }: { until: string | Date; className?: string; prefix?: string }) {
  const region = useRegion();
  const target = typeof until === "string" ? new Date(until).getTime() : until.getTime();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = target - now;
  const tone = ms <= 0 ? "text-deny" : ms < 3600_000 ? "text-approval" : "text-fg";
  return (
    <time dateTime={new Date(target).toISOString()} title={formatDateTime(new Date(target), region)} className={cn("tabular", tone, className)} suppressHydrationWarning>
      {prefix}
      {describe(ms)}
    </time>
  );
}
