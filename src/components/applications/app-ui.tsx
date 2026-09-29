import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Pill, type Tone } from "@/components/app/badges";
import type { AppCard, DeadlineView } from "@/server/applications/page-data";

const STAGE_TONE: Record<string, Tone> = {
  RESEARCHING: "neutral",
  SHORTLISTED: "neutral",
  PREPARING: "brand",
  SUBMITTED: "info",
  INTERVIEW: "violet",
  OFFER: "success",
  WAITLISTED: "warning",
  REJECTED: "danger",
  ACCEPTED: "success",
  ENROLLED: "success",
};
const URGENCY_TONE: Record<string, Tone> = { overdue: "danger", urgent: "danger", soon: "warning", upcoming: "info", later: "neutral", none: "neutral" };

export function StagePill({ stage }: { stage: string }) {
  const t = useTranslations("applications");
  return (
    <Pill tone={STAGE_TONE[stage] ?? "neutral"} dot>
      {t(`stage.${stage}`)}
    </Pill>
  );
}

export function UrgencyPill({ bucket, days }: { bucket: string; days: number | null }) {
  const t = useTranslations("applications");
  const key = bucket !== "overdue" && bucket !== "none" && days === 0 ? "today" : bucket;
  return (
    <Pill tone={URGENCY_TONE[bucket] ?? "neutral"} className="tabular-nums">
      {t(`urgency.${key}`, { n: Math.abs(days ?? 0) })}
    </Pill>
  );
}

export function SourceLabel({ source }: { source: string }) {
  const t = useTranslations("applications");
  return <span className={cn("text-xs", source === "ROUTE_DEFAULT" ? "text-[oklch(0.55_0.14_65)]" : "text-muted-foreground")}>{t(`source.${source}`)}</span>;
}

export function DeadlineLine({ d, compact }: { d: DeadlineView | null; compact?: boolean }) {
  const t = useTranslations("applications");
  if (!d) return <span className="text-xs text-muted-foreground">{t("noDeadline")}</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">{d.date}</span>
      {!compact && <span className="text-muted-foreground">{t(`deadlineKind.${d.kind}`)}</span>}
      <UrgencyPill bucket={d.bucket} days={d.days} />
      {!compact && <SourceLabel source={d.source} />}
    </div>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const t = useTranslations("applications");
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t("checklist")}</span>
        <span className="tabular-nums">{t("progress", { done, total })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Application card for the student and parent list. */
export function AppCardView({ a, country, showStudent }: { a: AppCard; country: string; showStudent?: boolean }) {
  const t = useTranslations("applications");
  return (
    <Link href={`/career/applications/${a.id}`} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition hover:border-brand/40" data-testid="application-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{a.university}</div>
          <div className="truncate text-xs text-muted-foreground">
            {a.program ?? t(`route.${a.route}`)} · {country}
            {showStudent && ` · ${a.studentName}`}
          </div>
        </div>
        <StagePill stage={a.stage} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="info">{t(`route.${a.route}`)}</Pill>
        <Pill>{t("intake", { year: a.intakeYear })}</Pill>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("nextDeadline")}</div>
        {a.next || !a.submittedOn ? <DeadlineLine d={a.next} /> : <span className="text-xs text-muted-foreground">{a.decidedOn ? t("decidedOn", { date: a.decidedOn }) : t("submittedOn", { date: a.submittedOn })}</span>}
      </div>
      <Progress done={a.done} total={a.total} />
    </Link>
  );
}
