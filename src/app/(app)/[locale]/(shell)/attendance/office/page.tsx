import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, BellOff, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Hand, Phone, ShieldAlert, TrendingDown, UserX } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber, fmtTime } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { personName, pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { FilterBar } from "@/components/app/filter-bar";
import { Button } from "@/components/ui/button";
import { AttendanceTabs } from "@/components/attendance/attendance-tabs";
import { OfficeRowActions, RunFollowUpButton } from "@/components/attendance/office-actions";
import { attViewer, canManage, neighbourDays, seesReasons } from "@/server/attendance/registers";
import { officeDay } from "@/server/attendance/followup";
import { officeAlerts, registerProgress } from "@/server/attendance/office";
import { loadCodes, localClock, toMin } from "@/server/attendance/settings";
import { isUnexplained, visibleCode } from "@/server/attendance/codes";
import { warnAt } from "@/server/attendance/limits";
import { keyToDate } from "@/server/timetable/cover";

export async function generateMetadata() {
  const t = await getTranslations("attendance.office");
  return { title: t("title") };
}

type SP = { date?: string; status?: string; page?: string };

export default async function AttendanceOfficePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const v = attViewer(ctx);
  if (!canManage(v)) notFound();
  const t = await getTranslations("attendance.office");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { locale } = ctx;
  const now = new Date();
  const clock = localClock(now, v.timezone);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : clock.dateKey;
  const status = sp.status === "EXPLAINED" || sp.status === "ALL" ? sp.status : "ACTIVE";
  const page = Math.max(1, Number(sp.page) || 1);
  const [day, progress, alerts, { codes }] = await Promise.all([
    officeDay(v, date, { status: status === "ALL" ? undefined : status, page }),
    registerProgress(v, date, now),
    officeAlerts(v, now),
    loadCodes(ctx.db),
  ]);
  const settings = alerts.settings;
  const reasons = seesReasons(v);
  const explainCodes = codes
    .filter((c) => c.active && !isUnexplained(c) && (reasons || !c.private))
    .map((c) => ({ code: c.code, label: pick(locale, c.labelEn, c.labelAr) }));
  const codeLabel = (code: string | null) => {
    const c = code ? codes.find((x) => x.code === code) : undefined;
    if (!c) return code ?? "";
    const vis = visibleCode(codes, c, reasons);
    return `${vis.code} · ${pick(locale, vis.labelEn, vis.labelAr)}`;
  };
  const { prev, next } = neighbourDays(date, v.weekDays);
  const isToday = date === clock.dateKey;
  const beforeFollowUp = isToday && clock.minute < toMin(settings.followUpTime);
  const notTaken = progress.homerooms.filter((h) => h.students > 0 && h.marked < h.students);
  const canProfile = ctx.can("people.view");
  const grade = (g: number) => tg("label", gradeLevelValues(g));
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { date: date === clock.dateKey ? null : date, status: status === "ACTIVE" ? null : status, page: page > 1 ? String(page) : null, ...patch };
    for (const [k, val] of Object.entries(merged)) if (val) p.set(k, val);
    const s = p.toString();
    return `/attendance/office${s ? `?${s}` : ""}`;
  };

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { time: settings.followUpTime })}
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" asChild>
                <Link href={qs({ date: prev, page: null })} aria-label={t("previousDay")}>
                  <ChevronLeft className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              {!isToday && (
                <Button variant="outline" asChild>
                  <Link href="/attendance/office">{t("today")}</Link>
                </Button>
              )}
              <Button variant="outline" size="icon" asChild>
                <Link href={qs({ date: next > clock.dateKey ? clock.dateKey : next, page: null })} aria-label={t("nextDay")}>
                  <ChevronRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
            </div>
            {isToday && <RunFollowUpButton disabledReason={null} />}
          </>
        }
      />
      <AttendanceTabs ctx={ctx} current="office" counts={{ office: day.counts.OPEN }} />
      <div className="text-lg font-semibold" data-testid="office-date">
        {fmtDate(prefs, keyToDate(date), "long")}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statOpen")} value={fmtNumber(prefs, day.counts.OPEN)} hint={beforeFollowUp ? t("statOpenHintBefore", { time: settings.followUpTime }) : t("statOpenHint")} icon={<UserX className="size-4" />} tone={day.counts.OPEN ? "danger" : "success"} testId="stat-open" />
        <StatCard label={t("statContacted")} value={fmtNumber(prefs, day.counts.CONTACTED)} hint={t("statContactedHint")} icon={<Phone className="size-4" />} tone="warning" />
        <StatCard label={t("statExplained")} value={fmtNumber(prefs, day.counts.EXPLAINED)} icon={<CheckCircle2 className="size-4" />} tone="success" />
        <StatCard
          label={t("statRegisters")}
          value={`${fmtNumber(prefs, progress.homerooms.length - notTaken.length)}/${fmtNumber(prefs, progress.homerooms.length)}`}
          hint={progress.lessons.started ? t("statLessonsHint", { taken: progress.lessons.taken, started: progress.lessons.started }) : t("statRegistersHint")}
          icon={<ClipboardList className="size-4" />}
          tone={notTaken.length ? "warning" : "info"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 xl:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold">{t("unexplainedTitle")}</h2>
            <FilterBar
              chipParam="status"
              chips={[
                { value: "", label: t("filterActive") },
                { value: "EXPLAINED", label: t("filterExplained") },
                { value: "ALL", label: t("filterAll") },
              ]}
            />
          </div>
          {day.rows.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="size-5" />} title={status === "EXPLAINED" ? t("noneExplained") : t("noneTitle")} body={status === "EXPLAINED" ? undefined : t("noneBody")} />
          ) : (
            <ul className="space-y-3" data-testid="followups">
              {day.rows.map((r) => {
                const name = personName(r.student, locale);
                return (
                  <li key={r.id} className="rounded-xl border bg-card p-4 shadow-xs" data-testid="followup-row" data-status={r.status}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {canProfile ? (
                            <Link href={`/students/${r.student.id}`} className="font-semibold hover:text-brand">
                              {name}
                            </Link>
                          ) : (
                            <span className="font-semibold">{name}</span>
                          )}
                          <Pill tone={r.status === "OPEN" ? "danger" : r.status === "CONTACTED" ? "warning" : "success"}>{t(`status.${r.status}`)}</Pill>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          <span dir="ltr">{r.student.studentNo}</span> · {r.homeroom ? pick(locale, r.homeroom.en, r.homeroom.ar) : grade(r.student.gradeLevel)}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          {r.notifiedAt ? (
                            <Pill tone="info">{t("autoSent", { time: fmtTime(prefs, r.notifiedAt) })}</Pill>
                          ) : r.heldReason === "HELD" ? (
                            <Pill tone="violet" className="gap-1">
                              <Hand className="size-3" />
                              {t("autoHeld")}
                            </Pill>
                          ) : r.heldReason === "OFF" ? (
                            <Pill tone="neutral">
                              <BellOff className="size-3" />
                              {t("autoOff")}
                            </Pill>
                          ) : r.heldReason === "REPORT_PENDING" ? (
                            <Pill tone="info">{t("autoReportPending")}</Pill>
                          ) : r.heldReason === "NO_GUARDIAN" ? (
                            <Pill tone="warning">{t("autoNoGuardian")}</Pill>
                          ) : r.status !== "EXPLAINED" ? (
                            <Pill tone="neutral">{beforeFollowUp ? t("autoScheduled", { time: settings.followUpTime }) : isToday ? t("autoPending") : t("autoNotSent")}</Pill>
                          ) : null}
                          {r.explainedCode && <Pill tone="success">{codeLabel(r.explainedCode)}</Pill>}
                        </div>
                        {r.heldReason === "HELD" && r.status !== "EXPLAINED" && <p className="mt-2 max-w-prose text-xs text-muted-foreground">{t("heldExplain")}</p>}
                      </div>
                      <OfficeRowActions followUpId={r.id} studentName={name} held={r.heldReason === "HELD"} canMessage={r.guardians.length > 0} explainCodes={explainCodes} explained={r.status === "EXPLAINED"} />
                    </div>
                    {r.guardians.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-2 border-t pt-3 text-xs">
                        {r.guardians.map((g, i) => (
                          <li key={i} className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5">
                            <span className="font-medium">{pick(locale, g.name.en, g.name.ar)}</span>
                            <span className="text-muted-foreground">{pick(locale, g.relationship.en, g.relationship.ar)}</span>
                            {g.phone && (
                              <a href={`tel:${g.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline" dir="ltr">
                                <Phone className="size-3" />
                                {g.phone}
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.contacts.length > 0 && (
                      <ol className="mt-3 space-y-1.5 border-t pt-3 text-xs" data-testid="contact-log">
                        {r.contacts.map((c) => {
                          const by = c.by ? (locale === "ar" ? c.by.split("|")[1] : c.by.split("|")[0]) : null;
                          return (
                            <li key={c.id} className="flex flex-wrap gap-x-2 gap-y-0.5">
                              <span className="tabular-nums text-muted-foreground">{fmtTime(prefs, c.at)}</span>
                              <span className="font-medium">{c.kind === "CALL" && c.outcome ? t(`log.CALL_${c.outcome}`) : t(`log.${c.kind}`)}</span>
                              {by && <span className="text-muted-foreground">{t("by", { name: by })}</span>}
                              {c.note === "" ? <span className="italic text-muted-foreground">{t("notePrivate")}</span> : c.note ? <span className="w-full whitespace-pre-wrap text-foreground/80">{c.note}</span> : null}
                              {c.reason ? <span className="w-full text-muted-foreground">{t("reasonShown", { reason: c.reason })}</span> : null}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {day.pages > 1 && (
            <div className="flex items-center justify-between text-sm" data-testid="pager">
              <span className="text-muted-foreground">{t("pageOf", { page: day.page, pages: day.pages, total: day.total })}</span>
              <div className="flex gap-2">
                {day.page > 1 && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={qs({ page: String(day.page - 1) })}>{t("previousPage")}</Link>
                  </Button>
                )}
                {day.page < day.pages && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={qs({ page: String(day.page + 1) })}>{t("nextPage")}</Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title={t("registersTitle")} description={progress.dailyStarted ? t("registersBody") : t("registersNotYet")} icon={<ClipboardList className="size-4" />} />
            {notTaken.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="all-registers-taken">{progress.homerooms.length ? t("allTaken") : t("noHomerooms")}</p>
            ) : (
              <ul className="divide-y" data-testid="registers-missing">
                {notTaken.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{pick(locale, h.en, h.ar)}</div>
                      <div className="truncate text-xs text-muted-foreground">{h.teacher ? pick(locale, h.teacher.en, h.teacher.ar) : t("noTutor")}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs tabular-nums", h.marked ? "text-info" : "text-warning")}>{t("markedOf", { marked: h.marked, total: h.students })}</span>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/attendance/take?class=${h.id}&date=${date}&period=0`}>{t("take")}</Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {settings.limit.enabled && (
            <Panel>
              <div id="limits" className="scroll-mt-24" />
              <PanelHeader
                title={t("limitTitle")}
                description={t("limitBody", { consecutive: settings.limit.consecutive, total: settings.limit.total, warnConsecutive: warnAt(settings.limit.consecutive, settings.limit.warnPct), warnTotal: warnAt(settings.limit.total, settings.limit.warnPct) })}
                icon={<ShieldAlert className="size-4" />}
              />
              {alerts.limit.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("limitNone")}</p>
              ) : (
                <ul className="divide-y" data-testid="limit-list">
                  {alerts.limit.map((r) => (
                    <li key={r.studentId} className="flex items-center justify-between gap-2 py-2 text-sm" data-testid="limit-row" data-level={r.level}>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{personName(r.student!, locale)}</div>
                        <div className="text-xs text-muted-foreground">{t("limitCounts", { consecutive: r.longest, total: r.total })}</div>
                      </div>
                      <Pill tone={r.level === "reached" ? "danger" : "warning"}>{t(r.level === "reached" ? "limitReached" : "limitWarning")}</Pill>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">{t("limitNoReasons")}</p>
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t("persistentTitle")} description={t("persistentBody", { threshold: settings.persistentThreshold, term: alerts.term ? pick(locale, alerts.term.en, alerts.term.ar) : "" })} icon={<TrendingDown className="size-4" />} />
            {alerts.persistent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("persistentNone")}</p>
            ) : (
              <ul className="divide-y" data-testid="persistent-list">
                {alerts.persistent.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/attendance/reports?student=${p.studentId}`} className="min-w-0 truncate font-medium hover:text-brand">
                      {personName(p.student!, locale)}
                    </Link>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger tabular-nums">
                      <AlertTriangle className="size-3.5" />
                      {fmtNumber(prefs, p.percent ?? 0, { maximumFractionDigits: 1 })}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {alerts.persistentTotal > alerts.persistent.length && (
              <Link href="/attendance/reports?view=students&sort=lowest" className="mt-2 block text-xs font-medium text-brand hover:underline">
                {t("persistentMore", { n: alerts.persistentTotal - alerts.persistent.length })}
              </Link>
            )}
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
