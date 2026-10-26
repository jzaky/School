"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, CalendarPlus, Lock, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtTime, type FormatPrefs } from "@/lib/format";
import { timeLeft } from "@/lib/selection-window";
import { Link } from "@/i18n/navigation";

/** Re-render every 30 seconds so countdowns stay current; null before hydration (no mismatch). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "4 days, 6 hours", "5 hours, 20 minutes" or "12 minutes". */
export function Countdown({ until, serverNow }: { until: string; serverNow: string }) {
  const t = useTranslations("selection.countdown");
  const now = useNow();
  const left = timeLeft(new Date(until), now ?? new Date(serverNow));
  if (left.totalMinutes <= 0) return <span>{t("ended")}</span>;
  if (left.days > 0) return <span>{t("daysHours", { days: left.days, hours: left.hours })}</span>;
  if (left.hours > 0) return <span>{t("hoursMinutes", { hours: left.hours, minutes: left.minutes })}</span>;
  return <span>{t("minutes", { minutes: Math.max(1, left.minutes) })}</span>;
}

export type BannerProps = {
  state: "upcoming" | "open" | "closed" | "none";
  via: "window" | "exception" | "session" | null;
  opensAt: string | null;
  closesAt: string | null;
  until: string | null;
  serverNow: string;
  round: string | null;
  year: string;
  sessionClass: string | null;
  /** Who to ask when closed, for example "Daniel Carter (homeroom teacher)". */
  contacts: string[];
  /** Staff with registration.manage can still change choices. */
  staffCanEdit: boolean;
  requestChangeHref: string | null;
  prefs: FormatPrefs;
  self: boolean;
  studentFirst: string;
};

/** Where choosing stands for the student: not open yet, open with a countdown, or closed. */
export function SelectionBanner(p: BannerProps) {
  const t = useTranslations("selection.banner");
  const who = p.self ? "self" : "other";
  const tone =
    p.via === "exception" || p.via === "session"
      ? "border-info/30 bg-info-soft/40"
      : p.state === "open"
        ? "border-success/30 bg-success-soft/40"
        : p.state === "upcoming"
          ? "border-brand/20 bg-brand-soft/40"
          : "bg-muted/30";
  const Icon = p.via === "session" ? Users : p.via === "exception" ? Sparkles : p.state === "open" ? CalendarClock : p.state === "upcoming" ? CalendarPlus : Lock;
  const iconTone = p.via === "session" || p.via === "exception" ? "text-info" : p.state === "open" ? "text-success" : p.state === "upcoming" ? "text-brand" : "text-muted-foreground";

  let title: React.ReactNode;
  let detail: React.ReactNode = null;
  if (p.via === "session" && p.until) {
    title = t("sessionTitle", { name: p.sessionClass ?? "" });
    detail = t("sessionDetail", { time: fmtTime(p.prefs, p.until) });
  } else if (p.via === "exception" && p.until) {
    title = t(`exceptionTitle.${who}`, { name: p.studentFirst });
    detail = t("exceptionDetail", { date: fmtDateTime(p.prefs, p.until) });
  } else if (p.state === "open" && p.closesAt) {
    title = (
      <>
        {t("openTitle", { year: p.year })} <span className="whitespace-nowrap">{t("closesIn")} <Countdown until={p.closesAt} serverNow={p.serverNow} /></span>
      </>
    );
    detail = t("openDetail", { date: fmtDateTime(p.prefs, p.closesAt) });
  } else if (p.state === "upcoming" && p.opensAt) {
    title = t("upcomingTitle", { year: p.year, date: fmtDateTime(p.prefs, p.opensAt) });
    detail = p.closesAt ? t("upcomingDetail", { date: fmtDateTime(p.prefs, p.closesAt) }) : null;
  } else if (p.state === "closed" && p.closesAt) {
    title = t("closedTitle", { year: p.year, date: fmtDateTime(p.prefs, p.closesAt) });
    detail = p.contacts.length ? t(`closedAsk.${who}`, { names: p.contacts.join(t("listSep")) }) : t(`closedAskSchool.${who}`);
  } else {
    title = t("noneTitle", { year: p.year });
    detail = t("noneDetail");
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", tone)} data-testid="window-banner" data-state={p.via && p.via !== "window" ? p.via : p.state}>
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", iconTone)} />
        <div className="min-w-0">
          <p className="font-medium">
            {title}
            {p.round && <span className="ms-1.5 text-xs font-normal text-muted-foreground">({p.round})</span>}
          </p>
          {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
          {p.staffCanEdit && p.state !== "open" && !p.via && <p className="mt-0.5 text-xs text-muted-foreground">{t("staffCanEdit")}</p>}
        </div>
      </div>
      {p.requestChangeHref && p.state === "closed" && !p.via && (
        <Link href={p.requestChangeHref} className="shrink-0 text-sm font-medium text-brand hover:underline">
          {t("requestChange")}
        </Link>
      )}
    </div>
  );
}
