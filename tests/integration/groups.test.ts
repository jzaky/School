// School groups against real Postgres: the group dashboard reads each member school through tenantDb and
// the RLS-restricted app role; group tables are read through userScope. Platform writes use the owner client.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { tenantDb, userScope } from "@/lib/tenant-db";
import { installStarterTemplate } from "../../prisma/seed/starter";
import { wipeTenant } from "../../prisma/seed/lib";
import { loadGroupDashboard } from "@/server/groups/dashboard";
import { GroupAccessError, groupSchoolLinks, groupRolesForUser } from "@/server/groups/access";
import { createGroupInvite, revokeGroupInvite } from "@/server/groups/invites";
import { GroupPlatformError, assignSchool, createGroup, previewGroupInvite, redeemGroupInvite, setGroupMember } from "@/server/groups/platform";
import { PushError, listPushes, pushTemplate } from "@/server/groups/push";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const now = new Date();
const H = 3_600_000;

let groupId: string;
const orgs: Record<"A" | "B" | "C" | "D" | "E", string> = { A: "", B: "", C: "", D: "", E: "" };
const users: Record<"admin" | "viewer" | "outsider" | "schoolAdminD", string> = { admin: "", viewer: "", outsider: "", schoolAdminD: "" };
let membershipD = "";

async function org(label: string, starter: boolean) {
  const o = await owner.organization.create({ data: { slug: uid(`grp-${label.toLowerCase()}`), nameEn: `Group Test ${label}`, nameAr: `مدرسة المجموعة ${label}` } });
  if (starter) await installStarterTemplate(owner, o.id, { curricula: ["BRITISH"], locale: "en", now, installCourses: false });
  return o.id;
}

async function user(label: string) {
  const u = await owner.user.create({ data: { email: `${uid(label)}@groups-itest.test`, nameEn: `Person ${label}` } });
  return u.id;
}

async function addMember(orgId: string, userId: string) {
  return owner.membership.create({ data: { orgId, userId, status: "ACTIVE", lastSeenAt: new Date(now.getTime() - 2 * 86_400_000) } });
}

/** Standard and sensitive work in one school. Returns what the dashboard should count for it. */
async function seedWork(orgId: string, opts: { standardOpen: number; overdueOpen: number; closedHours: number[] }) {
  const requester = await addMember(orgId, await user(`req-${orgId.slice(-4)}`));
  const student = await owner.student.create({ data: { orgId, studentNo: uid("S"), firstNameEn: "Test", lastNameEn: "Student", firstNameAr: "طالب", lastNameAr: "اختبار", gradeLevel: 10 } });
  const services = await owner.serviceDefinition.findMany({ where: { orgId } });
  let std = services.find((s) => s.key === "document_request" && s.sensitivity === "STANDARD");
  let wb = services.find((s) => s.key === "talk_to_someone");
  if (!std) {
    const cat = await owner.serviceCategory.create({ data: { orgId, key: "docs", nameEn: "Docs", nameAr: "وثائق" } });
    std = await owner.serviceDefinition.create({ data: { orgId, key: "document_request", categoryId: cat.id, nameEn: "Documents", nameAr: "وثائق", descEn: "d", descAr: "د" } });
    wb = await owner.serviceDefinition.create({ data: { orgId, key: "talk_to_someone", categoryId: cat.id, nameEn: "Talk to someone", nameAr: "تحدث إلى شخص", descEn: "d", descAr: "د", sensitivity: "WELLBEING" } });
  }
  const rows: Prisma.RequestCreateManyInput[] = [];
  let n = 0;
  const base = { orgId, serviceId: std.id, requesterId: requester.id, studentId: student.id, titleEn: "R", titleAr: "ط" };
  for (let i = 0; i < opts.standardOpen; i++) rows.push({ ...base, number: `R-${++n}`, status: "IN_REVIEW", submittedAt: new Date(now.getTime() - 2 * H), slaDueAt: new Date(now.getTime() + 48 * H) });
  for (let i = 0; i < opts.overdueOpen; i++) rows.push({ ...base, number: `R-${++n}`, status: "SUBMITTED", submittedAt: new Date(now.getTime() - 100 * H), slaDueAt: new Date(now.getTime() - 4 * H) });
  for (const h of opts.closedHours) rows.push({ ...base, number: `R-${++n}`, status: "COMPLETED", submittedAt: new Date(now.getTime() - (h + 24) * H), completedAt: new Date(now.getTime() - 24 * H) });
  // Sensitive work: a wellbeing request (open and overdue), a wellbeing and a safeguarding case, a sensitive overdue task.
  rows.push({ ...base, serviceId: wb!.id, number: `R-${++n}`, status: "IN_REVIEW", sensitivity: "WELLBEING", submittedAt: new Date(now.getTime() - 50 * H), slaDueAt: new Date(now.getTime() - H) });
  await owner.request.createMany({ data: rows });
  const sg = await owner.case.create({ data: { orgId, number: uid("SG"), type: "SAFEGUARDING", sensitivity: "SAFEGUARDING", studentId: student.id, titleEn: "Concern", titleAr: "بلاغ" } });
  await owner.case.create({ data: { orgId, number: uid("WB"), type: "WELLBEING", sensitivity: "WELLBEING", studentId: student.id, titleEn: "Wellbeing", titleAr: "رفاه" } });
  await owner.task.create({ data: { orgId, titleEn: "Sensitive", titleAr: "حساس", caseId: sg.id, sensitivity: "SAFEGUARDING", dueAt: new Date(now.getTime() - H) } });
  await owner.task.create({ data: { orgId, titleEn: "Plain", titleAr: "عادي", dueAt: new Date(now.getTime() - H) } });
}

