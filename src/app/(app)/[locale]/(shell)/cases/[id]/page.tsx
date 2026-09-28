import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertOctagon, CalendarPlus, ChevronLeft, Download, FileText, Lock, Mail, MessageSquare, ShieldAlert, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { initials, personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { AppointmentStatusBadge, CaseStatusBadge, Pill, PriorityBadge, SensitivityBadge, TaskStatusBadge } from "@/components/app/badges";
import { Timeline } from "@/components/app/timeline";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { SlaCountdown } from "@/components/cases/sla";
import { AddTaskForm, AmendNote, BreakGlassForm, CaseControls, ExternalReferralForm, GrantAccessForm, MessageComposer, NoteComposer, ParentDecisionForm, RevokeButton } from "@/components/cases/case-forms";
import { TaskCheck } from "@/components/dashboard/task-check";
import { CaseAiPanel } from "@/components/ai/case-ai-panel";
import { ActionPlanPanel } from "@/components/cases/action-plan";
import { caseAccess, canViewCase, SENSITIVE } from "@/server/access/case-access";
import { formatAnswers } from "@/server/forms/answers";
import type { FormSchema } from "@/server/forms/schema";

const TABS = ["overview", "timeline", "appointments", "tasks", "documents", "forms", "communications", "people", "audit"] as const;
type Tab = (typeof TABS)[number];

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.isStaff) notFound();
  const t = await getTranslations("case");
  const ts = await getTranslations("status");
  const tsg = await getTranslations("safeguarding");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const c = await db.case.findUnique({ where: { id }, include: { student: true, department: true } });
  if (!c) notFound();
  const access = await caseAccess(ctx, c);

  if (access.level === "status_only") {
    return (
      <PageBody className="max-w-3xl">
        <Panel className="flex items-start gap-4 p-6">
          <Lock className="mt-1 size-5 text-violet-700" />
          <div>
            <div className="font-semibold">{t("statusOnlyTitle")}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t("statusOnlyBody")}</p>
            <div className="mt-3">
              <Pill tone={c.status === "NEW" ? "info" : "brand"} dot>
                {c.status === "NEW" ? ts("received") : ts("beingHandled")}
              </Pill>
            </div>
          </div>
        </Panel>
      </PageBody>
    );
  }
  if (access.level === "none") {
    if (!access.canBreakGlass) notFound();
    return (
      <PageBody className="max-w-2xl">
        <Panel className="space-y-4 border-danger/30 p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-danger-soft text-danger">
              <ShieldAlert className="size-5" />
            </span>
            <div>
              <div className="font-semibold">{t("restrictedTitle")}</div>
              <p className="text-sm text-muted-foreground">{t("restrictedBody")}</p>
            </div>
          </div>
          <BreakGlassForm caseId={c.id} />
        </Panel>
      </PageBody>
    );
  }

  // Full access. Viewing a sensitive case is recorded in the audit log.
  await canViewCase(ctx, c);
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";
  const sensitive = SENSITIVE.includes(c.sensitivity);
  const isSg = c.sensitivity === "SAFEGUARDING";
  const canManage = isSg ? ctx.can("safeguarding.manage") || access.via === "grant" || access.via === "assignee" : ctx.can("cases.manage") || access.via === "assignee" || access.via === "participant";

  const staff = await db.membership.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", staffProfile: { isNot: null } }, include: { user: true } });
  const staffOptions = staff.map((m) => ({ value: m.id, label: userName(m.user, locale), keywords: `${m.user.nameEn} ${m.user.nameAr ?? ""}` })).sort((a, b) => a.label.localeCompare(b.label));
  // Students and parents can author notes or refer too (for example a student's own request), so look them up as well.
  const authorIds = (await db.caseNote.findMany({ where: { caseId: c.id }, select: { authorId: true } })).map((n) => n.authorId);
  const others = await db.membership.findMany({ where: { id: { in: [...new Set([c.referrerId, c.assigneeId, ...authorIds].filter((x): x is string => Boolean(x) && !staff.some((m) => m.id === x)))] } }, include: { user: true } });
  const nameOf = (mid: string | null | undefined) => (mid ? userName((staff.find((m) => m.id === mid) ?? others.find((m) => m.id === mid))?.user, locale) : "");
  const guardians = await db.guardianLink.findMany({ where: { studentId: c.studentId }, include: { guardian: true }, orderBy: { isPrimary: "desc" } });
  const guardianOpts = guardians.map((g) => ({ id: g.guardianId, name: `${personName(g.guardian, locale)} (${pick(locale, g.relationshipEn, g.relationshipAr)})` }));

  const counts = await Promise.all([
    db.appointment.count({ where: { caseId: c.id } }),
    db.task.count({ where: { caseId: c.id, status: { in: ["TODO", "IN_PROGRESS"] } } }),
    db.document.count({ where: { caseId: c.id } }),
    db.message.count({ where: { caseId: c.id } }),
  ]);
  const tabCount: Partial<Record<Tab, number>> = { appointments: counts[0], tasks: counts[1], documents: counts[2], communications: counts[3] };
  const showAudit = ctx.can("audit.view") || access.via === "assignee" || ctx.can("safeguarding.manage");

  return (
    <PageBody>
      <Link href={isSg ? "/safeguarding" : "/cases"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {isSg ? tsg("title") : t("back")}
      </Link>

      {isSg && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger-soft px-4 py-2 text-sm text-danger" data-testid="restricted-banner">
          <ShieldAlert className="size-4" />
          {access.via === "break_glass" ? t("breakGlassBanner") : t("sgBanner")}
        </div>
      )}
      {c.sensitivity === "WELLBEING" && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-800">
          <Lock className="size-4" />
          {t("wbBanner")}
        </div>
      )}

      {/* Header */}
      <Panel className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Link href={`/students/${c.studentId}`} className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-[oklch(0.5_0.12_240)] text-lg font-semibold text-white">
              {initials(`${c.student.firstNameEn} ${c.student.lastNameEn}`)}
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono" dir="ltr">
                  {c.number}
                </span>
                <Pill>{ts(`caseType.${c.type}`)}</Pill>
                {c.sensitivity !== c.type && <SensitivityBadge sensitivity={c.sensitivity} />}
                {c.concernLevel && <Pill tone={c.concernLevel === "IMMEDIATE_DANGER" ? "danger" : c.concernLevel === "HIGH" ? "warning" : "info"}>{tsg(`level.${c.concernLevel}`)}</Pill>}
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight" data-testid="case-title">
                {pick(locale, c.titleEn, c.titleAr)}
              </h1>
              <Link href={`/students/${c.studentId}`} className="text-sm text-muted-foreground hover:text-brand">
                {personName(c.student, locale)} · {t("grade", { grade: `${c.student.gradeLevel}${c.student.section ?? ""}` })}
              </Link>
            </div>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t("assignee")}</dt>
              <dd className="font-medium">{nameOf(c.assigneeId) || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("priority")}</dt>
              <dd>
                <PriorityBadge priority={c.priority} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("status")}</dt>
              <dd>
                <CaseStatusBadge status={c.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("sla")}</dt>
              <dd>
                <SlaCountdown due={c.slaDueAt} closed={c.status === "RESOLVED" || c.status === "CLOSED"} />
              </dd>
            </div>
          </dl>
        </div>
      </Panel>

      {/* Tabs */}
      <nav className="-mb-2 flex gap-1 overflow-x-auto border-b" aria-label={t("tabsLabel")}>
        {TABS.filter((x) => x !== "audit" || showAudit).map((x) => (
          <Link
            key={x}
            href={`/cases/${c.id}${x === "overview" ? "" : `?tab=${x}`}`}
            scroll={false}
            data-testid={`tab-${x}`}
            className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition", tab === x ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t(`tab.${x}`)}
            {tabCount[x] ? <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{tabCount[x]}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview />}
      {tab === "timeline" && <TimelineTab />}
      {tab === "appointments" && <AppointmentsTab />}
      {tab === "tasks" && <TasksTab />}
      {tab === "documents" && <DocumentsTab />}
      {tab === "forms" && <FormsTab />}
      {tab === "communications" && <CommsTab />}
      {tab === "people" && <PeopleTab />}
      {tab === "audit" && showAudit && <AuditTab />}
    </PageBody>
  );

  async function Overview() {
    const [request, decisions, referrals, attendance, notes] = await Promise.all([
      db.request.findFirst({ where: { caseId: c!.id }, include: { service: true } }),
      db.parentNotificationDecision.findMany({ where: { caseId: c!.id }, orderBy: { createdAt: "desc" } }),
      db.externalReferral.findMany({ where: { caseId: c!.id }, orderBy: { referredAt: "desc" } }),
      db.attendanceRecord.groupBy({ by: ["status"], where: { studentId: c!.studentId, date: { gte: new Date(Date.now() - 30 * 86400_000) } }, _count: { _all: true } }),
      db.caseNote.findMany({ where: { caseId: c!.id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { occurredAt: "desc" }, take: 3 }),
    ]);
    const total = attendance.reduce((s, a) => s + a._count._all, 0);
    const present = attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").reduce((s, a) => s + a._count._all, 0);
    return (
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("summary")} />
            <p className="whitespace-pre-line text-sm leading-relaxed">{pick(locale, c!.summaryEn, c!.summaryAr) || t("noSummary")}</p>
            {request && (
              <Link href={`/requests/${request.id}`} className="mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs hover:border-brand/30">
                <FileText className="size-3.5 text-brand" />
                {t("openedFrom", { number: request.number, service: pick(locale, request.service.nameEn, request.service.nameAr) })}
              </Link>
            )}
          </Panel>
          <ActionPlanPanel caseId={c!.id} studentId={c!.studentId} canManage={canManage} />
          <Panel>
            <PanelHeader
              title={t("latestNotes")}
              action={
                <Link href={`/cases/${c!.id}?tab=timeline`} className="text-xs font-medium text-brand hover:underline">
                  {t("fullChronology")}
                </Link>
              }
            />
            {notes.length ? (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-muted/40 p-3">
                    <div className="mb-1 text-xs text-muted-foreground">
                      {t(`noteKind.${n.kind}`)} · {nameOf(n.authorId)} · {fmtRelative(prefs, n.occurredAt)}
                    </div>
                    <p className="line-clamp-3 text-sm">{n.versions[0]?.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noNotes")}</p>
            )}
          </Panel>
          {sensitive && (
            <Panel>
              <PanelHeader title={t("parentNotification")} description={t("parentNotificationHint")} icon={<Mail className="size-4" />} />
              {decisions.length > 0 && (
                <ul className="mb-4 space-y-2">
                  {decisions.map((d) => (
                    <li key={d.id} className="rounded-lg border p-3 text-sm" data-testid="parent-decision">
                      <div className="flex items-center justify-between gap-2">
                        <Pill tone={d.decision === "NOTIFY" ? "success" : d.decision === "DEFER" ? "warning" : "neutral"}>{t(`decision.${d.decision}`)}</Pill>
                        <span className="text-xs text-muted-foreground">
                          {nameOf(d.decidedById)} · {fmtDateTime(prefs, d.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-muted-foreground">{d.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
              {canManage && <ParentDecisionForm caseId={c!.id} guardians={guardianOpts} />}
            </Panel>
          )}
          {isSg && (
            <Panel>
              <PanelHeader title={t("externalReferrals")} icon={<ShieldCheck className="size-4" />} action={canManage ? <ExternalReferralForm caseId={c!.id} /> : undefined} />
              {referrals.length ? (
                <ul className="space-y-2 text-sm">
                  {referrals.map((r) => (
                    <li key={r.id} className="rounded-lg border p-3">
                      <div className="font-medium">{r.agencyEn}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(prefs, r.referredAt)} {r.referenceNo && <>· <span dir="ltr">{r.referenceNo}</span></>} {r.contactName && `· ${r.contactName}`}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("noReferrals")}</p>
              )}
            </Panel>
          )}
        </div>
        <div className="space-y-6">
          {canManage && (
            <Panel>
              <PanelHeader title={t("manage")} />
              <CaseControls caseId={c!.id} status={c!.status} priority={c!.priority} assigneeId={c!.assigneeId} followUp={c!.nextFollowUpAt ? c!.nextFollowUpAt.toISOString().slice(0, 10) : null} staff={staffOptions} />
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/book?case=${c!.id}&student=${c!.studentId}&type=counselor_meeting`}>
                    <CalendarPlus className="size-4" />
                    {t("bookMeeting")}
                  </Link>
                </Button>
                {(isSg ? ctx.can("safeguarding.export") : true) && (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/cases/${c!.id}/export`} data-testid="export-case">
                      <Download className="size-4" />
                      {t("export")}
                    </a>
                  </Button>
                )}
              </div>
            </Panel>
          )}
          <CaseAiPanel caseId={c!.id} sensitive={sensitive || c!.sensitivity === "MEDICAL"} aiSensitiveEnabled={ctx.org.aiSensitiveDataEnabled} aiEnabled={ctx.org.aiEnabled} />
          <Panel>
            <PanelHeader title={t("student")} icon={<UserRound className="size-4" />} />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("studentNo")}</dt>
                <dd className="font-mono" dir="ltr">
                  {c!.student.studentNo}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("attendance30")}</dt>
                <dd className="tabular-nums">{total ? Math.round((present / total) * 100) : 100}%</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("department")}</dt>
                <dd>{c!.department ? pick(locale, c!.department.nameEn, c!.department.nameAr) : "-"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("opened")}</dt>
                <dd>{fmtDate(prefs, c!.openedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("referrer")}</dt>
                <dd>{nameOf(c!.referrerId) || "-"}</dd>
              </div>
              {c!.nextFollowUpAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t("followUp")}</dt>
                  <dd className={c!.nextFollowUpAt < new Date() ? "font-medium text-danger" : ""}>{fmtDate(prefs, c!.nextFollowUpAt)}</dd>
                </div>
              )}
            </dl>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full">
              <Link href={`/students/${c!.studentId}`}>{t("fullProfile")}</Link>
            </Button>
          </Panel>
        </div>
      </div>
    );
  }

  async function TimelineTab() {
    const [notes, events] = await Promise.all([
      db.caseNote.findMany({ where: { caseId: c!.id }, include: { versions: { orderBy: { version: "desc" } } }, orderBy: { occurredAt: "desc" } }),
      db.timelineEvent.findMany({ where: { caseId: c!.id, NOT: { kind: { startsWith: "note_" } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    const items = [
      ...notes.map((n) => ({ at: n.occurredAt, type: "note" as const, n })),
      ...events.map((e) => ({ at: e.createdAt, type: "event" as const, e })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {canManage && <NoteComposer caseId={c!.id} sensitive={sensitive} />}
          <Panel>
            <ol className="relative space-y-5">
              <span className="absolute inset-y-2 start-[15px] w-px bg-border" aria-hidden />
              {items.map((it) =>
                it.type === "note" ? (
                  <li key={it.n.id} className="relative flex gap-3" data-testid="chronology-note">
                    <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-card", it.n.kind === "DECISION" ? "bg-gold-soft text-[oklch(0.5_0.1_80)]" : it.n.kind === "CONTACT" ? "bg-info-soft text-info" : "bg-brand-soft text-brand")}>
                      <MessageSquare className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 rounded-lg border bg-card p-3">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          <span className="font-medium text-foreground">{t(`noteKind.${it.n.kind}`)}</span> · {nameOf(it.n.authorId)} · {fmtDateTime(prefs, it.n.occurredAt)}
                          {it.n.currentVersion > 1 && <span className="ms-1 text-[oklch(0.55_0.14_65)]">· {t("amendedTag")}</span>}
                        </span>
                        {canManage && (
                          <AmendNote
                            noteId={it.n.id}
                            current={it.n.versions[0]?.body ?? ""}
                            versions={it.n.versions.map((v) => ({ version: v.version, body: v.body, when: fmtDateTime(prefs, v.createdAt), who: nameOf(v.editedById), reason: v.reason }))}
                          />
                        )}
                      </div>
                      <p className="whitespace-pre-line text-sm">{it.n.versions[0]?.body}</p>
                    </div>
                  </li>
                ) : (
                  <li key={it.e.id} className="relative flex gap-3">
                    <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground ring-4 ring-card">
                      <Sparkles className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm">{pick(locale, it.e.titleEn, it.e.titleAr)}</span>
                        <time className="text-xs text-muted-foreground">{fmtDateTime(prefs, it.e.createdAt)}</time>
                      </div>
                      {(it.e.bodyEn || it.e.bodyAr) && <p className="text-xs text-muted-foreground">{pick(locale, it.e.bodyEn, it.e.bodyAr)}</p>}
                    </div>
                  </li>
                ),
              )}
            </ol>
          </Panel>
        </div>
        <Panel className="h-fit text-sm">
          <PanelHeader title={t("chronologyRules")} icon={<Lock className="size-4" />} />
          <ul className="list-disc space-y-1.5 ps-4 text-muted-foreground">
            <li>{t("rule1")}</li>
            <li>{t("rule2")}</li>
            <li>{t("rule3")}</li>
          </ul>
        </Panel>
      </div>
    );
  }

  async function AppointmentsTab() {
    const appts = await db.appointment.findMany({ where: { caseId: c!.id }, include: { type: true }, orderBy: { startsAt: "desc" } });
    return (
      <Panel>
        <PanelHeader
          title={t("tab.appointments")}
          action={
            <Button asChild size="sm">
              <Link href={`/book?case=${c!.id}&student=${c!.studentId}&type=counselor_meeting`}>
                <CalendarPlus className="size-4" />
                {t("bookMeeting")}
              </Link>
            </Button>
          }
        />
        {appts.length ? (
          <ul className="divide-y">
            {appts.map((a) => (
              <li key={a.id}>
                <Link href={`/meetings/${a.id}`} className="flex items-center gap-3 py-3 text-sm hover:text-brand">
                  <span className="flex-1">
                    <span className="block font-medium">{pick(locale, a.type.nameEn, a.type.nameAr)}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(prefs, a.startsAt)} · {nameOf(a.hostId)}
                    </span>
                  </span>
                  <AppointmentStatusBadge status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("noAppointments")} />
        )}
      </Panel>
    );
  }

  async function TasksTab() {
    const tasks = await db.task.findMany({ where: { caseId: c!.id }, orderBy: [{ status: "asc" }, { dueAt: "asc" }] });
    return (
      <div className="space-y-4">
        {canManage && <AddTaskForm caseId={c!.id} studentId={c!.studentId} staff={staffOptions} meId={ctx.membershipId} />}
        <Panel padded={false}>
          {tasks.length ? (
            <ul className="divide-y">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 px-5 py-3">
                  <TaskCheck id={task.id} done={task.status === "DONE"} label={pick(locale, task.titleEn, task.titleAr)} />
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm", task.status === "DONE" && "text-muted-foreground line-through")}>{pick(locale, task.titleEn, task.titleAr)}</div>
                    <div className="text-xs text-muted-foreground">
                      {nameOf(task.assigneeId)}
                      {task.dueAt && ` · ${fmtDate(prefs, task.dueAt)}`}
                    </div>
                  </div>
                  <TaskStatusBadge status={task.status} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6">
              <EmptyState title={t("noTasks")} />
            </div>
          )}
        </Panel>
      </div>
    );
  }

  async function DocumentsTab() {
    const docs = await db.document.findMany({ where: { OR: [{ caseId: c!.id }, ...(sensitive ? [] : [{ studentId: c!.studentId, sensitivity: "STANDARD" as const }])] }, orderBy: { createdAt: "desc" } });
    return (
      <Panel>
        <PanelHeader title={t("tab.documents")} description={sensitive ? t("docsSensitive") : t("docsHint")} />
        {docs.length ? (
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <FileText className="size-5 text-brand" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{pick(locale, d.titleEn, d.titleAr)}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(prefs, d.createdAt)}</div>
                </div>
                <SensitivityBadge sensitivity={d.sensitivity} />
                <Button asChild variant="ghost" size="icon" aria-label={t("download")}>
                  <a href={`/api/documents/${d.id}/download`}>
                    <Download className="size-4" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("noDocuments")} body={t("uploadHint")} action={<Button asChild size="sm" variant="outline"><Link href={`/documents?student=${c!.studentId}&case=${c!.id}`}>{t("goUpload")}</Link></Button>} />
        )}
      </Panel>
    );
  }

  async function FormsTab() {
    const reqs = await db.request.findMany({ where: { caseId: c!.id }, include: { submission: { include: { formVersion: { include: { form: true } } } } } });
    const blocks = await Promise.all(
      reqs.filter((r) => r.submission).map(async (r) => ({ r, answers: await formatAnswers(ctx, r.submission!.formVersion.schema as unknown as FormSchema, r.submission!.data as Record<string, unknown>) })),
    );
    return blocks.length ? (
      <div className="space-y-4">
        {blocks.map(({ r, answers }) => (
          <Panel key={r.id}>
            <PanelHeader title={pick(locale, r.submission!.formVersion.form.nameEn, r.submission!.formVersion.form.nameAr)} description={`${r.number} · ${fmtDateTime(prefs, r.submittedAt)}`} />
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {answers.map((a) => (
                <div key={a.id} className={a.kind !== "text" ? "sm:col-span-2" : ""}>
                  <dt className="text-xs text-muted-foreground">{a.label}</dt>
                  <dd className="whitespace-pre-line text-sm">{a.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        ))}
      </div>
    ) : (
      <EmptyState title={t("noForms")} />
    );
  }

  async function CommsTab() {
    const msgs = await db.message.findMany({ where: { caseId: c!.id }, orderBy: { createdAt: "desc" } });
    const hasNotify = sensitive ? await db.parentNotificationDecision.findFirst({ where: { caseId: c!.id, decision: "NOTIFY" } }) : true;
    return (
      <div className="space-y-4">
        {canManage && <MessageComposer caseId={c!.id} guardians={guardianOpts} emailBlockedReason={hasNotify ? null : t("emailNeedsDecision")} />}
        <Panel>
          {msgs.length ? (
            <ul className="space-y-3">
              {msgs.map((m) => (
                <li key={m.id} className={cn("rounded-lg border p-3", m.channel === "EMAIL" ? "bg-info-soft/40" : "bg-card")}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {m.channel === "EMAIL" ? <Mail className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                    <span className="font-medium text-foreground">{nameOf(m.fromId)}</span>
                    {m.toLabel && <span>{t("to", { name: m.toLabel })}</span>}
                    <span className="ms-auto">{fmtDateTime(prefs, m.createdAt)}</span>
                  </div>
                  {m.subject && <div className="text-sm font-medium">{m.subject}</div>}
                  <p className="whitespace-pre-line text-sm">{m.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("noMessages")} />
          )}
        </Panel>
      </div>
    );
  }

  async function PeopleTab() {
    const [participants, grants] = await Promise.all([
      db.caseParticipant.findMany({ where: { caseId: c!.id }, orderBy: { createdAt: "asc" } }),
      db.caseAccessGrant.findMany({ where: { caseId: c!.id }, orderBy: { createdAt: "desc" } }),
    ]);
    const now = new Date();
    return (
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("team")} />
          <ul className="space-y-2">
            {[...new Map(participants.filter((p) => p.membershipId).map((p) => [`${p.membershipId}-${p.role}`, p])).values()].map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-sm">
                <span className="grid size-8 place-items-center rounded-full bg-muted text-[11px] font-semibold">{initials(staff.find((s) => s.id === p.membershipId)?.user.nameEn ?? "")}</span>
                <span className="flex-1">{nameOf(p.membershipId)}</span>
                <Pill>{t(`role.${p.role}`)}</Pill>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <div className="mb-2 text-xs font-medium text-muted-foreground">{t("family")}</div>
            <ul className="space-y-2 text-sm">
              {guardians.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3">
                  <span>{personName(g.guardian, locale)}</span>
                  <span className="text-xs text-muted-foreground">{pick(locale, g.relationshipEn, g.relationshipAr)}</span>
                </li>
              ))}
            </ul>
            {sensitive && <p className="mt-3 text-xs text-violet-700">{t("familyNotAuto")}</p>}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("accessGrants")} description={t("accessGrantsHint")} />
          <ul className="mb-4 space-y-2">
            {grants.map((g) => {
              const active = !g.revokedAt && (!g.expiresAt || g.expiresAt > now);
              return (
                <li key={g.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{nameOf(g.membershipId)}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.reason} · {t("grantedBy", { name: nameOf(g.grantedById) })}
                      {g.expiresAt && ` · ${t("until", { date: fmtDate(prefs, g.expiresAt) })}`}
                    </div>
                  </div>
                  {active ? canManage && <RevokeButton grantId={g.id} /> : <Pill>{t("inactive")}</Pill>}
                </li>
              );
            })}
            {grants.length === 0 && <li className="text-sm text-muted-foreground">{t("noGrants")}</li>}
          </ul>
          {canManage && (isSg ? ctx.can("safeguarding.manage") : true) && <GrantAccessForm caseId={c!.id} staff={staffOptions} />}
        </Panel>
      </div>
    );
  }

  async function AuditTab() {
    const events = await db.auditEvent.findMany({ where: { entityType: "Case", entityId: c!.id }, orderBy: { createdAt: "desc" }, take: 100 });
    return (
      <Panel padded={false}>
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-medium">
              <th>{t("auditWhen")}</th>
              <th>{t("auditWho")}</th>
              <th>{t("auditAction")}</th>
              <th>{t("auditReason")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e) => (
              <tr key={e.id} className="[&>td]:px-4 [&>td]:py-2.5" data-testid="audit-row">
                <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(prefs, e.createdAt)}</td>
                <td>{nameOf(e.actorId)}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    {e.action === "case.break_glass" && <AlertOctagon className="size-3.5 text-danger" />}
                    {t.has(`auditActions.${e.action.replace(/\./g, "_")}`) ? t(`auditActions.${e.action.replace(/\./g, "_")}`) : e.action}
                  </span>
                </td>
                <td className="text-xs text-muted-foreground">{e.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    );
  }
}
