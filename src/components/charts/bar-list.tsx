import { cn } from "@/lib/utils";

/** Horizontal bars in HTML: direction-aware, readable labels, hover title with the exact value. */
export function BarList({ rows, format = (n) => String(n), empty }: { rows: Array<{ label: string; value: number; hint?: string }>; format?: (n: number) => string; empty?: React.ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="space-y-2.5" role="list">
      {rows.map((r) => (
        <li key={r.label} className="group" title={`${r.label}: ${format(r.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{format(r.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full bg-brand transition-all group-hover:bg-[oklch(0.45_0.12_252)]")} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