beforeAll(async () => {
  [orgs.A, orgs.B, orgs.C, orgs.D, orgs.E] = await Promise.all([org("A", true), org("B", true), org("C", false), org("D", false), org("E", false)]);
  [users.admin, users.viewer, users.outsider, users.schoolAdminD] = await Promise.all([user("admin"), user("viewer"), user("outsider"), user("school-admin-d")]);
  const g = await createGroup({ nameEn: `Itest Group ${uid("g")}`, nameAr: "مجموعة اختبار", actorUserId: users.admin }, owner);
  groupId = g.id;
  await assignSchool({ groupId, orgId: orgs.A, actorUserId: users.admin }, owner);
  await assignSchool({ groupId, orgId: orgs.B, actorUserId: users.admin }, owner);
  const emails = await owner.user.findMany({ where: { id: { in: [users.admin, users.viewer] } } });
  await setGroupMember({ groupId, email: emails.find((u) => u.id === users.admin)!.email, role: "ADMIN" }, owner);
  await setGroupMember({ groupId, email: emails.find((u) => u.id === users.viewer)!.email, role: "VIEWER" }, owner);
  // The group admin also works at school A, not at B.
  await addMember(orgs.A, users.admin);
  membershipD = (await addMember(orgs.D, users.schoolAdminD)).id;
  await seedWork(orgs.A, { standardOpen: 2, overdueOpen: 1, closedHours: [10, 30] });
  await seedWork(orgs.B, { standardOpen: 1, overdueOpen: 0, closedHours: [5] });
  await seedWork(orgs.C, { standardOpen: 9, overdueOpen: 9, closedHours: [200, 200] });
}, 180_000);

afterAll(async () => {
  for (const id of Object.values(orgs)) {
    if (!id) continue;
    await wipeTenant(owner, id).catch(() => undefined);
    await owner.organization.delete({ where: { id } }).catch(() => undefined);
  }
  if (groupId) await owner.schoolGroup.delete({ where: { id: groupId } }).catch(() => undefined);
  await owner.user.deleteMany({ where: { email: { endsWith: "@groups-itest.test" } } });
  await owner.$disconnect();
}, 120_000);

