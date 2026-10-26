// Daily attendance for a period as thin bars (one series, so no legend: the panel title names it), with the
// school's threshold as a dashed reference line. Each bar has a hover title with the date and value, and the
// tables on the page are the accessible view of the same numbers.
import { cn } from "@/lib/utils";

export function TrendBars({ points, threshold, label, fmt }: { points: Array<{ day: string; pct: number | null; label: string }>; threshold: number; label: string; fmt: (n: number) => string }) {
  if (!points.length) return null;
  // Scale from 10 points under the threshold so day-to-day differences are visible; lower days sit at the floor.
  const floor = Math.max(0, Math.min(80, threshold - 10));
  const y = (p: number) => Math.max(0, Math.min(100, ((p - floor) / (100 - floor)) * 100));
  return (
    <figure className="space-y-2" aria-label={label}>
      <div className="relative h-32" data-testid="trend">
        <div className="absolute inset-x-0 border-t border-dashed border-warning" style={{ bottom: `${y(threshold)}%` }} aria-hidden />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {points.map((p) => (
            <div key={p.day} className="group relative flex h-full min-w-[3px] flex-1 items-end" title={`${p.label}: ${p.pct === null ? "-" : `${fmt(p.pct)}%`}`}>
              <div className={cn("w-full rounded-t-[4px] bg-brand/80 transition group-hover:bg-brand", p.pct !== null && p.pct < threshold && "bg-brand/45")} style={{ height: `${p.pct === null ? 0 : Math.max(2, y(p.pct))}%` }} />
            </div>
          ))}
        </div>
      </div>
      <figcaption className="flex justify-between text-[11px] text-muted-foreground">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </figcaption>
    </figure>
  );
}
