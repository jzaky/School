import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarClock, FileText, ListChecks, Lock, MessageSquare, Settings2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtRelative } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Timeline, type TimelineItem } from "@/components/app/timeline";
import { Button } from "@/components/ui/button";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { DeadlineLine, Progress, StagePill, UrgencyPill } from "@/components/applications/app-ui";
import { AssignTeacher, CounselorSelect, DueInput, GenerateTasksButton, ItemCheck, ItemStatusSelect, NotesForm, PlanSelect, StageControl } from "@/components/applications/app-client";
import { canEditItems, readableApplication, viewerOf } from "@/server/applications/access";
import { applicationDeadlines, LEDGER_QUEUE, LEDGER_TASK } from "@/server/applications/service";
import { deadlineView } from "@/server/applications/page-data";
import { isSubmissionKind, urgencyFor } from "@/server/applications/deadlines";
import { ITEM_KINDS, ITEM_STATUSES, itemComplete, type Stage } from "@/server/applications/types";

export async function generateMetadata() {
  const t = await getTranslations("applications");
  return { title: t("title") };
}

const PUBLIC_EVENTS = ["applications.start", "applications.stage", "applications.letter.assign", "applications.letter.sent", "applications.tasks.generate"];

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const app = await readableApplication(ctx, id);
  if (!app) notFound();
  const t = await getTranslations("applications");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const viewer = viewerOf(ctx);
  const manager = viewer === "manager";
  const editable = await canEditItems(ctx, app.studentId);
  const now = new Date();

  const letterTaskIds = app.items.filter((i) => i.kind === "RECOMMENDATION" && i.taskId).map((i) => i.taskId!);
  const [student, university, program, counselor, deadlines, letterTasks, events] = await Promise.all([
    db.student.findFirst({ where: { id: app.studentId } }),
    db.university.findFirst({ where: { id: app.universityId } }),
    app.programId ? db.universityProgram.findFirst({ where: { id: app.programId } }) : null,
    app.counselorId ? db.membership.findFirst({ where: { id: app.counselorId }, include: { user: true } }) : null,
    tenantTx(orgId, (tx) => applicationDeadlines(tx, app, now)),
    letterTaskIds.length ? db.task.findMany({ where: { id: { in: letterTaskIds } }, select: { id: true, status: true, assigneeId: true } }) : [],
    db.auditEvent.findMany({ where: { orgId, entityType: "Application", entityId: app.id, ...(manager ? {} : { action: { in: PUBLIC_EVENTS } }) }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  if (!student || !university) notFound();

  // Manager-only data: teachers for letters, counselors, planned tasks.
  const [teachers, counselors, ledger] = manager
    ? await Promise.all([
        db.membership.findMany({ where: { orgId, status: "ACTIVE", roles: { some: { role: { key: { in: ["teacher", "department_head", "counselor", "career_advisor"] } } } } }, include: { user: true }, take: 300 }),
        db.membership.findMany({ where: { orgId, status: "ACTIVE", roles: { some: { role: { key: { in: ["counselor", "career_advisor"] } } } } }, include: { user: true } }),
        db.jobRun.findMany({ where: { orgId, queue: LEDGER_QUEUE, name: LEDGER_TASK, idempotencyKey: { startsWith: `app:${app.id}:` } } }),
      ])
    : [[], [], []];
  const ledgerRes = ledger.map((r) => r.result as { taskId: string; itemId: string; role: string; archivedReason: string | null; dateLocked: boolean });
  const plannedTasks = ledgerRes.length ? await db.task.findMany({ where: { id: { in: ledgerRes.map((r) => r.taskId) } }, orderBy: { dueAt: "asc" } }) : [];
  const people = await db.membership.findMany({ where: { id: { in: [...new Set([...letterTasks.map((x) => x.assigneeId), ...events.map((e) => e.actorId)].filter(Boolean) as string[])] } }, include: { user: true } });
  const nameOf = (mid: string | null | undefined) => userName(people.find((p) => p.id === mid)?.user ?? teachers.find((p) => p.id === mid)?.user, locale);

  const items = [...app.items].sort((a, b) => ITEM_KINDS.indexOf(a.kind as never) - ITEM_KINDS.indexOf(b.kind as never));
  const done = items.filter((i) => itemComplete(i.status)).length;
  const stageName = (s: unknown) => (typeof s === "string" ? t(`stage.${s}`) : "");
  const timeline: TimelineItem[] = events.map((e) => {
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    const map: Record<string, { kind: string; title: string }> = {
      "applications.start": { kind: "case_opened", title: t("event.start") },
      "applications.stage": { kind: "status", title: t("event.stage", { from: stageName(meta.from), to: stageName(meta.to) }) },
      "applications.letter.assign": { kind: "message", title: t("event.letterAssign") },
      "applications.letter.sent": { kind: "completed", title: t("event.letterSent") },
      "applications.tasks.generate": { kind: "task", title: t("event.tasks") },
      "applications.item.status": { kind: "approved", title: t("event.item") },
      "applications.item.due": { kind: "wait", title: t("event.due") },
      "applications.notes": { kind: "note", title: t("event.notes") },
      "applications.plan": { kind: "status", title: t("event.plan") },
      "applications.counselor": { kind: "task", title: t("event.counselor") },
    };
    const m = map[e.action] ?? { kind: "status", title: t("event.item") };
    return { id: e.id, kind: m.kind, title: m.title, when: fmtRelative(prefs, e.createdAt, now), whenTitle: fmtDate(prefs, e.createdAt), actor: e.actorId ? nameOf(e.actorId) : null };
  });
  const planOptions = [...new Set(deadlines.all.filter((d) => isSubmissionKind(d.kind)).map((d) => d.kind))].map((k) => ({ value: k, label: t(`deadlineKind.${k}`) }));
  const teacherOpts = teachers.map((m) => ({ value: m.id, label: userName(m.user, locale) })).sort((a, b) => a.label.localeCompare(b.label));
  const counselorOpts = counselors.map((m) => ({ value: m.id, label: userName(m.user, locale) }));
  const title = program ? pick(locale, program.nameEn, program.nameAr) : pick(locale, university.nameEn, university.nameAr);

  return (
    <PageBody className="max-w-6xl">
      <Link href={manager ? "/career/applications/manage" : "/career/applications"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {manager ? t("board") : t("back")}
      </Link>
      <PageHeader
        eyebrow={viewer === "student" ? t(`route.${app.route ?? "DIRECT"}`) : `${personName(student, locale)} · ${t("filter.gradeN", { n: student.gradeLevel })}`}
        title={title}
        description={`${pick(locale, university.nameEn, university.nameAr)} · ${countryLabel(university.countryCode, locale)} · ${t("intake", { year: app.intakeYear })}`}
        actions={<StagePill stage={app.stage} />}
      />
      {viewer === "parent" && <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="parent-readonly">{t("parentReadOnly")}</p>}

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          {editable && (
            <Panel>
              <PanelHeader title={t("stageLabel")} description={app.submittedAt ? t("submittedOn", { date: fmtDate(prefs, app.submittedAt) }) + (app.decidedAt ? ` · ${t("decidedOn", { date: fmtDate(prefs, app.decidedAt) })}` : "") : undefined} />
              <StageControl applicationId={app.id} stage={app.stage as Stage} actor={manager ? "staff" : "student"} />
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t("checklist")} description={t("checklistHint")} icon={<ListChecks className="size-4" />} />
            <div className="mb-4">
              <Progress done={done} total={items.length} />
            </div>
            <ul className="divide-y" data-testid="checklist">
              {items.map((i) => {
                const letter = i.kind === "RECOMMENDATION";
                const lt = letter ? letterTasks.find((x) => x.id === i.taskId) : null;
                const u = !itemComplete(i.status) && i.dueAt ? urgencyFor(i.dueAt, now) : null;
                return (
                  <li key={i.id} className={cn("flex flex-col gap-2 py-3", !manager && "sm:flex-row sm:items-start")} data-testid="checklist-item">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {editable && !manager && !letter ? <ItemCheck itemId={i.id} done={itemComplete(i.status)} label={pick(locale, i.titleEn, i.titleAr)} /> : null}
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-sm font-medium", itemComplete(i.status) && "text-muted-foreground line-through")}>{pick(locale, i.titleEn, i.titleAr)}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Pill>{t(`kind.${i.kind}`)}</Pill>
                          {(!editable || !manager) && <Pill tone={i.status === "DONE" ? "success" : i.status === "IN_PROGRESS" ? "brand" : "neutral"}>{t(`itemStatus.${i.status}`)}</Pill>}
                          {i.dueAt && <span>{t("due", { date: fmtDate(prefs, i.dueAt) })}</span>}
                          {u && <UrgencyPill bucket={u.bucket} days={u.days} />}
                        </div>
                        {letter && (
                          <div className="mt-1.5 text-xs text-muted-foreground" data-testid="letter-status">
                            {lt?.assigneeId ? t("assignedTo", { name: nameOf(lt.assigneeId) }) : t("letterNotAssigned")}
                            {lt?.status === "DONE" && ` · ${t("sent")}`}
                          </div>
                        )}
                      </div>
                    </div>
                    {manager && (
                      <div className="flex flex-wrap items-center gap-2">
                        <ItemStatusSelect itemId={i.id} status={i.status} statuses={[...ITEM_STATUSES]} />
                        <DueInput itemId={i.id} value={i.dueAt ? i.dueAt.toISOString().slice(0, 10) : null} />
                        {letter && i.status !== "DONE" && <AssignTeacher itemId={i.id} teachers={teacherOpts} current={lt?.assigneeId ?? null} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {items.some((i) => i.kind === "RECOMMENDATION") && <p className="mt-3 text-xs text-muted-foreground">{t("letterPrivate")}</p>}
          </Panel>

          {manager && (
            <Panel>
              <PanelHeader title={t("tasks")} description={t("tasksHint")} icon={<CalendarClock className="size-4" />} action={<GenerateTasksButton applicationIds={[app.id]} label={t("generateTasks")} variant="default" />} />
              {plannedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
              ) : (
                <ul className="divide-y text-sm" data-testid="planned-tasks">
                  {plannedTasks.map((task) => {
                    const r = ledgerRes.find((x) => x.taskId === task.id);
                    return (
                      <li key={task.id} className="flex flex-wrap items-center gap-2 py-2">
                        <span className={cn("min-w-0 flex-1", task.status === "CANCELLED" && "text-muted-foreground line-through")}>{pick(locale, task.titleEn, task.titleAr)}</span>
                        {r?.dateLocked && <Lock className="size-3.5 text-muted-foreground" aria-label={t("lockedHint")} />}
                        {r?.role && <Pill>{t(`owner.${r.role}`)}</Pill>}
                        <Pill tone={task.status === "DONE" ? "success" : task.status === "CANCELLED" ? "neutral" : "brand"}>{t(`taskStatus.${task.status}`)}</Pill>
                        {task.dueAt && <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(prefs, task.dueAt, "short")}</span>}
                        {task.status === "CANCELLED" && r?.archivedReason && <span className="w-full text-xs text-muted-foreground">{t("archived", { reason: r.archivedReason })}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t("timeline")} />
            <Timeline items={timeline} empty={t("timelineEmpty")} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title={t("deadlines")} description={t("deadlinesHint")} icon={<CalendarClock className="size-4" />} />
            {deadlines.all.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noDeadline")}</p>
            ) : (
              <ul className="space-y-3" data-testid="deadlines">
                {deadlines.all.map((d) => {
                  const v = deadlineView(d, prefs, now);
                  const primary = deadlines.primary?.kind === d.kind;
                  return (
                    <li key={d.kind} className={cn("rounded-lg border p-3", primary && "border-brand/40 bg-brand-soft/30")} data-testid="deadline-row">
                      <div className="mb-1 text-sm font-medium">{t(`deadlineKind.${d.kind}`)}</div>
                      <DeadlineLine d={v} compact />
                      <div className="mt-1 text-xs">
                        <span className={d.confirm ? "text-[oklch(0.55_0.14_65)]" : "text-muted-foreground"}>{t(`source.${d.source}`)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {manager && planOptions.length > 1 && (
              <div className="mt-4 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">{t("decisionPlan")}</div>
                <PlanSelect applicationId={app.id} value={app.decisionPlan} options={planOptions} />
              </div>
            )}
          </Panel>

          {manager && (
            <Panel>
              <PanelHeader title={t("counselor")} icon={<Settings2 className="size-4" />} />
              <CounselorSelect applicationId={app.id} value={app.counselorId} options={counselorOpts} />
            </Panel>
          )}
          {!manager && counselor && (
            <Panel>
              <PanelHeader title={t("counselor")} />
              <p className="text-sm">{userName(counselor.user, locale)}</p>
            </Panel>
          )}

          {manager && (
            <Panel>
              <PanelHeader title={t("notes")} description={t("notesHint")} icon={<MessageSquare className="size-4" />} />
              <NotesForm applicationId={app.id} notes={app.notes ?? ""} />
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t("documents")} description={t("documentsHint")} icon={<FileText className="size-4" />} />
            <Button asChild variant="outline" size="sm">
              <Link href={manager ? `/documents?student=${student.id}` : "/documents"} data-testid="documents-link">
                {t("openDocuments")}
              </Link>
            </Button>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