describe("group dashboard isolation", () => {
  it("counts only the group's schools and only standard work", async () => {
    const d = await loadGroupDashboard(users.admin, groupId, now);
    expect(d.role).toBe("ADMIN");
    expect(d.schools.map((s) => s.orgId).sort()).toEqual([orgs.A, orgs.B].sort());
    const a = d.schools.find((s) => s.orgId === orgs.A)!.kpis;
    const b = d.schools.find((s) => s.orgId === orgs.B)!.kpis;
    // A: 2 open + 1 overdue standard requests; the wellbeing request is not counted.
    expect(a.openRequests).toBe(3);
    expect(a.overdueRequests).toBe(1);
    // Only the plain overdue task; the safeguarding task is not counted.
    expect(a.overdueTasks).toBe(1);
    expect(a.closedRequests).toBe(2);
    expect(a.turnaroundHoursTotal).toBeCloseTo(40, 5);
    expect(b.openRequests).toBe(1);
    // School C (outside the group) has 18 open requests; none of them reach the totals.
    expect(d.totals.openRequests).toBe(4);
    expect(d.totals.overdue).toBe(1 + 1 + 0 + 1);
    expect(d.totals.avgTurnaroundHours).toBeCloseTo(15, 5); // (10 + 30 + 5) / 3
    expect(d.totals.serviceUsage.map((s) => s.key)).not.toContain("talk_to_someone");
  });

  it("carries no case, wellbeing or safeguarding figure at all", async () => {
    const d = await loadGroupDashboard(users.viewer, groupId, now);
    const json = JSON.stringify(d).toLowerCase();
    for (const word of ["case", "wellbeing", "safeguarding", "talk_to_someone", "concern"]) expect(json).not.toContain(word);
  });

  it("lets group users open only schools where they hold a membership", async () => {
    const d = await loadGroupDashboard(users.admin, groupId, now);
    expect(d.schools.find((s) => s.orgId === orgs.A)!.canOpen).toBe(true);
    expect(d.schools.find((s) => s.orgId === orgs.B)!.canOpen).toBe(false);
    const viewer = await loadGroupDashboard(users.viewer, groupId, now);
    expect(viewer.schools.every((s) => !s.canOpen)).toBe(true);
  });

  it("gives people outside the group nothing", async () => {
    await expect(loadGroupDashboard(users.outsider, groupId, now)).rejects.toBeInstanceOf(GroupAccessError);
    expect(await groupSchoolLinks(users.outsider, groupId)).toEqual([]);
    expect(await groupRolesForUser(users.outsider)).toEqual([]);
    const seen = await userScope(users.outsider, (tx) => Promise.all([tx.schoolGroup.count(), tx.groupMember.count(), tx.schoolGroupSchool.count({ where: { groupId } })]));
    expect(seen).toEqual([0, 0, 0]);
    // A school sees its own group only, not the other members.
    const fromB = await tenantDb(orgs.B).schoolGroupSchool.findMany({ where: { groupId } });
    expect(fromB.map((l) => l.orgId)).toEqual([orgs.B]);
    expect(await tenantDb(orgs.C).schoolGroup.count({ where: { id: groupId } })).toBe(0);
  });

  it("does not let the app role write group membership", async () => {
    await expect(userScope(users.admin, (tx) => tx.schoolGroupSchool.create({ data: { groupId, orgId: orgs.C } }))).rejects.toThrow();
    await expect(userScope(users.viewer, (tx) => tx.groupMember.update({ where: { groupId_userId: { groupId, userId: users.viewer } }, data: { role: "ADMIN" } }))).rejects.toThrow();
  });
});

describe("invite acceptance", () => {
  it("only group admins create codes, and RLS backs that up", async () => {
    await expect(createGroupInvite(users.viewer, groupId)).rejects.toBeInstanceOf(GroupAccessError);
    await expect(
      userScope(users.viewer, (tx) => tx.groupInvite.create({ data: { groupId, codeHash: uid("h"), codeHint: "XXXX", createdById: users.viewer, expiresAt: new Date(now.getTime() + 86_400_000) } })),
    ).rejects.toThrow();
  });

  it("joins a school with a valid code, once", async () => {
    const inv = await createGroupInvite(users.admin, groupId, now);
    const preview = await previewGroupInvite(inv.code.toLowerCase(), owner, now);
    expect(preview.groupId).toBe(groupId);
    const res = await redeemGroupInvite({ code: inv.code, orgId: orgs.D, actorUserId: users.schoolAdminD, actorMembershipId: membershipD }, owner, now);
    expect(res.groupId).toBe(groupId);
    const link = await owner.schoolGroupSchool.findUniqueOrThrow({ where: { orgId: orgs.D } });
    expect(link.via).toBe("invite");
    const auditRow = await tenantDb(orgs.D).auditEvent.findFirst({ where: { action: "group.joined" } });
    expect(auditRow?.actorUserId).toBe(users.schoolAdminD);
    // Single use.
    await expect(redeemGroupInvite({ code: inv.code, orgId: orgs.E, actorUserId: users.schoolAdminD, actorMembershipId: membershipD }, owner, now)).rejects.toMatchObject({ code: "code_used" });
    // D now shows on the dashboard.
    const d = await loadGroupDashboard(users.admin, groupId, now);
    expect(d.schools.map((s) => s.orgId)).toContain(orgs.D);
  });

  it("refuses revoked, expired, unknown codes and schools already in a group", async () => {
    const revoked = await createGroupInvite(users.admin, groupId, now);
    expect(await revokeGroupInvite(users.admin, groupId, revoked.id, now)).toBe(true);
    await expect(previewGroupInvite(revoked.code, owner, now)).rejects.toMatchObject({ code: "code_invalid" });
    const old = await createGroupInvite(users.admin, groupId, new Date(now.getTime() - 30 * 86_400_000));
    await expect(previewGroupInvite(old.code, owner, now)).rejects.toMatchObject({ code: "code_expired" });
    await expect(previewGroupInvite("not a code", owner, now)).rejects.toBeInstanceOf(GroupPlatformError);
    const fresh = await createGroupInvite(users.admin, groupId, now);
    await expect(redeemGroupInvite({ code: fresh.code, orgId: orgs.A, actorUserId: users.admin, actorMembershipId: "x" }, owner, now)).rejects.toMatchObject({ code: "in_group" });
  });
});

