// Workflow engine. Executes a published WorkflowVersion graph for a request.
// Every node execution is recorded as a WorkflowStepRun with a unique idempotency key
// (runId:nodeId), so re-running advanceRun after a crash or retry never repeats side effects.
import type { CaseType, Priority, RequestStatus, Sensitivity } from "@prisma/client";
import type { ExecCtx } from "@/server/db";
import { nextNumber } from "@/server/common/sequence";
import { notify } from "@/server/notify/notify";
import { buildMergeData } from "@/server/documents/merge";
import { evaluateCondition } from "./conditions";
import type { Assignee, NodeConfig, WorkflowGraph, WorkflowNode } from "./graph";
import { resolveAssignee, resolveSingle, type RunContext } from "./resolve";

type NodeResult = { state: "done"; handle?: string | null; output?: Record<string, unknown> } | { state: "waiting"; output?: Record<string, unknown> };

const SENSITIVE: Sensitivity[] = ["WELLBEING", "SAFEGUARDING"];

const PRIORITY_MAP: Record<string, Priority> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  urgent: "URGENT",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
  IMMEDIATE_DANGER: "URGENT",
};

const SLA_HOURS: Record<Priority, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 120 };

function hoursFrom(now: Date, h: number) {
  return new Date(now.getTime() + h * 3600_000);
}

type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

async function loadRun(ec: ExecCtx, runId: string) {
  return ec.tx.workflowRun.findUnique({
    where: { id: runId },
    include: {
      version: { include: { workflow: true } },
      request: { include: { service: true, student: true } },
    },
  });
}

function nameOf(student: { firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string } | null | undefined) {
  if (!student) return { en: "", ar: "" };
  return { en: `${student.firstNameEn} ${student.lastNameEn}`, ar: `${student.firstNameAr} ${student.lastNameAr}` };
}

async function memberName(ec: ExecCtx, membershipId: string | null | undefined) {
  if (!membershipId) return { en: "", ar: "" };
  const m = await ec.tx.membership.findUnique({ where: { id: membershipId }, include: { user: true } });
  return { en: m?.user.nameEn ?? "", ar: m?.user.nameAr ?? m?.user.nameEn ?? "" };
}

async function addTimeline(
  ec: ExecCtx,
  run: LoadedRun,
  ctx: RunContext,
  kind: string,
  title: { en: string; ar: string },
  opts: { body?: { en: string; ar: string } | null; staffOnly?: boolean; data?: Record<string, unknown>; onCase?: boolean } = {},
) {
  const sensitivity = (run.request?.sensitivity ?? "STANDARD") as Sensitivity;
  await ec.tx.timelineEvent.create({
    data: {
      orgId: ec.orgId,
      requestId: opts.onCase ? null : run.requestId,
      caseId: opts.onCase ? ctx.caseId ?? null : null,
      studentId: ctx.student?.id ?? null,
      actorId: ec.actorId ?? null,
      kind,
      titleEn: title.en,
      titleAr: title.ar,
      bodyEn: opts.body?.en ?? null,
      bodyAr: opts.body?.ar ?? null,
      staffOnly: opts.staffOnly ?? false,
      sensitivity,
      data: (opts.data ?? undefined) as never,
      createdAt: ec.now,
    },
  });
}

function requestHref(run: LoadedRun) {
  return run.requestId ? `/requests/${run.requestId}` : null;
}

