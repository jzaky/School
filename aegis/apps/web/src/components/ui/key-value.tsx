import * as React from "react";
import { cn } from "@/lib/utils";

export interface KV {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

export function KeyValue({ items, className, columns = 1 }: { items: KV[]; className?: string; columns?: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-6", columns === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1", className)}>
      {items.map((it) => (
        <div key={it.label} className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0">
          <dt className="shrink-0 text-xs text-fg-muted">{it.label}</dt>
          <dd className={cn("min-w-0 text-end text-sm text-fg break-words", it.mono && "font-mono text-xs")}>{it.value === null || it.value === undefined || it.value === "" ? <span className="text-fg-dim">none</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