describe("template push", () => {
  it("copies a service with its form and workflow into another school, switched off, and audits it there", async () => {
    const src = await tenantDb(orgs.A).serviceDefinition.findFirstOrThrow({ where: { key: "document_request", formId: { not: null }, workflowId: { not: null } } });
    const res = await pushTemplate({ userId: users.admin, groupId, sourceOrgId: orgs.A, kind: "service", sourceId: src.id, targetOrgIds: [orgs.B] }, now);
    expect(res.results).toHaveLength(1);
    const r = res.results[0];
    expect(r.status).toBe("created");
    expect(r.key).toBe("document_request_2"); // B already has its own document_request from the starter template
    const db = tenantDb(orgs.B);
    const copy = await db.serviceDefinition.findUniqueOrThrow({ where: { id: r.entityId! }, include: { form: true, workflow: true } });
    expect(copy.isActive).toBe(false);
    expect(copy.nameEn).toBe(src.nameEn);
    expect(copy.form?.publishedVersionId).toBeTruthy();
    expect(copy.workflow?.publishedVersionId).toBeTruthy();
    expect(copy.formId).not.toBe(src.formId);
    const auditRow = await db.auditEvent.findFirstOrThrow({ where: { action: "group.template_pushed", entityId: copy.id } });
    expect(auditRow.actorUserId).toBe(users.admin);
    expect((auditRow.meta as { sourceOrgId: string; groupId: string }).sourceOrgId).toBe(orgs.A);
    expect((auditRow.meta as { groupId: string }).groupId).toBe(groupId);
    // The source school is unchanged and the push is in the group's history.
    expect(await tenantDb(orgs.A).serviceDefinition.count({ where: { key: "document_request_2" } })).toBe(0);
    const history = await listPushes(users.viewer, groupId);
    expect(history[0]).toMatchObject({ kind: "service", sourceOrgId: orgs.A, pushedById: users.admin, targetOrgIds: [orgs.B] });
  });

  it("replaces a letter or a notification message when asked", async () => {
    const dbA = tenantDb(orgs.A);
    const letter = await dbA.documentTemplate.findFirstOrThrow({});
    await dbA.documentTemplate.update({ where: { id: letter.id }, data: { bodyEn: "Group wording for {{student.name}}." } });
    const res = await pushTemplate({ userId: users.admin, groupId, sourceOrgId: orgs.A, kind: "letter", sourceId: letter.id, targetOrgIds: [orgs.B], mode: "replace" }, now);
    expect(res.results[0].status).toBe("replaced");
    expect((await tenantDb(orgs.B).documentTemplate.findFirstOrThrow({ where: { key: letter.key } })).bodyEn).toBe("Group wording for {{student.name}}.");
    const copy = await pushTemplate({ userId: users.admin, groupId, sourceOrgId: orgs.A, kind: "letter", sourceId: letter.id, targetOrgIds: [orgs.B] }, now);
    expect(copy.results[0]).toMatchObject({ status: "created", key: `${letter.key}_2` });

    const msg = await dbA.messageTemplate.findFirstOrThrow({});
    await dbA.messageTemplate.update({ where: { id: msg.id }, data: { bodyEn: "Group message body" } });
    const m = await pushTemplate({ userId: users.admin, groupId, sourceOrgId: orgs.A, kind: "notification", sourceId: msg.id, targetOrgIds: [orgs.B] }, now);
    expect(m.results[0].status).toBe("replaced");
    expect((await tenantDb(orgs.B).messageTemplate.findFirstOrThrow({ where: { key: msg.key, channel: msg.channel } })).bodyEn).toBe("Group message body");
  });

  it("refuses viewers, schools outside the group and items from elsewhere", async () => {
    const letter = await tenantDb(orgs.A).documentTemplate.findFirstOrThrow({});
    await expect(pushTemplate({ userId: users.viewer, groupId, sourceOrgId: orgs.A, kind: "letter", sourceId: letter.id, targetOrgIds: [orgs.B] })).rejects.toBeInstanceOf(GroupAccessError);
    await expect(pushTemplate({ userId: users.admin, groupId, sourceOrgId: orgs.A, kind: "letter", sourceId: letter.id, targetOrgIds: [orgs.C] })).rejects.toBeInstanceOf(PushError);
    await expect(pushTemplate({ userId: users.admin, groupId, sourceOrgId: orgs.C, kind: "letter", sourceId: letter.id, targetOrgIds: [orgs.B] })).rejects.toMatchObject({ code: "not_in_group" });
    // An id from school B used as if it were school A's: not found through A's tenant client.
    const bLetter = await tenantDb(orgs.B).documentTemplate.findFirstOrThrow({});
    await expect(pushTemplate({ userId: users.admin, groupId, sourceOrgId: orgs.A, kind: "letter", sourceId: bLetter.id, targetOrgIds: [orgs.B] })).rejects.toMatchObject({ code: "not_found" });
    expect(await tenantDb(orgs.C).auditEvent.count({ where: { action: "group.template_pushed" } })).toBe(0);
  });
});
