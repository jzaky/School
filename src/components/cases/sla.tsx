import { getTranslations } from "next-intl/server";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

function span(ms: number) {
  const h = Math.round(Math.abs(ms) / 3600_000);
  return h >= 48 ? { n: Math.round(h / 24), unit: "d" as const } : { n: Math.max(1, h), unit: "h" as const };
}

/** SLA countdown chip: green with time left, amber under a day, red when overdue. */
export async function SlaCountdown({ due, closed }: { due: Date | null; closed?: boolean }) {
  const t = await getTranslations("cases");
  if (!due || closed) return <span className="text-xs text-muted-foreground">-</span>;
  const ms = due.getTime() - Date.now();
  const s = span(ms);
  const label = ms < 0 ? t(s.unit === "d" ? "slaOverdueDays" : "slaOverdueHours", { n: s.n }) : t(s.unit === "d" ? "slaLeftDays" : "slaLeftHours", { n: s.n });
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", ms < 0 ? "bg-danger-soft text-danger" : ms < 86400_000 ? "bg-warning-soft text-[oklch(0.55_0.14_65)]" : "bg-success-soft text-success")} data-testid="sla">
      <Timer className="size-3" />
      {label}
    </span>
  );
}
