import { cn } from "@/lib/utils";

/**
 * Horizontal bars for a handful of ordered amounts (for example aging buckets). One hue, values as text beside the
 * bar, the exact amount in the hover title; the full figures are always in a table on the same page.
 */
export function BarList({ rows, testId }: { rows: Array<{ key: string; label: string; value: number; display: string; tone?: "brand" | "warning" | "danger" | "muted" }>; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const tone = { brand: "bg-brand", warning: "bg-warning", danger: "bg-danger", muted: "bg-muted-foreground/40" };
  return (
    <ul className="space-y-2.5" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${r.display}`}>
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full rounded-full", tone[r.tone ?? "brand"])} style={{ width: `${r.value > 0 ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
          </span>
          <span className="text-end font-medium tabular-nums">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two amounts compared on one scale per row (billed and collected per month), with a legend above. */
export function PairBars({ rows, legend }: { rows: Array<{ key: string; label: string; a: number; b: number; aText: string; bText: string }>; legend: { a: string; b: string } }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand" />
          {legend.a}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-gold" />
          {legend.b}
        </span>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <div className="space-y-1">
              <div className="flex items-center gap-2" title={`${legend.a}: ${r.aText}`}>
                <span className="h-2 rounded-full bg-brand" style={{ width: `${r.a > 0 ? Math.max(1, (r.a / max) * 80) : 0}%` }} />
                <span className="tabular-nums text-muted-foreground">{r.aText}</span>
              </div>
              <div className="flex items-center gap-2" title={`${legend.b}: ${r.bText}`}>
                <span className="h-2 rounded-full bg-gold" style={{ width: `${r.b > 0 ? Math.max(1, (r.b / max) * 80) : 0}%` }} />
                <span className="tabular-nums text-muted-foreground">{r.bText}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
