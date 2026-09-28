// Workflow engine, approvals and safeguarding access, against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { submitRequest } from "@/server/services/submit";
import { decideApproval, ApprovalError } from "@/server/workflows/approvals";
import { advanceRun, resumeRunsForTask } from "@/server/workflows/engine";
import { caseAccess, listableCaseWhere } from "@/server/access/case-access";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Ctx } from "@/server/context";
import { seedDemo } from "../../prisma/seed/demo";
import { ownerClient } from "./helpers";
import { sampleData } from "../../prisma/seed/history";
import type { FormSchema } from "@/server/forms/schema";

const SLUG = "horizon-itest";
let owner: PrismaClient;
let orgId: string;

async function member(key: string) {
  const p = await owner.demoPersona.findUniqueOrThrow({ where: { orgId_key: { orgId, key } } });
  return p.membershipId;
}

/** Minimal request context for access checks (what getCtx builds in the app). */
async function ctxFor(membershipId: string): Promise<Ctx> {
  const db = tenantDb(orgId);
  const membership = await owner.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { roles: { include: { role: true } }, staffProfile: true, student: true, guardian: { include: { links: { include: { student: true } } } } } });
  const user = await owner.user.findUniqueOrThrow({ where: { id: membership.userId } });
  const org = await owner.organization.findUniqueOrThrow({ where: { id: orgId } });
  const roles = roleKeysOf(membership);
  return {
    orgId,
    db,
    org,
    user,
    membership,
    membershipId,
    roles,
    perms: permissionsOf(membership),
    locale: "en",
    persona: null,
    isStudent: roles.includes("student"),
    isParent: roles.includes("parent"),
    isStaff: !roles.includes("student") && !roles.includes("parent"),
    can: (p) => can(membership, p),
    session: null as never,
  } as Ctx;
}

async function service(key: string) {
  const svc = await owner.serviceDefinition.findUniqueOrThrow({ where: { orgId_key: { orgId, key } }, include: { form: true } });
  const version = svc.form?.publishedVersionId ? await owner.formVersion.findUnique({ where: { id: svc.form.publishedVersionId } }) : null;
  return { ...svc, schema: (version?.schema ?? null) as FormSchema | null };
}

/** Required fields filled with sample values, then the test's own values on top. */
function data(svc: { schema: FormSchema | null }, overrides: Record<string, unknown>) {
  return sampleData(svc.schema, null, "Test User", overrides, 7);
}

async function pendingRow(requestId: string) {
  return owner.approvalAssignee.findFirst({ where: { status: "PENDING", approval: { requestId, status: "PENDING" } } });
}

async function decide(requestId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  const row = await pendingRow(requestId);
  if (!row?.membershipId) throw new Error("no pending approver");
  await tenantTx(orgId, (tx) =>
    decideApproval(execCtx(tx, orgId, { quiet: true }), { assigneeRowId: row.id, deciderMembershipId: row.membershipId!, decision, comment, signatureName: row.requireSignature ? "Signed Name" : null }),
  );
  return row;
}

beforeAll(async () => {
  owner = ownerClient();
  const res = await seedDemo(owner, { slug: SLUG });
  orgId = res.orgId;
}, 180_000);

afterAll(async () => {
  await owner.$disconnect();
});

