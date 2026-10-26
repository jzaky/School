import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, CalendarClock, CalendarPlus, Compass, Download, FileText, Inbox } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { resolveRange, studentSummary } from "@/server/attendance/reports";
import { localClock } from "@/server/attendance/settings";
import { isUnexplained, resolveCode } from "@/server/attendance/codes";
import { round1 } from "@/server/attendance/maths";
import { keyToDate } from "@/server/timetable/cover";
import { initials, personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill, RequestStatusBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { requestWhere } from "@/server/access/request-access";
import { CareerReportButton } from "@/components/career/career-report-button";

export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.isParent) notFound();
  const links = ctx.membership.guardian?.links ?? [];
  if (!links.some((l) => l.studentId === id)) notFound();
  const t = await getTranslations("children");
  const ts = await getTranslations("students");
  const tr = await getTranslations("careerReport");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const s = links.find((l) => l.studentId === id)!.student;
  // Attendance: this child's own record only (term to date), with the school's codes.
  const { range } = await resolveRange(db, {}, localClock(new Date(), ctx.org.timezone || "Asia/Dubai").dateKey);
  const [enrollments, summary, requests, appts, docs, recs, assessed] = await Promise.all([
    db.enrollment.findMany({ where: { studentId: id }, include: { class: { include: { subject: true } } } }),
    studentSummary(db, id, range),
    db.request.findMany({ where: { AND: [requestWhere(ctx), { studentId: id }] }, include: { service: true }, orderBy: { submittedAt: "desc" }, take: 6 }),
    db.appointment.findMany({ where: { orgId, studentId: id, caseId: null }, include: { type: true }, orderBy: { startsAt: "desc" }, take: 5 }),
    db.document.findMany({ where: { studentId: id, visibleToFamily: true }, orderBy: { createdAt: "desc" } }),
    db.careerRecommendation.findMany({ where: { studentId: id, status: "APPROVED" }, include: { career: true }, orderBy: { rank: "asc" }, take: 3 }),
    db.aptitudeAssessment.count({ where: { studentId: id, completedAt: { not: null } } }),
  ]);
  const teachers = await db.membership.findMany({ where: { id: { in: [...enrollments.map((e) => e.class.teacherMembershipId), ...appts.map((a) => a.hostId)].filter(Boolean) as string[] } }, include: { user: true } });
  const nameOf = (mid: string | null) => (mid ? userName(teachers.find((m) => m.id === mid)?.user, locale) : "");
  const ta = await getTranslations("attendance.child");
  const pct = summary.pct === null ? null : round1(summary.pct);
  const recent = summary.days.slice(-30);
  const unexplained = summary.days.filter((d) => {
    const c = resolveCode(summary.codes, d.code, d.status);
    return c && isUnexplained(c) && !d.requestId;
  });
  return (
    <PageBody>
      {links.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link key={l.studentId} href={`/children/${l.studentId}`} className={cn("flex items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-sm", l.studentId === id ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}>
              <span className={cn("grid size-7 place-items-center rounded-full text-[11px] font-semibold", l.studentId === id ? "bg-white/20" : "bg-brand-soft text-brand")}>{initials(`${l.student.firstNameEn} ${l.student.lastNameEn}`)}</span>
              {personName(l.student, locale)}
            </Link>
          ))}
        </div>
      )}
      <Panel className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand to-[oklch(0.5_0.12_240)] text-xl font-semibold text-white">{initials(`${s.firstNameEn} ${s.lastNameEn}`)}</div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{personName(s, locale)}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <Pill tone="brand">{ts("gradeN", { grade: `${s.gradeLevel}${s.section ?? ""}` })}</Pill>
            {pct !== null && <Pill tone={pct >= 95 ? "success" : pct >= 90 ? "warning" : "danger"}>{t("attendance", { pct })}</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild data-testid="child-book">
            <Link href={`/services/parent_meeting?student=${s.id}`}>
              <CalendarPlus className="size-4" />
              {t("meetTeacher")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/services/document_request?student=${s.id}`}>
              <FileText className="size-4" />
              {t("requestDocument")}
            </Link>
          </Button>
        </div>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={ta("title")} description={ta("termToDate", { from: fmtDate(prefs, keyToDate(range.from), "medium"), to: fmtDate(prefs, keyToDate(range.to), "medium") })} />
            {summary.tally.possible === 0 ? (
              <p className="text-sm text-muted-foreground">{ta("none")}</p>
            ) : (
              <div className="space-y-4" data-testid="child-attendance">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg bg-muted/40 p-3">
                    <div className="text-xs text-muted-foreground">{ta("attendance")}</div>
                    <div className="text-xl font-semibold tabular-nums" data-testid="child-attendance-pct">{pct === null ? "-" : `${fmtNumber(prefs, pct, { maximumFractionDigits: 1 })}%`}</div>
                    <div className="text-[11px] text-muted-foreground">{ta("daysOf", { attended: summary.tally.attended, possible: summary.tally.possible })}</div>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <div className="text-xs text-muted-foreground">{ta("late")}</div>
                    <div className="text-xl font-semibold tabular-nums">{fmtNumber(prefs, summary.tally.late)}</div>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <div className="text-xs text-muted-foreground">{ta("authorised")}</div>
                    <div className="text-xl font-semibold tabular-nums">{fmtNumber(prefs, summary.tally.authorised)}</div>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <div className="text-xs text-muted-foreground">{ta("unauthorised")}</div>
                    <div className="text-xl font-semibold tabular-nums">{fmtNumber(prefs, summary.tally.unauthorised)}</div>
                  </div>
                </div>
                <ul className="flex flex-wrap gap-1" aria-label={ta("recent")}>
                  {recent.map((d) => {
                    const c = resolveCode(summary.codes, d.code, d.status);
                    const tone = !c ? "bg-muted" : c.countsAs === "NOT_COUNTED" ? "bg-muted text-muted-foreground" : c.countsAs === "PRESENT" ? (c.late ? "bg-warning-soft text-[oklch(0.5_0.13_65)]" : "bg-success-soft text-success") : c.authorised ? "bg-info-soft text-info" : "bg-danger-soft text-danger";
                    return (
                      <li key={d.date.toISOString()} title={`${fmtDate(prefs, d.date, "long")}: ${c ? pick(locale, c.labelEn, c.labelAr) : ""}${d.minutesLate ? ` (${ta("minutesLate", { n: d.minutesLate })})` : ""}`} className={cn("grid h-7 min-w-7 place-items-center rounded-md px-0.5 text-[10px] font-semibold", tone)} dir="ltr">
                        {c?.code ?? "?"}
                      </li>
                    );
                  })}
                </ul>
                {unexplained.length > 0 && (
                  <div className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger-soft/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="child-unexplained">
                    <span>{ta("unexplained", { count: unexplained.length, date: fmtDate(prefs, unexplained[unexplained.length - 1].date, "long") })}</span>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/services/absence_request?student=${s.id}`}>{ta("reportReason")}</Link>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Panel>
          <Panel>
            <PanelHeader title={t("teachers")} icon={<BookOpen className="size-4" />} />
            <ul className="grid gap-2 sm:grid-cols-2">
              {enrollments.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{e.class.isHomeroom ? t("homeroom") : pick(locale, e.class.subject?.nameEn, e.class.subject?.nameAr)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{nameOf(e.class.teacherMembershipId)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title={t("requests")} icon={<Inbox className="size-4" />} />
            {requests.length ? (
              <ul className="divide-y">
                {requests.map((r) => (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand">
                      <span className="truncate">{pick(locale, r.service.nameEn, r.service.nameAr)}</span>
                      <RequestStatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title={t("meetings")} icon={<CalendarClock className="size-4" />} />
            {appts.length ? (
              <ul className="space-y-2 text-sm">
                {appts.map((a) => (
                  <li key={a.id}>
                    <Link href={`/meetings/${a.id}`} className="block hover:text-brand">
                      {pick(locale, a.type.nameEn, a.type.nameAr)}
                      <span className="block text-xs text-muted-foreground">
                        {fmtDateTime(prefs, a.startsAt)} · {nameOf(a.hostId)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title={t("documents")} icon={<FileText className="size-4" />} />
            {docs.length ? (
              <ul className="space-y-2">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{pick(locale, d.titleEn, d.titleAr)}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(prefs, d.createdAt, "short")}</span>
                    <a href={`/api/documents/${d.id}/download`} aria-label={t("download")} className="text-muted-foreground hover:text-foreground">
                      <Download className="size-4" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            )}
          </Panel>
          {(recs.length > 0 || assessed > 0) && (
            <Panel>
              <PanelHeader title={t("career")} icon={<Compass className="size-4" />} />
              {recs.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {recs.map((r) => (
                    <Pill key={r.id} tone="brand">
                      {pick(locale, r.career.titleEn, r.career.titleAr)} · {r.matchScore}%
                    </Pill>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{tr("awaitingReview")}</p>
              )}
              {assessed > 0 && (
                <div className="mt-4">
                  <CareerReportButton studentId={id} />
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </PageBody>
  );
}
