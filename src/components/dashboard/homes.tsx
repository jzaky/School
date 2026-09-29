import { getTranslations } from "next-intl/server";
import { FirstRunCard } from "@/components/access/first-run";
import { moduleEnabled } from "@/lib/modules";
import { SchoolDatesPanel } from "@/components/calendar-admin/family-home";
import {
  AlertOctagon,
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Clock,
  Compass,
  FolderKanban,
  GraduationCap,
  HeartHandshake,
  Inbox,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stamp,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { initials, personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { CaseStatusBadge, Pill, PriorityBadge, RequestStatusBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { BarList } from "@/components/charts/bar-list";
import { TrendChart } from "@/components/charts/trend-chart";
import { Ring } from "@/components/charts/ring";
import { AnnouncementsPanel, Greeting, MeetingsPanel, QuickServices, RequestsPanel, TasksPanel } from "./widgets";
import { listableCaseWhere } from "@/server/access/case-access";
import { schoolKpis } from "@/server/analytics/kpis";
import { isRestrictedForViewer } from "@/server/access/request-access";

const REFERRAL_SERVICES = ["academic_concern", "behavioral_referral", "wellbeing_referral", "learning_support_referral", "safeguarding_concern"];

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------
export async function StudentHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const student = ctx.membership.student!;
  const [assessment, recs, profile] = await Promise.all([
    ctx.db.aptitudeAssessment.findFirst({ where: { studentId: student.id, completedAt: { not: null } }, orderBy: { completedAt: "desc" } }),
    ctx.db.careerRecommendation.findMany({ where: { studentId: student.id }, include: { career: true }, orderBy: { rank: "asc" }, take: 3 }),
    ctx.db.careerProfile.findUnique({ where: { studentId: student.id } }),
  ]);
  const chosen = profile?.chosenCareerId ? recs.find((r) => r.careerId === profile.chosenCareerId)?.career : null;
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={t("studentSubtitle", { grade: `${student.gradeLevel}${student.section ?? ""}` })} />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <RequestsPanel ctx={ctx} prefs={prefs} limit={4} />
          <QuickServices ctx={ctx} keys={["career_guidance", "counselor_meeting", "subject_change", "document_request", "talk_to_someone", "it_support"]} />
        </div>
        <div className="space-y-6">
          <SchoolDatesPanel ctx={ctx} prefs={prefs} />
          <MeetingsPanel ctx={ctx} prefs={prefs} limit={3} title={t("nextMeetings")} />
          {moduleEnabled(ctx.org, "career") && (
          <Panel className="overflow-hidden bg-gradient-to-br from-violet-50 to-card">
            <PanelHeader title={t("careerTitle")} icon={<Compass className="size-4 text-violet-600" />} />
            {!assessment ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("careerCta")}</p>
                <Button asChild className="w-full" data-testid="start-assessment">
                  <Link href="/career/assessment">{t("careerStart")}</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {chosen ? (
                  <p className="text-sm">
                    {t("careerChosen")} <span className="font-semibold">{pick(ctx.locale, chosen.titleEn, chosen.titleAr)}</span>
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {recs.map((r) => (
                      <li key={r.id} className="flex items-center justify-between text-sm">
                        <span>{pick(ctx.locale, r.career.titleEn, r.career.titleAr)}</span>
                        <span className="font-semibold tabular-nums text-violet-700">{r.matchScore}%</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button asChild variant="outline" className="w-full">
                  <Link href="/career">{t("careerOpen")}</Link>
                </Button>
              </div>
            )}
          </Panel>
          )}
          <TasksPanel ctx={ctx} prefs={prefs} limit={4} />
          <AnnouncementsPanel ctx={ctx} prefs={prefs} audience="student" />
        </div>
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------
export async function ParentHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const links = ctx.membership.guardian?.links ?? [];
  const kids = links.map((l) => l.student);
  const since = new Date(Date.now() - 30 * 86400_000);
  const [attendance, homerooms, approvals] = await Promise.all([
    ctx.db.attendanceRecord.groupBy({ by: ["studentId", "status"], where: { studentId: { in: kids.map((k) => k.id) }, date: { gte: since } }, _count: { _all: true } }),
    ctx.db.enrollment.findMany({ where: { studentId: { in: kids.map((k) => k.id) }, class: { isHomeroom: true } }, include: { class: true } }),
    ctx.db.approvalAssignee.findMany({ where: { membershipId: ctx.membershipId, status: "PENDING", approval: { status: "PENDING" } }, include: { approval: { include: { request: { include: { service: true } } } } } }),
  ]);
  const tutorIds = homerooms.map((h) => h.class.teacherMembershipId).filter(Boolean) as string[];
  const tutors = await ctx.db.membership.findMany({ where: { id: { in: tutorIds } }, include: { user: true } });
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={t("parentSubtitle", { count: kids.length })} />
      <FirstRunCard ctx={ctx} audience="parent" />
      {approvals.length > 0 && (
        <Link href="/approvals" className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 transition hover:shadow-sm" data-testid="parent-approvals-banner">
          <span className="grid size-10 place-items-center rounded-lg bg-warning text-white">
            <Stamp className="size-5" />
          </span>
          <div className="flex-1">
            <div className="text-sm font-semibold">{t("parentApprovals", { count: approvals.length })}</div>
            <div className="text-xs text-muted-foreground">{approvals.map((a) => pick(ctx.locale, a.approval.request?.service.nameEn, a.approval.request?.service.nameAr)).join(" · ")}</div>
          </div>
          <span className="text-sm font-medium text-brand">{t("review")}</span>
        </Link>
      )}
      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {kids.map((k) => {
          const rows = attendance.filter((a) => a.studentId === k.id);
          const total = rows.reduce((s, r) => s + r._count._all, 0);
          const present = rows.filter((r) => r.status === "PRESENT" || r.status === "LATE").reduce((s, r) => s + r._count._all, 0);
          const pct = total ? Math.round((present / total) * 100) : 100;
          const hr = homerooms.find((h) => h.studentId === k.id);
          const tutor = tutors.find((m) => m.id === hr?.class.teacherMembershipId);
          return (
            <Panel key={k.id} className="flex items-center gap-4" >
              <div className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-[oklch(0.5_0.12_240)] text-lg font-semibold text-white">{initials(`${k.firstNameEn} ${k.lastNameEn}`)}</div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold" data-testid="child-name">
                  {personName(k, ctx.locale)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("gradeSection", { grade: k.gradeLevel, section: k.section ?? "" })}
                  {tutor && ` · ${t("tutor", { name: userName(tutor.user, ctx.locale) })}`}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Pill tone={pct >= 95 ? "success" : pct >= 90 ? "warning" : "danger"}>{t("attendancePct", { pct })}</Pill>
                </div>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href={`/children/${k.id}`}>{t("view")}</Link>
              </Button>
            </Panel>
          );
        })}
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <RequestsPanel ctx={ctx} prefs={prefs} limit={5} title={t("familyRequests")} />
        </div>
        <div className="space-y-6">
          <SchoolDatesPanel ctx={ctx} prefs={prefs} />
          <MeetingsPanel ctx={ctx} prefs={prefs} limit={3} />
          <QuickServices ctx={ctx} keys={["parent_meeting", "document_request", "absence_request", "counselor_meeting"]} />
          <AnnouncementsPanel ctx={ctx} prefs={prefs} audience="parent" />
        </div>
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------
// Teacher
// ---------------------------------------------------------------------------
export async function TeacherHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const { db, orgId, membershipId, locale } = ctx;
  const [classes, approvals, referrals, services] = await Promise.all([
    db.schoolClass.findMany({ where: { orgId, teacherMembershipId: membershipId }, include: { subject: true, _count: { select: { enrollments: true } } }, orderBy: [{ isHomeroom: "desc" }, { gradeLevel: "asc" }] }),
    db.approvalAssignee.count({ where: { orgId, membershipId, status: "PENDING", approval: { status: "PENDING" } } }),
    db.request.findMany({ where: { orgId, requesterId: membershipId, service: { key: { in: REFERRAL_SERVICES } } }, include: { service: true, student: true }, orderBy: { submittedAt: "desc" }, take: 5 }),
    db.serviceDefinition.findMany({ where: { orgId, key: { in: ["academic_concern", "safeguarding_concern"] } } }),
  ]);
  const students = classes.reduce((s, c) => s + c._count.enrollments, 0);
  const refer = services.find((s) => s.key === "academic_concern");
  const safeguarding = services.find((s) => s.key === "safeguarding_concern");
  return (
    <PageBody>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <Greeting ctx={ctx} prefs={prefs} subtitle={t("teacherSubtitle")} />
        <div className="flex flex-wrap gap-2">
          {refer && (
            <Button asChild data-testid="refer-student">
              <Link href="/services/academic_concern">
                <GraduationCap className="size-4" />
                {t("referStudent")}
              </Link>
            </Button>
          )}
          {safeguarding && (
            <Button asChild variant="outline" className="border-danger/40 text-danger hover:bg-danger-soft hover:text-danger" data-testid="raise-concern">
              <Link href="/services/safeguarding_concern">
                <ShieldAlert className="size-4" />
                {t("raiseConcern")}
              </Link>
            </Button>
          )}
        </div>
      </div>
      <FirstRunCard ctx={ctx} audience="teacher" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statApprovals")} value={approvals} icon={<Stamp className="size-5" />} tone={approvals ? "warning" : "success"} href="/approvals" testId="stat-approvals" />
        <StatCard label={t("statClasses")} value={classes.length} icon={<BookOpen className="size-5" />} />
        <StatCard label={t("statStudents")} value={students} icon={<Users className="size-5" />} href="/students" />
        <StatCard label={t("statReferrals")} value={referrals.filter((r) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(r.status)).length} hint={t("open")} icon={<Inbox className="size-5" />} href="/requests" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("myClasses")} icon={<BookOpen className="size-4" />} />
            <div className="grid gap-2 sm:grid-cols-2">
              {classes.map((c) => (
                <Link key={c.id} href={`/students?class=${c.id}`} className="flex items-center gap-3 rounded-lg border p-3 transition hover:border-brand/30">
                  <span className={cn("grid size-9 place-items-center rounded-md text-xs font-semibold", c.isHomeroom ? "bg-gold-soft text-[oklch(0.5_0.1_80)]" : "bg-brand-soft text-brand")}>
                    {c.gradeLevel}
                    {c.section ?? ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{pick(locale, c.nameEn, c.nameAr)}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("studentsCount", { count: c._count.enrollments })}
                      {c.isHomeroom && ` · ${t("homeroom")}`}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title={t("myReferrals")} icon={<Inbox className="size-4" />} />
            {referrals.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("noReferrals")}</p>
            ) : (
              <ul className="divide-y">
                {referrals.map((r) => (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand" data-testid="my-referral">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.student ? personName(r.student, locale) : ""}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {pick(locale, r.service.nameEn, r.service.nameAr)} · {fmtRelative(prefs, r.submittedAt)}
                        </span>
                      </span>
                      <RequestStatusBadge status={r.status} restricted={isRestrictedForViewer(ctx, r)} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <MeetingsPanel ctx={ctx} prefs={prefs} limit={4} title={t("mySchedule")} />
          <TasksPanel ctx={ctx} prefs={prefs} limit={5} />
          <AnnouncementsPanel ctx={ctx} prefs={prefs} audience="staff" />
        </div>
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------
// Counselor and wellbeing lead
// ---------------------------------------------------------------------------
export async function CounselorHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const { db, membershipId, locale } = ctx;
  const now = new Date();
  const mine = { AND: [listableCaseWhere(ctx, "dashboard"), { assigneeId: membershipId }] };
  const openStatuses = { status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING"] as ("NEW" | "OPEN" | "IN_PROGRESS" | "WAITING")[] } };
  const [open, urgent, newRefs, overdueFollowups, overdueTasks] = await Promise.all([
    db.case.count({ where: { AND: [mine, openStatuses] } }),
    db.case.findMany({ where: { AND: [mine, openStatuses, { priority: { in: ["HIGH", "URGENT"] } }] }, include: { student: true }, orderBy: { openedAt: "desc" }, take: 5 }),
    db.case.findMany({ where: { AND: [mine, { openedAt: { gte: new Date(now.getTime() - 3 * 86400_000) } }] }, include: { student: true }, orderBy: { openedAt: "desc" }, take: 5 }),
    db.case.findMany({ where: { AND: [mine, openStatuses, { nextFollowUpAt: { lt: now } }] }, include: { student: true }, orderBy: { nextFollowUpAt: "asc" }, take: 5 }),
    db.task.count({ where: { assigneeId: membershipId, status: { in: ["TODO", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
  ]);
  const CaseRow = ({ c, meta }: { c: (typeof urgent)[number]; meta: React.ReactNode }) => (
    <li>
      <Link href={`/cases/${c.id}`} className="flex items-center gap-3 py-2.5 hover:text-brand" data-testid="case-row">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold">{initials(`${c.student.firstNameEn} ${c.student.lastNameEn}`)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{personName(c.student, locale)}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {pick(locale, c.titleEn, c.titleAr)} · {meta}
          </span>
        </span>
        {c.sensitivity === "WELLBEING" ? <Pill tone="violet">{t("wellbeing")}</Pill> : <PriorityBadge priority={c.priority} />}
      </Link>
    </li>
  );
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={t("counselorSubtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statOpenCases")} value={open} icon={<FolderKanban className="size-5" />} href="/cases" testId="stat-open-cases" />
        <StatCard label={t("statUrgent")} value={urgent.length} icon={<AlertTriangle className="size-5" />} tone={urgent.length ? "danger" : "success"} href="/cases?priority=high" />
        <StatCard label={t("statNewReferrals")} value={newRefs.length} hint={t("last72h")} icon={<Inbox className="size-5" />} tone="info" />
        <StatCard label={t("statOverdue")} value={overdueFollowups.length + overdueTasks} icon={<Clock className="size-5" />} tone={overdueFollowups.length + overdueTasks ? "warning" : "success"} href="/tasks?view=overdue" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <MeetingsPanel ctx={ctx} prefs={prefs} limit={5} title={t("todaysMeetings")} onlyToday />
          <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
            <Panel>
              <PanelHeader title={t("newReferrals")} icon={<Sparkles className="size-4" />} />
              {newRefs.length ? <ul className="divide-y">{newRefs.map((c) => <CaseRow key={c.id} c={c} meta={fmtRelative(prefs, c.openedAt)} />)}</ul> : <p className="py-4 text-center text-sm text-muted-foreground">{t("none")}</p>}
            </Panel>
            <Panel>
              <PanelHeader title={t("urgentCases")} icon={<AlertTriangle className="size-4" />} />
              {urgent.length ? <ul className="divide-y">{urgent.map((c) => <CaseRow key={c.id} c={c} meta={fmtRelative(prefs, c.openedAt)} />)}</ul> : <p className="py-4 text-center text-sm text-muted-foreground">{t("none")}</p>}
            </Panel>
          </div>
          <Panel>
            <PanelHeader title={t("overdueFollowups")} icon={<Clock className="size-4" />} />
            {overdueFollowups.length ? (
              <ul className="divide-y">{overdueFollowups.map((c) => <CaseRow key={c.id} c={c} meta={t("followupWas", { when: fmtRelative(prefs, c.nextFollowUpAt) })} />)}</ul>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("none")}</p>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <TasksPanel ctx={ctx} prefs={prefs} limit={7} />
        </div>
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------
// Career advisor
// ---------------------------------------------------------------------------
export async function CareerAdvisorHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const { db, orgId, membershipId, locale } = ctx;
  const now = new Date();
  const [cases, drafts, deadlines, sessions] = await Promise.all([
    db.case.findMany({ where: { AND: [listableCaseWhere(ctx, "dashboard"), { assigneeId: membershipId, status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING"] } }] }, include: { student: true }, orderBy: { openedAt: "desc" }, take: 6 }),
    db.careerRecommendation.groupBy({ by: ["studentId"], where: { orgId, status: "DRAFT" }, _count: { _all: true } }),
    db.shortlistEntry.findMany({ where: { orgId, deadline: { gte: now, lt: new Date(now.getTime() + 45 * 86400_000) }, status: { in: ["RESEARCHING", "PREPARING"] } }, include: { student: true, university: true }, orderBy: { deadline: "asc" }, take: 6 }),
    db.appointment.count({ where: { orgId, hostId: membershipId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: new Date(now.getTime() - 7 * 86400_000), lt: new Date(now.getTime() + 7 * 86400_000) } } }),
  ]);
  const draftStudents = drafts.length ? await db.student.findMany({ where: { id: { in: drafts.map((d) => d.studentId) } } }) : [];
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={t("careerSubtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statCareerCases")} value={cases.length} icon={<Compass className="size-5" />} href="/cases" />
        <StatCard label={t("statAwaitingReview")} value={drafts.length} icon={<Sparkles className="size-5" />} tone={drafts.length ? "warning" : "success"} href="/career" testId="stat-drafts" />
        <StatCard label={t("statSessions")} value={sessions} hint={t("thisFortnight")} icon={<CalendarClock className="size-5" />} />
        <StatCard label={t("statDeadlines")} value={deadlines.length} hint={t("next45days")} icon={<Timer className="size-5" />} tone="info" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <MeetingsPanel ctx={ctx} prefs={prefs} limit={5} />
          <Panel>
            <PanelHeader title={t("careerCases")} icon={<Compass className="size-4" />} />
            <ul className="divide-y">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{personName(c.student, locale)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t("gradeSection", { grade: c.student.gradeLevel, section: c.student.section ?? "" })} · {fmtRelative(prefs, c.openedAt)}
                      </span>
                    </span>
                    <CaseStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-6">
          {draftStudents.length > 0 && (
            <Panel>
              <PanelHeader title={t("recsToReview")} icon={<Sparkles className="size-4" />} />
              <ul className="space-y-2">
                {draftStudents.map((s) => (
                  <li key={s.id}>
                    <Link href={`/career/students/${s.id}`} className="flex items-center justify-between rounded-lg border p-2.5 text-sm hover:border-brand/30">
                      {personName(s, locale)}
                      <Pill tone="warning">{t("draft")}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel>
            <PanelHeader title={t("upcomingDeadlines")} icon={<Timer className="size-4" />} />
            {deadlines.length ? (
              <ul className="space-y-3">
                {deadlines.map((d) => (
                  <li key={d.id} className="text-sm">
                    <div className="font-medium">{pick(locale, d.university.nameEn, d.university.nameAr)}</div>
                    <div className="text-xs text-muted-foreground">
                      {personName(d.student, locale)} · {fmtDate(prefs, d.deadline, "short")}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("none")}</p>
            )}
          </Panel>
          <TasksPanel ctx={ctx} prefs={prefs} limit={5} />
        </div>
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------
// Designated Safeguarding Lead
// ---------------------------------------------------------------------------
export async function DslHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const ts = await getTranslations("safeguarding");
  const { db, orgId, locale } = ctx;
  const where = listableCaseWhere(ctx, "safeguarding");
  const [cases, glass, reviews] = await Promise.all([
    db.case.findMany({ where: { AND: [where, { status: { notIn: ["CLOSED"] } }] }, include: { student: true }, orderBy: { openedAt: "desc" }, take: 8 }),
    db.breakGlassAccess.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.task.findMany({ where: { orgId, assigneeId: ctx.membershipId, sensitivity: "SAFEGUARDING", status: "TODO" }, orderBy: { dueAt: "asc" }, take: 5 }),
  ]);
  const byLevel = (lvl: string) => cases.filter((c) => c.concernLevel === lvl).length;
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={t("dslSubtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statOpenConcerns")} value={cases.length} icon={<ShieldAlert className="size-5" />} tone="danger" href="/safeguarding" testId="stat-concerns" />
        <StatCard label={ts("level.IMMEDIATE_DANGER")} value={byLevel("IMMEDIATE_DANGER")} icon={<AlertOctagon className="size-5" />} tone={byLevel("IMMEDIATE_DANGER") ? "danger" : "success"} />
        <StatCard label={ts("level.HIGH")} value={byLevel("HIGH")} icon={<AlertTriangle className="size-5" />} tone="warning" />
        <StatCard label={t("statReviewsDue")} value={reviews.length} icon={<Clock className="size-5" />} tone="info" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("activeConcerns")} icon={<ShieldAlert className="size-4" />} description={t("restrictedNote")} />
            <ul className="divide-y">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className="flex items-center gap-3 py-3 hover:text-brand" data-testid="sg-case">
                    <span className={cn("size-2.5 shrink-0 rounded-full", c.concernLevel === "IMMEDIATE_DANGER" ? "bg-danger" : c.concernLevel === "HIGH" ? "bg-warning" : c.concernLevel === "MEDIUM" ? "bg-info" : "bg-muted-foreground")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{personName(c.student, locale)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="font-mono" dir="ltr">
                          {c.number}
                        </span>{" "}
                        · {pick(locale, c.titleEn, c.titleAr)} · {fmtRelative(prefs, c.openedAt)}
                      </span>
                    </span>
                    {c.concernLevel && <Pill tone={c.concernLevel === "IMMEDIATE_DANGER" ? "danger" : c.concernLevel === "HIGH" ? "warning" : "info"}>{ts(`level.${c.concernLevel}`)}</Pill>}
                    <CaseStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title={t("breakGlassLog")} icon={<ShieldCheck className="size-4" />} />
            {glass.length ? (
              <ul className="space-y-2 text-sm">
                {glass.map((g) => (
                  <li key={g.id}>
                    {g.reason} · {fmtRelative(prefs, g.createdAt)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noBreakGlass")}</p>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <TasksPanel ctx={ctx} prefs={prefs} limit={6} />
          <MeetingsPanel ctx={ctx} prefs={prefs} limit={3} />
        </div>
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------
// Administrator and principal
// ---------------------------------------------------------------------------
export async function AdminHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const k = await schoolKpis(ctx, 30);
  const dir = ctx.locale === "ar" ? "rtl" : "ltr";
  const hrs = (n: number) => t("hoursShort", { n: fmtNumber(prefs, n) });
  const isPrincipal = ctx.roles.includes("principal");
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={isPrincipal ? t("principalSubtitle") : t("adminSubtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("kpiRequests")}
          value={fmtNumber(prefs, k.requests.thisPeriod)}
          hint={t("vsPrevious", { delta: `${k.requests.delta >= 0 ? "+" : ""}${k.requests.delta}%` })}
          icon={<TrendingUp className="size-5" />}
          href={moduleEnabled(ctx.org, "analytics") ? "/analytics" : undefined}
          testId="kpi-requests"
        />
        <StatCard label={t("kpiResolution")} value={hrs(k.avgResolutionHours)} hint={t("last30")} icon={<Timer className="size-5" />} tone="info" href={moduleEnabled(ctx.org, "analytics") ? "/analytics" : undefined} />
        <StatCard label={t("kpiOpenRequests")} value={fmtNumber(prefs, k.requests.open)} icon={<Inbox className="size-5" />} tone="warning" href="/requests?tab=all&status=open" />
        <StatCard label={t("kpiOpenCases")} value={fmtNumber(prefs, k.openCases)} hint={t("excludesSensitive")} icon={<HeartHandshake className="size-5" />} tone="gold" href="/cases" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("chartResolution")} description={t("chartResolutionHint")} />
          <TrendChart data={k.weeks} dir={dir} unit={ctx.locale === "ar" ? " س" : "h"} />
        </Panel>
        <Panel className="flex flex-col">
          <PanelHeader title={t("chartSla")} description={t("chartSlaHint")} />
          <div className="flex flex-1 items-center justify-around gap-4">
            <div className="flex flex-col items-center gap-2">
              <Ring value={k.sla} label={t("chartSla")} tone={k.sla >= 90 ? "var(--success)" : "var(--warning)"} />
              <span className="text-xs text-muted-foreground">{t("slaMet")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Ring value={k.utilization} label={t("utilization")} tone="var(--brand)" />
              <span className="text-xs text-muted-foreground">{t("utilization")}</span>
            </div>
          </div>
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("chartByService")} description={t("last30")} />
          <BarList rows={k.byService} format={(n) => fmtNumber(prefs, n)} empty={t("none")} />
        </Panel>
        <Panel>
          <PanelHeader title={t("chartByDepartment")} description={t("excludesSensitive")} />
          <BarList rows={k.byDepartment} format={(n) => fmtNumber(prefs, n)} empty={t("none")} />
        </Panel>
        <Panel>
          <PanelHeader title={t("slowest")} description={t("slowestHint")} />
          <BarList rows={k.slowest.map((s) => ({ label: s.label, value: s.value }))} format={hrs} empty={t("none")} />
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="lg:col-span-2">
          <RequestsPanel ctx={ctx} prefs={prefs} limit={4} title={t("recentRequests")} />
        </div>
        <TasksPanel ctx={ctx} prefs={prefs} limit={5} />
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------
// Other staff (registrar, IT, nurse, heads of department)
// ---------------------------------------------------------------------------
export async function StaffHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("home");
  const approvals = await ctx.db.approvalAssignee.count({ where: { orgId: ctx.orgId, membershipId: ctx.membershipId, status: "PENDING", approval: { status: "PENDING" } } });
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={t("staffSubtitle")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("statApprovals")} value={approvals} icon={<Stamp className="size-5" />} tone={approvals ? "warning" : "success"} href="/approvals" testId="stat-approvals" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <RequestsPanel ctx={ctx} prefs={prefs} limit={6} title={t("workQueue")} />
        </div>
        <div className="space-y-6">
          <TasksPanel ctx={ctx} prefs={prefs} />
          <MeetingsPanel ctx={ctx} prefs={prefs} limit={3} />
        </div>
      </div>
    </PageBody>
  );
}
