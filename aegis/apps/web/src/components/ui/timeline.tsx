import * as React from "react";
import { cn } from "@/lib/utils";
import { StatusDot } from "./status";
import type { Tone } from "@/lib/status";

export interface TimelineItem {
  id: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  time?: React.ReactNode;
  tone?: Tone;
}

export function Timeline({ items, className, emptyText = "Nothing recorded yet" }: { items: TimelineItem[]; className?: string; emptyText?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-xs text-fg-dim">{emptyText}</p>;
  return (
    <ol className={cn("relative ms-1 border-s border-line", className)}>
      {items.map((it) => (
        <li key={it.id} className="relative ps-5 pb-4 last:pb-0">
          <span className="absolute -start-[5px] top-1.5">
            <StatusDot tone={it.tone ?? "neutral"} className="ring-4 ring-bg-elev" />
          </span>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className="min-w-0 text-sm text-fg">{it.title}</div>
            {it.time ? <div className="shrink-0 text-xs tabular text-fg-dim">{it.time}</div> : null}
          </div>
          {it.meta ? <div className="mt-0.5 text-xs text-fg-muted">{it.meta}</div> : null}
        </li>
      ))}
    </ol>
  );
}
