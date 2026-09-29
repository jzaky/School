import { cn } from "@/lib/utils";

/** A tiny trend line for percentages (0 to 100). Draws left to right in both directions of text. */
export function Sparkline({ points, className, label }: { points: number[]; className?: string; label: string }) {
  const W = 120;
  const H = 32;
  if (points.length < 2) return <div className={cn("h-8", className)} aria-hidden />;
  const lo = Math.max(0, Math.min(...points) - 8);
  const hi = Math.min(100, Math.max(...points) + 8);
  const span = Math.max(hi - lo, 1);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (W - 4) + 2, H - 3 - ((p - lo) / span) * (H - 6)] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-8 w-28", up ? "text-success" : "text-warning", className)} role="img" aria-label={label} style={{ direction: "ltr" }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2.5} fill="currentColor" />
    </svg>
  );
}