describe("workflow engine and approvals", () => {
  it("runs a subject change through parent, sequential teacher and head of department, then registrar", async () => {
    const adamMid = await member("student");
    const adam = await owner.student.findFirstOrThrow({ where: { orgId, membershipId: adamMid } });
    const svc = await service("subject_change");
    const req = await tenantTx(orgId, (tx) =>
      submitRequest(execCtx(tx, orgId, { quiet: true }), {
        serviceId: svc.id,
        requesterId: adamMid,
        studentId: adam.id,
        data: data(svc, { fromSubject: "PHYS", toSubject: "CS", reason: "career", careerLink: "AI engineer", parentAware: true, studentName: "Adam Nasser", grade: "9" }) }),
    );
    expect(req.status).toBe("PENDING_APPROVAL");

    // 1. Parent consent (signature required)
    const parentRow = await pendingRow(req.id);
    expect(parentRow?.membershipId).toBe(await member("parent"));
    expect(parentRow?.requireSignature).toBe(true);
    await decide(req.id, "APPROVED", "Happy with this");

    // 2. Sequential: current Physics teacher first, then the head of Computing waits
    const teacherRow = await pendingRow(req.id);
    expect(teacherRow?.membershipId).toBe(await member("teacher"));
    const waiting = await owner.approvalAssignee.findFirst({ where: { approvalRequestId: teacherRow!.approvalRequestId, status: "WAITING" } });
    expect(waiting?.membershipId).toBe(await member("hod_computing"));
    await decide(req.id, "APPROVED");
    expect((await pendingRow(req.id))?.membershipId).toBe(await member("hod_computing"));
    await decide(req.id, "APPROVED");

    // 3. Registrar
    expect((await pendingRow(req.id))?.membershipId).toBe(await member("registrar"));
    await decide(req.id, "APPROVED", "Timetable updated");

    const done = await owner.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.progress).toBe(100);
    const run = await owner.workflowRun.findFirstOrThrow({ where: { requestId: req.id } });
    expect(run.status).toBe("COMPLETED");
    const events = await owner.timelineEvent.count({ where: { requestId: req.id, kind: "approved" } });
    expect(events).toBe(4);
  });

  it("is idempotent: advancing a finished or waiting run again changes nothing", async () => {
    const svc = await service("document_request");
    const parent = await member("parent");
    const adam = await owner.student.findFirstOrThrow({ where: { orgId, membershipId: await member("student") } });
    const req = await tenantTx(orgId, (tx) =>
      submitRequest(execCtx(tx, orgId, { quiet: true }), { serviceId: svc.id, requesterId: parent, studentId: adam.id, data: data(svc, { documentType: "enrollment_letter", language: "bilingual", purpose: "visa", copies: 1 }) }),
    );
    const run = await owner.workflowRun.findFirstOrThrow({ where: { requestId: req.id } });
    const count = async () => ({
      steps: await owner.workflowStepRun.count({ where: { runId: run.id } }),
      approvals: await owner.approvalRequest.count({ where: { runId: run.id } }),
      notifications: await owner.notification.count({ where: { orgId, kind: "approval_needed" } }),
    });
    const before = await count();
    for (let i = 0; i < 3; i++) await tenantTx(orgId, (tx) => advanceRun(execCtx(tx, orgId, { quiet: true }), run.id));
    expect(await count()).toEqual(before);

    await decide(req.id, "APPROVED");
    const docs = await owner.document.count({ where: { requestId: req.id, source: "GENERATED" } });
    expect(docs).toBe(1);
    await tenantTx(orgId, (tx) => advanceRun(execCtx(tx, orgId, { quiet: true }), run.id));
    expect(await owner.document.count({ where: { requestId: req.id, source: "GENERATED" } })).toBe(1);
    const keys = await owner.workflowStepRun.findMany({ where: { runId: run.id }, select: { idempotencyKey: true } });
    expect(new Set(keys.map((k) => k.idempotencyKey)).size).toBe(keys.length);
    expect((await owner.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("COMPLETED");
  });

  it("rejection ends the run and cancels the remaining approvals", async () => {
    const svc = await service("subject_change");
    const adamMid = await member("student");
    const adam = await owner.student.findFirstOrThrow({ where: { orgId, membershipId: adamMid } });
    const req = await tenantTx(orgId, (tx) =>
      submitRequest(execCtx(tx, orgId, { quiet: true }), { serviceId: svc.id, requesterId: adamMid, studentId: adam.id, data: data(svc, { fromSubject: "PHYS", toSubject: "CS", reason: "interest", parentAware: false }) }),
    );
    await decide(req.id, "REJECTED", "Let us talk first");
    const r = await owner.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(r.status).toBe("REJECTED");
    expect(await pendingRow(req.id)).toBeNull();
  });

  it("only the assigned approver can decide", async () => {
    const svc = await service("document_request");
    const parent = await member("parent");
    const adam = await owner.student.findFirstOrThrow({ where: { orgId, membershipId: await member("student") } });
    const req = await tenantTx(orgId, (tx) =>
      submitRequest(execCtx(tx, orgId, { quiet: true }), { serviceId: svc.id, requesterId: parent, studentId: adam.id, data: data(svc, { documentType: "transcript", language: "en", purpose: "university", addressedTo: "Admissions", copies: 1 }) }),
    );
    const row = await pendingRow(req.id);
    await expect(
      tenantTx(orgId, (tx) => decideApproval(execCtx(tx, orgId, { quiet: true }), { assigneeRowId: row!.id, deciderMembershipId: parent, decision: "APPROVED" })),
    ).rejects.toBeInstanceOf(ApprovalError);
  });

  it("wait nodes hold the run until their time, then continue", async () => {
    const svc = await service("academic_concern");
    const teacher = await member("teacher");
    const student = await owner.student.findFirstOrThrow({ where: { orgId, gradeLevel: 9, section: "A", NOT: { membershipId: await member("student") } } });
    const req = await tenantTx(orgId, (tx) =>
      submitRequest(execCtx(tx, orgId, { quiet: true }), { serviceId: svc.id, requesterId: teacher, studentId: student.id, data: data(svc, { student: student.id, subject: "PHYS", concernAreas: ["grades_declining"], observations: "Marks dropped this month.", urgency: "medium" }) }),
    );
    const run = await owner.workflowRun.findFirstOrThrow({ where: { requestId: req.id } });
    expect(run.status).toBe("WAITING");
    // The run first waits for the action plan to be shared.
    expect(run.activeNodeIds).toEqual(["plan_task"]);
    const planTask = await owner.task.findFirstOrThrow({ where: { requestId: req.id, titleEn: "Draft and share the action plan" } });
    await owner.task.update({ where: { id: planTask.id }, data: { status: "DONE" } });
    await tenantTx(orgId, (tx) => resumeRunsForTask(execCtx(tx, orgId, { quiet: true }), planTask.id));
    expect((await owner.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).activeNodeIds).toEqual(["wait_followup"]);
    // Nothing happens before the two weeks are up.
    await tenantTx(orgId, (tx) => advanceRun(execCtx(tx, orgId, { quiet: true, now: new Date(Date.now() + 3 * 86400_000) }), run.id));
    expect((await owner.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("WAITING");
    await tenantTx(orgId, (tx) => advanceRun(execCtx(tx, orgId, { quiet: true, now: new Date(Date.now() + 15 * 86400_000) }), run.id));
    expect((await owner.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
    expect(await owner.task.count({ where: { requestId: req.id, titleEn: "Two-week follow-up review" } })).toBe(1);
    // The case landed with the grade 9 counselor.
    const theCase = await owner.case.findFirstOrThrow({ where: { id: req.caseId ?? (await owner.request.findUniqueOrThrow({ where: { id: req.id } })).caseId! } });
    expect(theCase.assigneeId).toBe(await member("counselor"));
  });

  it("blocking tasks resume the run when completed", async () => {
    const svc = await service("it_support");
    const adamMid = await member("student");
    const req = await tenantTx(orgId, (tx) => submitRequest(execCtx(tx, orgId, { quiet: true }), { serviceId: svc.id, requesterId: adamMid, studentId: null, data: data(svc, { issueType: "other", description: "Laptop will not connect", deviceType: "laptop", urgency: "low" }) }));
    const task = await owner.task.findFirstOrThrow({ where: { requestId: req.id } });
    await owner.task.update({ where: { id: task.id }, data: { status: "DONE" } });
    await tenantTx(orgId, (tx) => resumeRunsForTask(execCtx(tx, orgId, { quiet: true }), task.id));
    expect((await owner.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("COMPLETED");
  });
});

describe("safeguarding and wellbeing access", () => {
  it("a teacher who referred a safeguarding concern cannot see its notes", async () => {
    const teacher = await member("teacher");
    const dsl = await member("dsl");
    const student = await owner.student.findFirstOrThrow({ where: { orgId, gradeLevel: 8 } });
    const svc = await service("safeguarding_concern");
    const req = await tenantTx(orgId, (tx) =>
      submitRequest(execCtx(tx, orgId, { quiet: true }), {
        serviceId: svc.id,
        requesterId: teacher,
        studentId: student.id,
        data: data(svc, { student: student.id, level: "LOW", whatHappened: "The student seemed withdrawn at break.", declaration: true }) }),
    );
    const theCase = await owner.case.findFirstOrThrow({ where: { id: (await owner.request.findUniqueOrThrow({ where: { id: req.id } })).caseId! } });
    expect(theCase.sensitivity).toBe("SAFEGUARDING");
    expect(theCase.assigneeId).toBe(dsl);

    const teacherCtx = await ctxFor(teacher);
    expect((await caseAccess(teacherCtx, theCase)).level).toBe("status_only");
    // Not listed anywhere the teacher looks.
    for (const surface of ["worklist", "dashboard", "search", "analytics", "safeguarding"] as const) {
      const visible = await tenantDb(orgId).case.count({ where: { AND: [listableCaseWhere(teacherCtx, surface), { id: theCase.id }] } });
      expect(visible).toBe(0);
    }
    // The DSL sees everything.
    const dslCtx = await ctxFor(dsl);
    expect((await caseAccess(dslCtx, theCase)).level).toBe("full");
    expect(await tenantDb(orgId).case.count({ where: { AND: [listableCaseWhere(dslCtx, "safeguarding"), { id: theCase.id }] } })).toBe(1);
    // Even the DSL never sees it in search or analytics.
    expect(await tenantDb(orgId).case.count({ where: { AND: [listableCaseWhere(dslCtx, "search"), { id: theCase.id }] } })).toBe(0);
    // The principal needs break-glass.
    const principalCtx = await ctxFor(await member("principal"));
    expect(await caseAccess(principalCtx, theCase)).toEqual({ level: "none", canBreakGlass: true });
  });

  it("the DSL and deputy are alerted on every channel for immediate danger", async () => {
    const teacher = await member("teacher");
    const student = await owner.student.findFirstOrThrow({ where: { orgId, gradeLevel: 7 } });
    const svc = await service("safeguarding_concern");
    const req = await tenantTx(orgId, (tx) =>
      submitRequest(execCtx(tx, orgId, { quiet: true }), { serviceId: svc.id, requesterId: teacher, studentId: student.id, data: data(svc, { student: student.id, level: "IMMEDIATE_DANGER", whatHappened: "Test scenario.", declaration: true }) }),
    );
    const run = await owner.workflowRun.findFirstOrThrow({ where: { requestId: req.id } });
    const alert = await owner.workflowStepRun.findFirstOrThrow({ where: { runId: run.id, nodeId: "alert_all" } });
    expect(alert.status).toBe("COMPLETED");
    const channels = await owner.outboundMessage.findMany({ where: { orgId, idempotencyKey: { startsWith: `${run.id}:alert_all` } }, select: { channel: true } });
    expect(new Set(channels.map((c) => c.channel))).toEqual(new Set(["EMAIL", "SMS", "WHATSAPP"]));
    const urgent = await owner.notification.count({ where: { orgId, kind: "safeguarding_immediate", urgent: true, recipientId: { in: [await member("dsl"), await member("deputy_dsl")] } } });
    expect(urgent).toBeGreaterThanOrEqual(2);
  });

  it("parents are never notified automatically about a wellbeing request", async () => {
    const student = await owner.student.findFirstOrThrow({ where: { orgId, gradeLevel: 11 }, include: { guardians: { include: { guardian: true } } } });
    const svc = await service("talk_to_someone");
    const before = await owner.notification.count({ where: { orgId, recipientId: { in: student.guardians.map((g) => g.guardian.membershipId!).filter(Boolean) } } });
    await tenantTx(orgId, (tx) => submitRequest(execCtx(tx, orgId, { quiet: true }), { serviceId: svc.id, requesterId: student.membershipId!, studentId: student.id, data: data(svc, { who: "counselor", howUrgent: "today" }) }));
    const after = await owner.notification.count({ where: { orgId, recipientId: { in: student.guardians.map((g) => g.guardian.membershipId!).filter(Boolean) } } });
    expect(after).toBe(before);
  });
});
