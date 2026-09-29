"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Lock, MapPin, UserRoundCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GridData, GridLesson, GridPeriod } from "@/server/timetable/queries";
import { LessonDialog } from "./lesson-dialog";
import { DeclineCoverButton } from "./cover-actions";
import { dayName } from "./day-name";

const TONE: Record<GridLesson["tone"], string> = {
  lesson: "border-brand/20 bg-brand-soft/60",
  locked: "border-brand/40 bg-brand-soft",
  cover: "border-gold/50 bg-gold-soft",
  absent: "border-dashed border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

function shortDate(locale: string, key: string) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
}

/**
 * Weekly timetable. Desktop: a grid with one column per school day (columns follow the page direction,
 * so days run right to left in Arabic). Mobile: one day at a time with day tabs.
 */
export function WeekGrid({ data, mode = "view", todayDay, testId }: { data: GridData; mode?: "view" | "manage" | "teacher"; todayDay?: number | null; testId?: string }) {
  const t = useTranslations("timetable");
  const locale = useLocale();
  const days = data.days;
  const [active, setActive] = useState<number>(todayDay != null && days.includes(todayDay) ? todayDay : days[0]);
  const [open, setOpen] = useState<GridLesson | null>(null);

  // Rows: the longest day decides the rows; each row is a period number.
  const rows = useMemo(() => {
    const nos = [...new Set(data.periods.map((p) => p.periodNo))].sort((a, b) => a - b);
    return nos.map((no) => {
      const byDay = new Map<number, GridPeriod>();
      for (const p of data.periods) if (p.periodNo === no) byDay.set(p.day, p);
      return { no, byDay, ref: byDay.get(days.find((d) => byDay.has(d)) ?? -1) };
    });
  }, [data.periods, days]);

  const lessonsAt = (day: number, no: number) => data.lessons.filter((l) => l.day === day && l.periodNo === no);

  const cell = (day: number, no: number, p: GridPeriod | undefined, ref: GridPeriod | undefined) => {
    if (!p) return <div className="rounded-md bg-muted/20" />;
    if (p.kind !== "LESSON")
      return (
        <div className="flex items-center justify-center rounded-md bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {p.kind === "BREAK" ? t("break") : t("assembly")}
          {ref && (p.start !== ref.start || p.end !== ref.end) && <span className="ms-1 tabular-nums" dir="ltr">{p.start}</span>}
        </div>
      );
    const items = lessonsAt(day, no);
    return (
      <div className="flex min-h-14 flex-col gap-1">
        {ref && (p.start !== ref.start || p.end !== ref.end) && (
          <span className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">
            {p.start} - {p.end}
          </span>
        )}
        {items.length === 0 && <div className="flex-1 rounded-md border border-dashed border-border/60" />}
        {items.map((l) => (
          <LessonCard key={l.id} l={l} mode={mode} onOpen={() => setOpen(l)} />
        ))}
      </div>
    );
  };

  return (
    <div data-testid={testId ?? "week-grid"}>
      {/* Desktop grid */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card p-3 shadow-xs md:block">
        <div className="grid min-w-[720px] gap-1.5" style={{ gridTemplateColumns: `5.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <div key={d} className={cn("rounded-md px-2 py-1.5 text-center text-xs font-semibold", todayDay === d && "bg-brand text-brand-foreground")}>
              {dayName(locale, d)}
              {data.dates?.[d] && <span className="block text-[11px] font-normal opacity-80">{shortDate(locale, data.dates[d])}</span>}
            </div>
          ))}
          {rows.map((r) => (
            <RowFrag key={r.no}>
              <div className="flex flex-col justify-center pe-2 text-[11px] text-muted-foreground">
                {r.ref?.kind === "LESSON" && <span className="font-medium text-foreground">{t("lessonN", { n: r.ref.lessonNo ?? r.no })}</span>}
                {r.ref && (
                  <span className="tabular-nums" dir="ltr">
                    {r.ref.start} - {r.ref.end}
                  </span>
                )}
              </div>
              {days.map((d) => (
                <div key={d}>{cell(d, r.no, r.byDay.get(d), r.ref)}</div>
              ))}
            </RowFrag>
          ))}
        </div>
      </div>

      {/* Mobile day view */}
      <div className="md:hidden">
        <div className="mb-3 grid gap-1 rounded-lg border bg-card p-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} role="tablist">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active === d}
              onClick={() => setActive(d)}
              className={cn("rounded-md px-1 py-1.5 text-xs font-medium", active === d ? "bg-brand text-brand-foreground" : "text-muted-foreground")}
              data-testid={`day-tab-${d}`}
            >
              {dayName(locale, d, "short")}
              {data.dates?.[d] && <span className="block text-[10px] font-normal opacity-80">{shortDate(locale, data.dates[d])}</span>}
            </button>
          ))}
        </div>
        <ol className="space-y-1.5">
          {data.periods
            .filter((p) => p.day === active)
            .map((p) => (
              <li key={p.periodNo} className="flex gap-3 rounded-lg border bg-card p-2.5">
                <div className="w-16 shrink-0 text-[11px] text-muted-foreground">
                  <div className="font-medium text-foreground">{p.kind === "LESSON" ? t("lessonN", { n: p.lessonNo ?? p.periodNo }) : p.kind === "BREAK" ? t("break") : t("assembly")}</div>
                  <div className="tabular-nums" dir="ltr">
                    {p.start}
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  {p.kind === "LESSON" && lessonsAt(active, p.periodNo).length === 0 && <div className="py-1 text-xs text-muted-foreground">{t("free")}</div>}
                  {lessonsAt(active, p.periodNo).map((l) => (
                    <LessonCard key={l.id} l={l} mode={mode} onOpen={() => setOpen(l)} />
                  ))}
                </div>
              </li>
            ))}
        </ol>
      </div>

      {mode === "manage" && open?.slotId && <LessonDialog lesson={open} periods={data.periods} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RowFrag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function LessonCard({ l, mode, onOpen }: { l: GridLesson; mode: "view" | "manage" | "teacher"; onOpen: () => void }) {
  const t = useTranslations("timetable");
  const body = (
    <>
      <div className="flex items-start justify-between gap-1">
        <span className="truncate text-xs font-semibold">{l.title}</span>
        {l.locked && <Lock className="size-3 shrink-0 text-brand" aria-label={t("locked")} />}
        {l.tone === "cover" && <UserRoundCheck className="size-3.5 shrink-0 text-[oklch(0.55_0.1_80)]" />}
      </div>
      {l.tone === "cover" && <div className="text-[11px] font-medium text-[oklch(0.5_0.1_80)]">{t("coverFor", { name: l.subtitle })}</div>}
      {l.tone !== "cover" && l.subtitle && <div className="truncate text-[11px] text-muted-foreground">{l.subtitle}</div>}
      {l.room && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" />
          <span dir="ltr">{l.room}</span>
        </div>
      )}
      {l.tone === "absent" && <div className="text-[11px] font-medium">{l.uncovered ? t("absentUncovered") : t("absentCoveredBy", { name: l.coveredBy ?? "" })}</div>}
    </>
  );
  const cls = cn("block w-full rounded-md border px-2 py-1.5 text-start", TONE[l.tone]);
  if (mode === "manage" && l.slotId)
    return (
      <button type="button" onClick={onOpen} className={cn(cls, "transition hover:border-brand hover:shadow-sm")} data-testid="tt-lesson">
        {body}
      </button>
    );
  return (
    <div className={cls} data-testid={l.tone === "cover" ? "tt-cover" : "tt-lesson"}>
      {body}
      {mode === "teacher" && l.coverId && l.canDecline && (
        <div className="mt-1">
          <DeclineCoverButton coverId={l.coverId} label={l.title} />
        </div>
      )}
    </div>
  );
}