async function templateVars(ec: ExecCtx, run: LoadedRun, ctx: RunContext) {
  const r = run.request;
  const vars: Record<string, string | { en: string; ar: string }> = {
    number: r?.number ?? "",
    title: { en: r?.titleEn ?? "", ar: r?.titleAr ?? "" },
    student: nameOf(r?.student),
    referrer: await memberName(ec, ctx.request.requesterId),
  };
  if (ctx.caseAssigneeId) vars.assignee = await memberName(ec, ctx.caseAssigneeId);
  if (ctx.appointmentId) {
    const a = await ec.tx.appointment.findUnique({ where: { id: ctx.appointmentId } });
    if (a) {
      const fmt = (loc: string) =>
        new Intl.DateTimeFormat(loc === "ar" ? "ar-AE" : "en-GB", {
          timeZone: "Asia/Dubai",
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(a.startsAt);
      vars.when = { en: fmt("en"), ar: fmt("ar") };
    }
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Node handlers
// ---------------------------------------------------------------------------

async function runCreateCase(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  const cfg = node.data;
  const r = run.request!;
  if (!ctx.student) return { state: "done", output: { skipped: "no_student" } };
  const assigneeId = cfg.assignee ? await resolveSingle(ec, cfg.assignee, ctx) : null;
  let priority: Priority = "MEDIUM";
  if (cfg.priority?.startsWith("form:")) {
    const v = ctx.form[cfg.priority.slice(5)];
    priority = PRIORITY_MAP[String(v ?? "")] ?? "MEDIUM";
  } else if (cfg.priority) {
    priority = PRIORITY_MAP[cfg.priority] ?? "MEDIUM";
  }
  const sensitivity = (cfg.sensitivity ?? "STANDARD") as Sensitivity;
  const number = await nextNumber(ec.tx, ec.orgId, sensitivity === "SAFEGUARDING" ? "SG" : "CASE", ec.now.getFullYear());
  const level = ctx.form.level as string | undefined;
  let departmentId: string | null = null;
  const subjectVal = ctx.form.subject ?? ctx.form.fromSubject;
  if (typeof subjectVal === "string" && subjectVal) {
    const subject = await ec.tx.subject.findFirst({ where: { orgId: ec.orgId, OR: [{ id: subjectVal }, { code: subjectVal.toUpperCase() }] } });
    departmentId = subject?.departmentId ?? null;
  }
  const summaryEn = String(ctx.form.observations ?? ctx.form.whatHappened ?? ctx.form.careerIdeas ?? ctx.form.details ?? "").slice(0, 600) || null;
  const created = await ec.tx.case.create({
    data: {
      orgId: ec.orgId,
      number,
      type: (cfg.caseType ?? "OTHER") as CaseType,
      sensitivity,
      studentId: ctx.student.id,
      titleEn: r.service.nameEn,
      titleAr: r.service.nameAr,
      summaryEn,
      summaryAr: null,
      assigneeId,
      referrerId: ctx.request.requesterId,
      departmentId,
      priority,
      status: "OPEN",
      concernLevel: cfg.caseType === "SAFEGUARDING" && level ? (level as never) : null,
      slaDueAt: hoursFrom(ec.now, SLA_HOURS[priority]),
      openedAt: ec.now,
      createdAt: ec.now,
    },
  });
  await ec.tx.caseParticipant.createMany({
    data: [
      ...(assigneeId ? [{ orgId: ec.orgId, caseId: created.id, membershipId: assigneeId, role: "ASSIGNEE" as const }] : []),
      { orgId: ec.orgId, caseId: created.id, membershipId: ctx.request.requesterId, role: "REFERRER" as const },
    ],
  });
  const note = await ec.tx.caseNote.create({
    data: { orgId: ec.orgId, caseId: created.id, authorId: ctx.request.requesterId, kind: "SYSTEM", occurredAt: ec.now, createdAt: ec.now },
  });
  await ec.tx.caseNoteVersion.create({
    data: {
      orgId: ec.orgId,
      noteId: note.id,
      version: 1,
      body: summaryEn ?? `Opened from request ${r.number}.`,
      editedById: ctx.request.requesterId,
      createdAt: ec.now,
    },
  });
  await ec.tx.request.update({ where: { id: r.id }, data: { caseId: created.id, assigneeId } });
  ctx.caseId = created.id;
  ctx.caseAssigneeId = assigneeId;
  const assignee = await memberName(ec, assigneeId);
  await ec.tx.timelineEvent.create({
    data: {
      orgId: ec.orgId,
      caseId: created.id,
      studentId: ctx.student.id,
      actorId: ctx.request.requesterId,
      kind: "case_opened",
      titleEn: `Case ${number} opened from ${r.number}`,
      titleAr: `فُتحت الحالة ${number} من الطلب ${r.number}`,
      bodyEn: assigneeId ? `Assigned to ${assignee.en}` : null,
      bodyAr: assigneeId ? `أُسندت إلى ${assignee.ar}` : null,
      sensitivity,
      staffOnly: true,
      createdAt: ec.now,
    },
  });
  await addTimeline(ec, run, ctx, "case_opened", node.data.label, {
    body: SENSITIVE.includes(sensitivity) ? null : assigneeId ? { en: `With ${assignee.en}`, ar: `لدى ${assignee.ar}` } : null,
  });
  await ec.tx.auditEvent.create({
    data: { orgId: ec.orgId, actorId: ctx.request.requesterId, action: "case.create", entityType: "Case", entityId: created.id, sensitivity, createdAt: ec.now },
  });
  return { state: "done", output: { caseId: created.id, assigneeId } };
}

async function runNotify(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  const cfg = node.data;
  const sensitivity = (run.request?.sensitivity ?? "STANDARD") as Sensitivity;
  const sensitive = SENSITIVE.includes(sensitivity);
  const ids: string[] = [];
  let familySkipped = false;
  for (const a of cfg.recipients ?? []) {
    // Families are never notified automatically about wellbeing or safeguarding matters.
    if (sensitive && (a.kind === "guardians" || a.kind === "student")) {
      familySkipped = true;
      continue;
    }
    for (const r of await resolveAssignee(ec, a, ctx)) if (r.membershipId) ids.push(r.membershipId);
  }
  const href = ctx.caseId && cfg.template !== "document_ready" && cfg.template !== "request_completed" && cfg.template !== "subject_change_done" ? `/cases/${ctx.caseId}` : requestHref(run);
  const result = await notify(ec, {
    recipients: ids,
    templateKey: cfg.template ?? "request_completed",
    vars: await templateVars(ec, run, ctx),
    href,
    sensitivity,
    urgent: cfg.template === "safeguarding_immediate",
    channels: cfg.channels,
    idempotencyBase: `${run.id}:${node.id}`,
  });
  if (!sensitive) {
    await addTimeline(ec, run, ctx, "notified", node.data.label, { staffOnly: false });
  }
  return { state: "done", output: { ...result, familySkipped } };
}

async function runUpdateStatus(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  const cfg = node.data;
  if (run.requestId) {
    await ec.tx.request.update({
      where: { id: run.requestId },
      data: {
        status: (cfg.status as RequestStatus) ?? undefined,
        currentStepEn: cfg.label.en,
        currentStepAr: cfg.label.ar,
        progress: cfg.progress ?? undefined,
        completedAt: cfg.status === "COMPLETED" ? ec.now : undefined,
      },
    });
  }
  await addTimeline(ec, run, ctx, "status", cfg.label);
  return { state: "done" };
}

async function runApproval(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  const cfg = node.data;
  const mode = cfg.mode ?? "SEQUENTIAL";
  const rows: Array<{ membershipId: string | null; guardianId: string | null; label: { en: string; ar: string }; requireSignature: boolean }> = [];
  for (const ap of cfg.approvers ?? []) {
    if (ap.when && !evaluateCondition(ap.when, ctx as unknown as Record<string, unknown>)) continue;
    const resolved = await resolveAssignee(ec, ap.assignee, ctx);
    for (const r of resolved) {
      if (!r.membershipId) continue;
      if (rows.some((x) => x.membershipId === r.membershipId)) continue;
      rows.push({ membershipId: r.membershipId, guardianId: r.guardianId ?? null, label: ap.label, requireSignature: Boolean(ap.requireSignature) });
    }
  }
  if (rows.length === 0) {
    await addTimeline(ec, run, ctx, "approval_skipped", {
      en: `${cfg.label.en}: no approver on record, step skipped`,
      ar: `${cfg.label.ar}: لا يوجد معتمد مسجل، تم تجاوز الخطوة`,
    }, { staffOnly: true });
    return { state: "done", handle: "approved", output: { skipped: true } };
  }
  const r = run.request;
  const approval = await ec.tx.approvalRequest.create({
    data: {
      orgId: ec.orgId,
      runId: run.id,
      nodeId: node.id,
      requestId: run.requestId,
      mode,
      status: "PENDING",
      titleEn: `${cfg.label.en}: ${r?.titleEn ?? ""}`,
      titleAr: `${cfg.label.ar}: ${r?.titleAr ?? ""}`,
      dueAt: cfg.dueInHours ? hoursFrom(ec.now, cfg.dueInHours) : null,
      createdAt: ec.now,
    },
  });
  await ec.tx.approvalAssignee.createMany({
    data: rows.map((row, i) => ({
      orgId: ec.orgId,
      approvalRequestId: approval.id,
      membershipId: row.membershipId,
      guardianId: row.guardianId,
      labelEn: row.label.en,
      labelAr: row.label.ar,
      order: i,
      status: mode === "SEQUENTIAL" && i > 0 ? ("WAITING" as const) : ("PENDING" as const),
      requireSignature: row.requireSignature,
    })),
  });
  if (run.requestId) {
    await ec.tx.request.update({
      where: { id: run.requestId },
      data: { status: "PENDING_APPROVAL", currentStepEn: cfg.label.en, currentStepAr: cfg.label.ar },
    });
  }
  const firstWave = mode === "SEQUENTIAL" ? rows.slice(0, 1) : rows;
  await notify(ec, {
    recipients: firstWave.map((x) => x.membershipId!).filter(Boolean),
    templateKey: "approval_needed",
    vars: await templateVars(ec, run, ctx),
    href: `/approvals`,
    idempotencyBase: `${run.id}:${node.id}:wave0`,
  });
  const who = mode === "SEQUENTIAL" ? rows[0].label : cfg.label;
  await addTimeline(ec, run, ctx, "approval_requested", { en: `Waiting for ${who.en}`, ar: `بانتظار ${who.ar}` }, {
    data: { approvalId: approval.id, nodeId: node.id },
  });
  return { state: "waiting", output: { approvalId: approval.id } };
}

async function runTask(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext, kind: "task" | "schedule_meeting"): Promise<NodeResult> {
  const cfg = node.data;
  if (kind === "schedule_meeting" && ctx.appointmentId) {
    await addTimeline(ec, run, ctx, "meeting", cfg.label);
    return { state: "done", output: { appointmentId: ctx.appointmentId } };
  }
  const assigneeId = cfg.assignee ? await resolveSingle(ec, cfg.assignee as Assignee, ctx) : null;
  const title = cfg.title ?? cfg.label;
  const href =
    kind === "schedule_meeting"
      ? `/book?type=${cfg.appointmentTypeKey ?? ""}${ctx.student ? `&student=${ctx.student.id}` : ""}${ctx.caseId ? `&case=${ctx.caseId}` : ""}`
      : ctx.caseId
        ? `/cases/${ctx.caseId}`
        : requestHref(run);
  const task = await ec.tx.task.create({
    data: {
      orgId: ec.orgId,
      titleEn: title.en,
      titleAr: title.ar,
      descEn: cfg.description?.en ?? null,
      descAr: cfg.description?.ar ?? null,
      status: "TODO",
      priority: (run.request?.priority as Priority) ?? "MEDIUM",
      dueAt: cfg.dueInHours ? hoursFrom(ec.now, cfg.dueInHours) : null,
      assigneeId,
      createdById: ctx.request.requesterId,
      caseId: ctx.caseId ?? null,
      requestId: run.requestId,
      studentId: ctx.student?.id ?? null,
      sensitivity: run.request?.sensitivity ?? "STANDARD",
      href,
      createdAt: ec.now,
    },
  });
  if (assigneeId) {
    await notify(ec, {
      recipients: [assigneeId],
      templateKey: "task_assigned",
      vars: { title, when: { en: task.dueAt ? task.dueAt.toISOString().slice(0, 10) : "", ar: task.dueAt ? task.dueAt.toISOString().slice(0, 10) : "" } },
      href,
      channels: ["IN_APP"],
      sensitivity: run.request?.sensitivity ?? "STANDARD",
      idempotencyBase: `${run.id}:${node.id}:task`,
    });
  }
  const sensitive = SENSITIVE.includes((run.request?.sensitivity ?? "STANDARD") as Sensitivity);
  if (!sensitive) await addTimeline(ec, run, ctx, "task", cfg.label, { staffOnly: true, data: { taskId: task.id } });
  if (cfg.blocking) return { state: "waiting", output: { taskId: task.id } };
  return { state: "done", output: { taskId: task.id } };
}

async function runWait(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext, stepId: string): Promise<NodeResult> {
  const hours = node.data.hours ?? 24;
  const until = hoursFrom(ec.now, hours);
  await ec.tx.workflowStepRun.update({ where: { id: stepId }, data: { scheduledFor: until } });
  if (!ec.quiet) {
    ec.effects.push({
      kind: "job",
      queue: "workflow",
      name: "resume",
      data: { orgId: ec.orgId, runId: run.id },
      jobId: `resume:${run.id}:${node.id}`,
      delayMs: hours * 3600_000,
    });
  }
  await addTimeline(ec, run, ctx, "wait", node.data.label, { staffOnly: true, data: { until: until.toISOString() } });
  return { state: "waiting", output: { until: until.toISOString() } };
}

async function runGenerateDocument(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  const cfg = node.data;
  let templateKey = cfg.templateKey ?? "enrollment_letter";
  if (templateKey.startsWith("form:")) templateKey = String(ctx.form[templateKey.slice(5)] ?? "enrollment_letter");
  let template = await ec.tx.documentTemplate.findUnique({ where: { orgId_key: { orgId: ec.orgId, key: templateKey } } });
  if (!template) template = await ec.tx.documentTemplate.findUnique({ where: { orgId_key: { orgId: ec.orgId, key: "enrollment_letter" } } });
  if (!template) return { state: "done", output: { skipped: "no_template" } };
  const lang = String(ctx.form.language ?? "").toLowerCase();
  const output = lang === "en" ? "EN" : lang === "ar" ? "AR" : lang === "bilingual" ? "BILINGUAL" : (cfg.output ?? template.output);
  const category = await ec.tx.documentCategory.findUnique({ where: { orgId_key: { orgId: ec.orgId, key: "official_letters" } } });
  const r = run.request!;
  const doc = await ec.tx.document.create({
    data: {
      orgId: ec.orgId,
      categoryId: category?.id ?? null,
      titleEn: template.nameEn,
      titleAr: template.nameAr,
      studentId: ctx.student?.id ?? null,
      requestId: r.id,
      sensitivity: "STANDARD",
      source: "GENERATED",
      templateId: template.id,
      uploadedById: ec.actorId ?? ctx.request.requesterId,
      visibleToFamily: true,
      createdAt: ec.now,
    },
  });
  const renderData = await buildMergeData(ec.tx, ec.orgId, {
    studentId: ctx.student?.id ?? null,
    requestNumber: r.number,
    form: ctx.form,
    now: ec.now,
  });
  const fileName = `${template.key}-${r.number}.pdf`;
  const version = await ec.tx.documentVersion.create({
    data: {
      orgId: ec.orgId,
      documentId: doc.id,
      version: 1,
      storageKey: `render:${doc.id}:1`,
      fileName,
      mimeType: "application/pdf",
      sizeBytes: 0,
      renderData: renderData as never,
      output: output as never,
      createdById: ec.actorId ?? ctx.request.requesterId,
      createdAt: ec.now,
    },
  });
  await ec.tx.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  ctx.documentId = doc.id;
  await addTimeline(ec, run, ctx, "document", node.data.label, { data: { documentId: doc.id } });
  return { state: "done", output: { documentId: doc.id } };
}

async function runAiSummary(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  if (ctx.caseId) {
    await ec.tx.timelineEvent.create({
      data: {
        orgId: ec.orgId,
        caseId: ctx.caseId,
        studentId: ctx.student?.id ?? null,
        kind: "ai_brief",
        titleEn: "Pre-meeting brief is ready to generate",
        titleAr: "ملخص ما قبل الجلسة جاهز للإنشاء",
        bodyEn: "Open the AI assistant on this case to draft a summary and suggested questions. Drafts need your review.",
        bodyAr: "افتح المساعد الذكي في هذه الحالة لإعداد ملخص وأسئلة مقترحة. تحتاج المسودات إلى مراجعتك.",
        staffOnly: true,
        sensitivity: run.request?.sensitivity ?? "STANDARD",
        createdAt: ec.now,
      },
    });
  }
  return { state: "done" };
}

async function runAssign(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  const id = node.data.assignee ? await resolveSingle(ec, node.data.assignee, ctx) : null;
  if (run.requestId && id) await ec.tx.request.update({ where: { id: run.requestId }, data: { assigneeId: id } });
  return { state: "done", output: { assigneeId: id } };
}

// ---------------------------------------------------------------------------
// Waiting node re-checks
// ---------------------------------------------------------------------------

async function recheck(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, output: Record<string, unknown>, scheduledFor: Date | null): Promise<NodeResult> {
  if (node.type === "approval") {
    const approval = await ec.tx.approvalRequest.findUnique({ where: { id: String(output.approvalId) } });
    if (approval?.status === "APPROVED") return { state: "done", handle: "approved", output };
    if (approval?.status === "REJECTED") return { state: "done", handle: "rejected", output };
    if (approval?.status === "CANCELLED") return { state: "done", handle: "rejected", output };
    return { state: "waiting", output };
  }
  if (node.type === "task") {
    const task = await ec.tx.task.findUnique({ where: { id: String(output.taskId) } });
    if (!task || task.status === "DONE" || task.status === "CANCELLED") return { state: "done", output };
    return { state: "waiting", output };
  }
  if (node.type === "wait") {
    if (scheduledFor && ec.now >= scheduledFor) return { state: "done", output };
    return { state: "waiting", output };
  }
  return { state: "done", output };
}

// ---------------------------------------------------------------------------
// Run driver
// ---------------------------------------------------------------------------

async function executeNode(ec: ExecCtx, run: LoadedRun, node: WorkflowNode, ctx: RunContext): Promise<NodeResult> {
  const idempotencyKey = `${run.id}:${node.id}`;
  const existing = await ec.tx.workflowStepRun.findUnique({ where: { orgId_idempotencyKey: { orgId: ec.orgId, idempotencyKey } } });
  if (existing?.status === "COMPLETED" || existing?.status === "SKIPPED") {
    const out = (existing.output ?? {}) as Record<string, unknown>;
    return { state: "done", handle: (out.handle as string | null) ?? null, output: out };
  }
  if (existing?.status === "WAITING") {
    const res = await recheck(ec, run, node, (existing.output ?? {}) as Record<string, unknown>, existing.scheduledFor);
    if (res.state === "done") {
      await ec.tx.workflowStepRun.update({
        where: { id: existing.id },
        data: { status: "COMPLETED", completedAt: ec.now, output: { ...(res.output ?? {}), handle: res.handle ?? null } as never },
      });
    }
    return res;
  }
  const step =
    existing ??
    (await ec.tx.workflowStepRun.create({
      data: {
        orgId: ec.orgId,
        runId: run.id,
        nodeId: node.id,
        nodeType: node.type,
        status: "RUNNING",
        idempotencyKey,
        startedAt: ec.now,
      },
    }));
  let res: NodeResult;
  switch (node.type) {
    case "start":
    case "end":
      res = { state: "done" };
      break;
    case "create_case":
      res = await runCreateCase(ec, run, node, ctx);
      break;
    case "notify":
      res = await runNotify(ec, run, node, ctx);
      break;
    case "update_status":
      res = await runUpdateStatus(ec, run, node, ctx);
      break;
    case "approval":
      res = await runApproval(ec, run, node, ctx);
      break;
    case "task":
      res = await runTask(ec, run, node, ctx, "task");
      break;
    case "schedule_meeting":
      res = await runTask(ec, run, node, ctx, "schedule_meeting");
      break;
    case "wait":
      res = await runWait(ec, run, node, ctx, step.id);
      break;
    case "condition": {
      const ok = evaluateCondition(node.data.condition, ctx as unknown as Record<string, unknown>);
      res = { state: "done", handle: ok ? "true" : "false" };
      break;
    }
    case "generate_document":
      res = await runGenerateDocument(ec, run, node, ctx);
      break;
    case "ai_summary":
      res = await runAiSummary(ec, run, node, ctx);
      break;
    case "assign":
      res = await runAssign(ec, run, node, ctx);
      break;
    default:
      res = { state: "done" };
  }
  await ec.tx.workflowStepRun.update({
    where: { id: step.id },
    data: {
      status: res.state === "waiting" ? "WAITING" : "COMPLETED",
      output: { ...(res.output ?? {}), handle: res.state === "done" ? res.handle ?? null : null } as never,
      completedAt: res.state === "done" ? ec.now : null,
    },
  });
  return res;
}

async function finalize(ec: ExecCtx, run: LoadedRun, ctx: RunContext, outcome: NodeConfig["outcome"], endLabel: { en: string; ar: string }) {
  if (!run.requestId) return;
  if (outcome === "REJECTED" || outcome === "CANCELLED") {
    await ec.tx.request.update({
      where: { id: run.requestId },
      data: { status: outcome === "REJECTED" ? "REJECTED" : "CANCELLED", completedAt: ec.now, currentStepEn: endLabel.en, currentStepAr: endLabel.ar },
    });
    await ec.tx.approvalRequest.updateMany({ where: { runId: run.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await notify(ec, {
      recipients: [ctx.request.requesterId],
      templateKey: "request_rejected",
      vars: await templateVars(ec, run, ctx),
      href: requestHref(run),
      channels: ["IN_APP", "EMAIL"],
      idempotencyBase: `${run.id}:rejected`,
    });
  } else {
    await ec.tx.request.update({
      where: { id: run.requestId },
      data: { status: "COMPLETED", progress: 100, completedAt: ec.now, currentStepEn: endLabel.en, currentStepAr: endLabel.ar },
    });
  }
  await addTimeline(ec, run, ctx, outcome === "REJECTED" ? "rejected" : "completed", endLabel);
}

/** Move a run forward until every active branch is waiting or the run has ended. Safe to call repeatedly. */
export async function advanceRun(ec: ExecCtx, runId: string) {
  // Serialize concurrent advancement of the same run.
  await ec.tx.$queryRaw`SELECT id FROM "WorkflowRun" WHERE id = ${runId} FOR UPDATE`;
  const run = await loadRun(ec, runId);
  if (!run || run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") return run;
  const graph = run.version.graph as unknown as WorkflowGraph;
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const ctx = run.context as unknown as RunContext & { __ended?: { outcome: NodeConfig["outcome"]; label: { en: string; ar: string } } };

  const queue = [...run.activeNodeIds];
  const waiting: string[] = [];
  let guard = 0;
  try {
    while (queue.length && guard++ < 500) {
      const nodeId = queue.shift()!;
      const node = nodes.get(nodeId);
      if (!node) continue;
      const res = await executeNode(ec, run, node, ctx);
      if (res.state === "waiting") {
        if (!waiting.includes(nodeId)) waiting.push(nodeId);
        continue;
      }
      if (node.type === "end") {
        ctx.__ended = { outcome: node.data.outcome ?? "COMPLETED", label: node.data.label };
        continue;
      }
      const outs = graph.edges.filter((e) => e.source === nodeId && (!res.handle || !e.sourceHandle || e.sourceHandle === res.handle));
      for (const e of outs) if (!queue.includes(e.target) && !waiting.includes(e.target)) queue.push(e.target);
    }
  } catch (err) {
    await ec.tx.workflowRun.update({ where: { id: run.id }, data: { error: err instanceof Error ? err.message.slice(0, 500) : "error" } });
    throw err;
  }

  const done = waiting.length === 0;
  await ec.tx.workflowRun.update({
    where: { id: run.id },
    data: {
      activeNodeIds: waiting,
      context: ctx as never,
      status: done ? "COMPLETED" : "WAITING",
      completedAt: done ? ec.now : null,
      caseId: ctx.caseId ?? null,
    },
  });
  if (done) await finalize(ec, run, ctx, ctx.__ended?.outcome ?? "COMPLETED", ctx.__ended?.label ?? { en: "Completed", ar: "مكتمل" });
  return run;
}

/** Start a published workflow for a request and run it as far as it can go. */
export async function startRun(ec: ExecCtx, input: { workflowVersionId: string; requestId: string; context: RunContext }) {
  const version = await ec.tx.workflowVersion.findUnique({ where: { id: input.workflowVersionId } });
  if (!version) throw new Error("Workflow version not found");
  const graph = version.graph as unknown as WorkflowGraph;
  const startNode = graph.nodes.find((n) => n.type === "start");
  if (!startNode) throw new Error("Workflow has no start node");
  const run = await ec.tx.workflowRun.create({
    data: {
      orgId: ec.orgId,
      workflowVersionId: version.id,
      requestId: input.requestId,
      status: "RUNNING",
      context: input.context as never,
      activeNodeIds: [startNode.id],
      startedAt: ec.now,
    },
  });
  await advanceRun(ec, run.id);
  return run.id;
}

/** Re-check every waiting run tied to a task, used when a blocking task is completed. */
export async function resumeRunsForTask(ec: ExecCtx, taskId: string) {
  const task = await ec.tx.task.findUnique({ where: { id: taskId } });
  if (!task?.requestId) return;
  const runs = await ec.tx.workflowRun.findMany({ where: { orgId: ec.orgId, requestId: task.requestId, status: "WAITING" } });
  for (const r of runs) await advanceRun(ec, r.id);
}
