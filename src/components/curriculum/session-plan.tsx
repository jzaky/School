import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { pickBi, sessionTimeline, totalMinutes, type Activity } from "@/server/curriculum/types";

const PHASE_BAR = { starter: "bg-info", main: "bg-brand", plenary: "bg-success" } as const;
const PHASE_DOT = { starter: "bg-info-soft text-info", main: "bg-brand-soft text-brand", plenary: "bg-success-soft text-success" } as const;

/** The lesson laid out minute by minute: a proportional bar and a timed run sheet. */
export function SessionPlan({ activities, durationMin, locale }: { activities: Activity[]; durationMin: number; locale: string }) {
  const t = useTranslations("curriculum");
  const rows = sessionTimeline(activities);
  const total = totalMinutes(activities);
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t("plan.noActivities")}</p>;
  return (
    <div className="space-y-4" data-testid="session-plan">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {rows.map((r, i) => (
          <div key={i} className={cn(PHASE_BAR[r.phase], i > 0 && "border-s-2 border-card")} style={{ flexGrow: Math.max(1, r.end - r.start) }} title={`${r.start}-${r.end}`} />
        ))}
        {total < durationMin && <div style={{ flexGrow: durationMin - total }} />}
      </div>
      {total !== durationMin && <p className="rounded-md bg-warning-soft px-3 py-1.5 text-xs">{t("plan.timingMismatch", { total, duration: durationMin })}</p>}
      <ol className="relative space-y-0">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 border-b py-3 last:border-b-0">
            <div className="text-xs tabular-nums text-muted-foreground">
              <div className="font-semibold text-foreground">{t("plan.range", { start: r.start, end: r.end })}</div>
              <div>{t("plan.minutesN", { count: r.end - r.start })}</div>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", PHASE_DOT[r.phase])}>{t(`phase.${r.phase}`)}</span>
                <span className="text-sm font-medium">{pickBi(locale, r.titleEn, r.titleAr) || t(`phase.${r.phase}`)}</span>
              </div>
              {pickBi(locale, r.detailEn, r.detailAr) && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{pickBi(locale, r.detailEn, r.detailAr)}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
