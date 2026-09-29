// Access management and joining, against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { tenantDb } from "@/lib/tenant-db";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { permissionsOf } from "@/server/identity/can";
import { syncSystemRoles } from "@/server/identity/role-sync";
import { AccessError, createRole, setMemberRoles, setRolePermission } from "@/server/access/roles";
import { inviteParent, inviteStaff, createStaffLink, revokeInvitation } from "@/server/access/invitations";
import { acceptInvite, joinWithCode, joinStatusForUser, JoinError, CLAIM_FAILURE_LIMIT } from "@/server/access/join";
import { approveJoinRequest } from "@/server/access/join-requests";
import { findInvitationByToken } from "@/server/platform/join-lookup";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
type School = { orgId: string; code: string; admin: { membershipId: string; userId: string; orgId: string }; adam: string; yara: string; roleIds: Record<string, string> };
let A: School;
let B: School;
const ip = () => `itest-${uid("ip")}`;
const PASSWORD = "Sunrise-2026";

async function makeSchool(label: string, parentJoinApproval: boolean): Promise<School> {
  const code = `IT${label}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const org = await owner.organization.create({
    data: { slug: uid(`access-${label.toLowerCase()}`), nameEn: `Access School ${label}`, nameAr: `مدرسة الصلاحيات ${label}`, joinCode: code, parentJoinApproval, parentSelfJoin: true },
  });
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const row = await owner.role.create({ data: { orgId: org.id, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, descEn: r.descEn, descAr: r.descAr, permissions: r.permissions } });
    roleIds[r.key] = row.id;
  }
  const user = await owner.user.create({ data: { email: `${uid("admin")}@access.test`, nameEn: `Admin ${label}` } });
  const m = await owner.membership.create({ data: { orgId: org.id, userId: user.id } });
  await owner.membershipRole.create({ data: { orgId: org.id, membershipId: m.id, roleId: roleIds.school_admin } });
  const adam = await owner.student.create({ data: { orgId: org.id, studentNo: `${label}-9001`, firstNameEn: "Adam", lastNameEn: "Testing", firstNameAr: "آدم", lastNameAr: "اختبار", gradeLevel: 9, dateOfBirth: new Date("2012-03-01T00:00:00Z") } });
  const yara = await owner.student.create({ data: { orgId: org.id, studentNo: `${label}-6001`, firstNameEn: "Yara", lastNameEn: "Testing", firstNameAr: "يارا", lastNameAr: "اختبار", gradeLevel: 6, dateOfBirth: new Date("2015-08-12T00:00:00Z") } });
  return { orgId: org.id, code, admin: { membershipId: m.id, userId: user.id, orgId: org.id }, adam: adam.id, yara: yara.id, roleIds };
}

const createdEmails: string[] = [];
function email(prefix: string) {
  const e = `${uid(prefix)}@access.test`;
  createdEmails.push(e);
  return e;
}

beforeAll(async () => {
  A = await makeSchool("A", false);
  B = await makeSchool("B", true);
});

afterAll(async () => {
  for (const s of [A, B]) {
    if (!s) continue;
    await owner.organization.delete({ where: { id: s.orgId } }).catch(() => undefined);
  }
  await owner.user.deleteMany({ where: { email: { endsWith: "@access.test" } } });
  await owner.$disconnect();
});

describe("invitations", () => {
  it("accepting a staff invite activates the membership with the invited roles", async () => {
    const e = email("teacher");
    const res = await inviteStaff(A.admin, [{ nameEn: "Test Teacher", email: e, roleKeys: ["teacher"] }], { send: false });
    expect(res.problems).toEqual([]);
    const token = res.created[0].token;
    const inv = await owner.invitation.findUnique({ where: { id: res.created[0].invitationId } });
    expect(inv?.tokenHash).not.toBe(token);

    const joined = await acceptInvite(token, { mode: "create", name: "Test Teacher", email: e, password: PASSWORD }, { ip: ip() });
    expect(joined).toMatchObject({ orgId: A.orgId, status: "ACTIVE" });
    const m = await owner.membership.findUnique({ where: { id: joined.membershipId }, include: { roles: { include: { role: true } }, staffProfile: true } });
    expect(m?.status).toBe("ACTIVE");
    expect(m?.roles.map((r) => r.role.key)).toEqual(["teacher"]);
    expect(m?.staffProfile).not.toBeNull();
    expect(permissionsOf(m).has("grades.enter")).toBe(true);
    await expect(acceptInvite(token, { mode: "signin", email: e, password: PASSWORD }, { ip: ip() })).rejects.toMatchObject({ code: "ACCEPTED" });
  });

  it("a parent invite links the invited children to the parent's guardian record", async () => {
    const e = email("parent");
    const res = await inviteParent(A.admin, { email: e, nameEn: "Rana Testing", studentIds: [A.adam, A.yara] }, { send: false });
    const joined = await acceptInvite(res.created[0].token, { mode: "create", name: "Rana Testing", email: e, password: PASSWORD }, { ip: ip() });
    const g = await owner.guardian.findUnique({ where: { membershipId: joined.membershipId }, include: { links: true } });
    expect(g?.links.map((l) => l.studentId).sort()).toEqual([A.adam, A.yara].sort());
    const roles = await owner.membershipRole.findMany({ where: { membershipId: joined.membershipId }, include: { role: true } });
    expect(roles.map((r) => r.role.key)).toEqual(["parent"]);
  });

  it("personal invites only work for the invited email, and revoked links stop working", async () => {
    const e = email("invited");
    const res = await inviteStaff(A.admin, [{ nameEn: "Invited Person", email: e, roleKeys: ["teacher"] }], { send: false });
    await expect(acceptInvite(res.created[0].token, { mode: "create", name: "Someone Else", email: email("other"), password: PASSWORD }, { ip: ip() })).rejects.toMatchObject({ code: "WRONG_EMAIL" });
    const link = await createStaffLink(A.admin, { roleKey: "teacher", maxUses: 2, days: 7 });
    await revokeInvitation(A.admin, link.invitationId);
    await expect(acceptInvite(link.token, { mode: "create", name: "Late Comer", email: email("late"), password: PASSWORD }, { ip: ip() })).rejects.toMatchObject({ code: "REVOKED" });
  });

  it("a school cannot see another school's invitations", async () => {
    const res = await inviteStaff(A.admin, [{ nameEn: "Private Invite", email: email("private"), roleKeys: ["teacher"] }], { send: false });
    const id = res.created[0].invitationId;
    expect(await tenantDb(A.orgId).invitation.findUnique({ where: { id } })).not.toBeNull();
    expect(await tenantDb(B.orgId).invitation.findUnique({ where: { id } })).toBeNull();
    expect((await tenantDb(B.orgId).invitation.findMany()).some((i) => i.orgId === A.orgId)).toBe(false);
    // The platform lookup resolves the token to its own school only.
    expect(await findInvitationByToken(res.created[0].token)).toEqual({ orgId: A.orgId, invitationId: id });
    await expect(tenantDb(B.orgId).invitation.update({ where: { id }, data: { revokedAt: new Date() } })).rejects.toThrow();
  });
});

describe("joining with the school code", () => {
  it("links immediately when the child details match and approval is off", async () => {
    const e = email("codeparent");
    const res = await joinWithCode(
      { code: A.code.toLowerCase(), kind: "PARENT", account: { mode: "create", name: "Code Parent", email: e, password: PASSWORD }, children: [{ studentNo: `A-9001`, dateOfBirth: "2012-03-01" }] },
      { ip: ip() },
    );
    expect(res.status).toBe("ACTIVE");
    const g = await owner.guardian.findUnique({ where: { membershipId: res.membershipId }, include: { links: true } });
    expect(g?.links.map((l) => l.studentId)).toEqual([A.adam]);
  });

  it("wrong details reveal nothing and create a pending request with no access", async () => {
    const e = email("wrongparent");
    const res = await joinWithCode(
      { code: A.code, kind: "PARENT", account: { mode: "create", name: "Wrong Parent", email: e, password: PASSWORD }, children: [{ studentNo: `A-9001`, dateOfBirth: "2012-03-02" }] },
      { ip: ip() },
    );
    expect(res.status).toBe("PENDING_APPROVAL");
    const m = await owner.membership.findUnique({ where: { id: res.membershipId }, include: { roles: { include: { role: true } }, guardian: { include: { links: true } } } });
    expect(m?.status).toBe("PENDING_APPROVAL");
    expect(m?.roles).toEqual([]);
    expect(m?.guardian).toBeNull();
    const req = await owner.joinRequest.findFirst({ where: { membershipId: res.membershipId } });
    expect(req?.status).toBe("PENDING");

    // What the person can see: only their own request, never student records.
    const status = await joinStatusForUser(res.userId);
    expect(status.waiting).toHaveLength(1);
    const json = JSON.stringify(status);
    expect(json).not.toContain("Adam");
    expect(json).not.toContain("A-9001");
    expect(json).not.toContain(A.adam);
  });

  it("a PENDING_APPROVAL membership gets no permissions, even if it somehow held roles", async () => {
    const e = email("pendingroles");
    const res = await joinWithCode({ code: B.code, kind: "PARENT", account: { mode: "create", name: "Pending Parent", email: e, password: PASSWORD }, children: [{ studentNo: "B-9001", dateOfBirth: "2012-03-01" }] }, { ip: ip() });
    expect(res.status).toBe("PENDING_APPROVAL");
    const m = await owner.membership.findUniqueOrThrow({ where: { id: res.membershipId } });
    // App check: the permission set is empty for any status other than ACTIVE.
    expect(permissionsOf({ status: m.status, roles: [{ role: { key: "parent", permissions: ["family.portal", "grades.view_own"] } }] }).size).toBe(0);
    // Tenant + RLS: the person's session org is B; nothing of school A is visible there, and B's own request stays in B.
    expect(await tenantDb(B.orgId).student.findUnique({ where: { id: A.adam } })).toBeNull();
    expect(await tenantDb(A.orgId).joinRequest.findFirst({ where: { membershipId: res.membershipId } })).toBeNull();
  });

  it("requires approval when the school asks for it, and approval links the chosen children", async () => {
    const e = email("approvalparent");
    const res = await joinWithCode({ code: B.code, kind: "PARENT", account: { mode: "create", name: "Approve Me", email: e, password: PASSWORD }, children: [{ grade: 6, fullName: "Yara Testing" }] }, { ip: ip() });
    expect(res.status).toBe("PENDING_APPROVAL");
    const req = await owner.joinRequest.findFirstOrThrow({ where: { membershipId: res.membershipId } });
    await approveJoinRequest(B.admin, { requestId: req.id, studentIds: [B.yara] });
    const m = await owner.membership.findUniqueOrThrow({ where: { id: res.membershipId }, include: { roles: { include: { role: true } }, guardian: { include: { links: true } } } });
    expect(m.status).toBe("ACTIVE");
    expect(m.roles.map((r) => r.role.key)).toEqual(["parent"]);
    expect(m.guardian?.links.map((l) => l.studentId)).toEqual([B.yara]);
    expect((await owner.joinRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("APPROVED");
  });

  it("locks out after repeated wrong child details", async () => {
    const who = ip();
    for (let i = 0; i < CLAIM_FAILURE_LIMIT; i++) {
      await joinWithCode({ code: A.code, kind: "PARENT", account: { mode: "create", name: "Guesser", email: email(`guess${i}`), password: PASSWORD }, children: [{ studentNo: `A-${1000 + i}`, dateOfBirth: "2010-01-01" }] }, { ip: who });
    }
    await expect(
      joinWithCode({ code: A.code, kind: "PARENT", account: { mode: "create", name: "Guesser", email: email("guessX"), password: PASSWORD }, children: [{ studentNo: "A-9001", dateOfBirth: "2012-03-01" }] }, { ip: who }),
    ).rejects.toMatchObject({ code: "LOCKED" });
  });

  it("uses one generic error for credential problems", async () => {
    const e = email("existing");
    await joinWithCode({ code: A.code, kind: "PARENT", account: { mode: "create", name: "Existing", email: e, password: PASSWORD }, children: [{ studentNo: "A-6001", dateOfBirth: "2015-08-12" }] }, { ip: ip() });
    const attempt = joinWithCode({ code: B.code, kind: "PARENT", account: { mode: "create", name: "Intruder", email: e, password: "wrong-password" }, children: [{ studentNo: "B-6001", dateOfBirth: "2015-08-12" }] }, { ip: ip() });
    await expect(attempt).rejects.toBeInstanceOf(JoinError);
    await expect(attempt).rejects.toMatchObject({ code: "CREDENTIALS" });
  });
});

describe("roles", () => {
  it("editing a built-in role marks it customized and the deploy sync leaves it alone", async () => {
    const teacher = A.roleIds.teacher;
    const counselor = A.roleIds.counselor;
    await setRolePermission(A.admin, { roleId: teacher, permission: "analytics.view", granted: true });
    const edited = await owner.role.findUniqueOrThrow({ where: { id: teacher } });
    expect(edited.customized).toBe(true);
    expect(edited.permissions).toContain("analytics.view");
    await owner.role.update({ where: { id: counselor }, data: { permissions: ["tasks.use"] } });

    const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await client.connect();
    try {
      await syncSystemRoles((sql, params) => client.query(sql, params), { orgId: A.orgId });
    } finally {
      await client.end();
    }
    expect((await owner.role.findUniqueOrThrow({ where: { id: teacher } })).permissions).toContain("analytics.view");
    // A role the school never changed is brought back in step with the code.
    expect((await owner.role.findUniqueOrThrow({ where: { id: counselor } })).permissions.sort()).toEqual([...SYSTEM_ROLES.find((r) => r.key === "counselor")!.permissions].sort());
  });

  it("sensitive permissions need the typed role name and family roles cannot get staff permissions", async () => {
    await expect(setRolePermission(A.admin, { roleId: A.roleIds.teacher, permission: "safeguarding.view", granted: true })).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    await setRolePermission(A.admin, { roleId: A.roleIds.teacher, permission: "safeguarding.view", granted: true, confirmText: "teacher" });
    await setRolePermission(A.admin, { roleId: A.roleIds.teacher, permission: "safeguarding.view", granted: false });
    await expect(setRolePermission(A.admin, { roleId: A.roleIds.parent, permission: "cases.manage", granted: true })).rejects.toMatchObject({ code: "AUDIENCE" });
    const audits = await owner.auditEvent.findMany({ where: { orgId: A.orgId, entityType: "Role", entityId: A.roleIds.teacher } });
    expect(audits.some((a) => a.action === "roles.permission_grant" && (a.meta as { before: string[]; after: string[] }).after.includes("safeguarding.view"))).toBe(true);
  });

  it("custom role grants take effect for the person on their next request", async () => {
    const e = email("custom");
    const inv = await inviteStaff(A.admin, [{ nameEn: "Custom Person", email: e, roleKeys: ["teacher"] }], { send: false });
    const joined = await acceptInvite(inv.created[0].token, { mode: "create", name: "Custom Person", email: e, password: PASSWORD }, { ip: ip() });
    const role = await createRole(A.admin, { nameEn: "Exams Officer", nameAr: "مسؤول الاختبارات", copyFromRoleId: null });
    expect(role.isSystem).toBe(false);
    await setRolePermission(A.admin, { roleId: role.id, permission: "calendar.manage", granted: true });
    await setMemberRoles(A.admin, { membershipId: joined.membershipId, roleIds: [A.roleIds.teacher, role.id] });
    const load = () => owner.membership.findUniqueOrThrow({ where: { id: joined.membershipId }, include: { roles: { include: { role: true } } } });
    expect(permissionsOf(await load()).has("calendar.manage")).toBe(true);
    await setRolePermission(A.admin, { roleId: role.id, permission: "calendar.manage", granted: false });
    expect(permissionsOf(await load()).has("calendar.manage")).toBe(false);
  });

  it("never removes roles.manage from the last active person who has it", async () => {
    // A.admin is the only person with a role that grants roles.manage (school_admin) in school A.
    await expect(setRolePermission(A.admin, { roleId: A.roleIds.school_admin, permission: "roles.manage", granted: false })).rejects.toBeInstanceOf(AccessError);
    await expect(setMemberRoles(A.admin, { membershipId: A.admin.membershipId, roleIds: [A.roleIds.teacher] })).rejects.toMatchObject({ code: "LAST_ROLES_MANAGER" });
    const role = await owner.role.findUniqueOrThrow({ where: { id: A.roleIds.school_admin } });
    expect(role.permissions).toContain("roles.manage");
  });
});
