// Limited admin access against real Postgres through the RLS-restricted app role: an administrator cannot
// give themselves safeguarding access by any path, a second person who manages roles can, the safeguarding
// lead is told, time-limited access stops on the next request and is tidied by the daily job.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { permissionsOf } from "@/server/identity/can";
import {
  AccessError,
  addRoleMember,
  assertMemberRolesChangeAllowed,
  createRole,
  deleteRole,
  removeRoleMember,
  restoreRoleDefault,
  setAssignmentEnd,
  setMemberRoles,
  setRolePermission,
} from "@/server/access/roles";
import { createStaffLink } from "@/server/access/invitations";
import { acceptInvite } from "@/server/access/join";
import { importStaff, previewStaff } from "@/server/imports/staff";
import { expireRoleAssignments } from "@/server/access/expiry";
import { activeRolesInclude } from "@/server/access/until";
import { buildAccessReport, reportMemberSelect, reportMemberWhere } from "@/server/access/report";
import { ACCESS_ALERT_TEMPLATE } from "@/server/access/access-alerts";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const DAY = 86_400_000;
type Person = { orgId: string; membershipId: string; userId: string };
let orgId = "";
let otherOrgId = "";
const roleIds: Record<string, string> = {};
let aisha: Person; // school administrator (manages roles, no safeguarding access)
let omar: Person; // principal (also manages roles)
let khalid: Person; // designated safeguarding lead
let daniel: Person; // teacher
const ip = () => `itest-${uid("ip")}`;

async function person(label: string, roles: string[], email = `${uid(label.split(" ")[0].toLowerCase())}@limited.test`): Promise<Person> {
  const user = await owner.user.create({ data: { email, nameEn: label, nameAr: label } });
  const m = await owner.membership.create({ data: { orgId, userId: user.id } });
  await owner.staffProfile.create({ data: { orgId, membershipId: m.id } });
  for (const k of roles) await owner.membershipRole.create({ data: { orgId, membershipId: m.id, roleId: roleIds[k] } });
  return { orgId, membershipId: m.id, userId: user.id };
}

/** What the request context grants: the same role query as src/server/context.ts. */
async function permsNow(p: Person) {
  const m = await tenantDb(orgId).membership.findUniqueOrThrow({ where: { id: p.membershipId }, include: { roles: activeRolesInclude() } });
  return permissionsOf(m);
}

const alertsFor = (p: Person) => owner.notification.findMany({ where: { orgId, recipientId: p.membershipId, kind: ACCESS_ALERT_TEMPLATE }, orderBy: { createdAt: "asc" } });
const expectCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(AccessError);
  await expect(p).rejects.toMatchObject({ code });
};

beforeAll(async () => {
  const org = await owner.organization.create({ data: { slug: uid("limited"), nameEn: "Limited Access School", nameAr: "مدرسة الصلاحيات المحدودة" } });
  orgId = org.id;
  otherOrgId = (await owner.organization.create({ data: { slug: uid("limited-other"), nameEn: "Other School", nameAr: "مدرسة أخرى" } })).id;
  for (const r of SYSTEM_ROLES) {
    const row = await owner.role.create({ data: { orgId, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, descEn: r.descEn, descAr: r.descAr, permissions: r.permissions } });
    roleIds[r.key] = row.id;
  }
  aisha = await person("Aisha Admin", ["school_admin"]);
  omar = await person("Omar Principal", ["principal"]);
  khalid = await person("Khalid DSL", ["dsl", "teacher"]);
  daniel = await person("Daniel Teacher", ["teacher"]);
});

afterAll(async () => {
  for (const id of [orgId, otherOrgId]) if (id) await owner.organization.delete({ where: { id } }).catch(() => undefined);
  await owner.user.deleteMany({ where: { email: { endsWith: "@limited.test" } } });
  await owner.$disconnect();
});

describe("an administrator cannot give themselves safeguarding access", () => {
  it("by adding the permission to a role they hold", async () => {
    await expectCode(setRolePermission(aisha, { roleId: roleIds.school_admin, permission: "safeguarding.view", granted: true, confirmText: "School Administrator" }), "SELF_ESCALATION");
    const blocked = await owner.auditEvent.findFirst({ where: { orgId, action: "access.self_grant_blocked", actorId: aisha.membershipId } });
    expect(blocked?.meta).toMatchObject({ path: "role_permission", permissions: ["safeguarding.view"] });
  });

  it("by adding a role to themselves, on the role page or the people page", async () => {
    await expectCode(addRoleMember(aisha, { roleId: roleIds.dsl, membershipId: aisha.membershipId, confirmSensitive: true }), "SELF_ESCALATION");
    await expectCode(setMemberRoles(aisha, { membershipId: aisha.membershipId, roleIds: [roleIds.school_admin, roleIds.deputy_dsl], confirmSensitive: true }), "SELF_ESCALATION");
    await expectCode(
      tenantTx(orgId, (tx) => assertMemberRolesChangeAllowed(tx, aisha, aisha.membershipId, [roleIds.school_admin, roleIds.dsl])),
      "SELF_ESCALATION",
    );
  });

  it("by restoring a role default that adds sensitive access", async () => {
    // Omar trims the administrator role; Aisha may not put the audit log back for herself.
    await setRolePermission(omar, { roleId: roleIds.school_admin, permission: "audit.view", granted: false });
    await expectCode(restoreRoleDefault(aisha, roleIds.school_admin), "SELF_ESCALATION");
    await restoreRoleDefault(omar, roleIds.school_admin);
    expect((await permsNow(aisha)).has("audit.view")).toBe(true);
  });

  it("by copying a sensitive role and joining it, or by being moved into one", async () => {
    const copy = await createRole(aisha, { nameEn: "Safeguarding Copy", nameAr: "نسخة الحماية", copyFromRoleId: roleIds.dsl });
    expect(copy.permissions).toContain("safeguarding.view");
    await expectCode(addRoleMember(aisha, { roleId: copy.id, membershipId: aisha.membershipId, confirmSensitive: true }), "SELF_ESCALATION");
    const helper = await createRole(aisha, { nameEn: "IT Helpers", nameAr: "مساعدو التقنية", copyFromRoleId: null });
    await addRoleMember(aisha, { roleId: helper.id, membershipId: aisha.membershipId });
    await expectCode(deleteRole(aisha, { roleId: helper.id, moveToRoleId: roleIds.dsl }), "SELF_ESCALATION");
    await deleteRole(aisha, { roleId: helper.id, moveToRoleId: roleIds.teacher });
  });

  it("by accepting a staff link they made", async () => {
    const link = await createStaffLink(aisha, { roleKey: "dsl", maxUses: 1, days: 1 });
    await expect(acceptInvite(link.token, { mode: "session", userId: aisha.userId }, { ip: ip() })).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
    expect((await owner.invitation.findFirstOrThrow({ where: { orgId, roleKeys: { has: "dsl" } } })).uses).toBe(0);
  });

  it("by importing a spreadsheet with their own row", async () => {
    const email = (await owner.user.findUniqueOrThrow({ where: { id: aisha.userId } })).email;
    const actor = { ...aisha, perms: await permsNow(aisha) };
    const records = [{ row: 2, values: { name_en: "Aisha Admin", email, roles: "dsl" } }];
    const preview = await previewStaff(actor, records, "en");
    expect(preview.rows[0].errors.map((e) => e.code)).toContain("selfEscalation");
    await importStaff(actor, "staff.csv", records);
    expect((await permsNow(aisha)).has("safeguarding.view")).toBe(false);
  });

  it("by keeping time-limited sensitive access for longer, while ending it sooner stays allowed", async () => {
    const now = new Date();
    await addRoleMember(omar, { roleId: roleIds.nurse, membershipId: aisha.membershipId, confirmSensitive: true, expiresAt: new Date(now.getTime() + 5 * DAY) });
    expect((await permsNow(aisha)).has("people.medical")).toBe(true);
    await expectCode(setAssignmentEnd(aisha, { roleId: roleIds.nurse, membershipId: aisha.membershipId, expiresAt: new Date(now.getTime() + 10 * DAY) }), "SELF_ESCALATION");
    await expectCode(setAssignmentEnd(aisha, { roleId: roleIds.nurse, membershipId: aisha.membershipId, expiresAt: null }), "SELF_ESCALATION");
    await setAssignmentEnd(aisha, { roleId: roleIds.nurse, membershipId: aisha.membershipId, expiresAt: new Date(now.getTime() + 2 * DAY) });
    await removeRoleMember(aisha, { roleId: roleIds.nurse, membershipId: aisha.membershipId });
    expect((await permsNow(aisha)).has("people.medical")).toBe(false);
  });

  it("and after every attempt holds no safeguarding access at all", async () => {
    const p = await permsNow(aisha);
    for (const k of ["safeguarding.view", "safeguarding.manage", "safeguarding.export", "safeguarding.break_glass", "cases.wellbeing"]) expect(p.has(k)).toBe(false);
  });
});

describe("a second person who manages roles can grant it, and the safeguarding lead is told", () => {
  it("grants safeguarding.view to the administrator role and alerts the DSL by app and email", async () => {
    const before = (await alertsFor(khalid)).length;
    await setRolePermission(omar, { roleId: roleIds.school_admin, permission: "safeguarding.view", granted: true, confirmText: "school administrator" });
    expect((await permsNow(aisha)).has("safeguarding.view")).toBe(true);
    const alerts = await alertsFor(khalid);
    expect(alerts.length).toBe(before + 1);
    const a = alerts.at(-1)!;
    expect(a.titleEn).toContain("Omar Principal");
    expect(a.bodyEn).toContain("The role School Administrator now gives: see safeguarding cases");
    expect(a.bodyAr).toContain("الاطلاع على ملفات الحماية");
    expect(a.href).toBe("/admin/roles/report");
    const mail = await owner.outboundMessage.findMany({ where: { orgId, templateKey: ACCESS_ALERT_TEMPLATE, idempotencyKey: { endsWith: `:${khalid.membershipId}:EMAIL` } } });
    expect(mail.length).toBeGreaterThan(0);
    // The person who made the change is not alerted about their own change.
    expect((await alertsFor(omar)).length).toBe(0);
    await setRolePermission(omar, { roleId: roleIds.school_admin, permission: "safeguarding.view", granted: false });
    expect((await permsNow(aisha)).has("safeguarding.view")).toBe(false);
  });

  it("alerts the principal instead when the only safeguarding manager made the change", async () => {
    // Khalid temporarily manages roles too, and adds Daniel to the deputy role.
    await setMemberRoles(omar, { membershipId: khalid.membershipId, roleIds: [roleIds.dsl, roleIds.teacher, roleIds.school_admin], confirmSensitive: true });
    const omarBefore = (await alertsFor(omar)).length;
    await addRoleMember(khalid, { roleId: roleIds.deputy_dsl, membershipId: daniel.membershipId, confirmSensitive: true });
    const omarAlerts = await alertsFor(omar);
    expect(omarAlerts.length).toBe(omarBefore + 1);
    expect(omarAlerts.at(-1)!.bodyEn).toContain("New access for Daniel Teacher");
    // Daniel now manages safeguarding, so the next change tells him and not the actor.
    await removeRoleMember(khalid, { roleId: roleIds.deputy_dsl, membershipId: daniel.membershipId });
    expect((await alertsFor(daniel)).at(-1)?.bodyEn).toContain("Access removed from Daniel Teacher");
    await setMemberRoles(omar, { membershipId: khalid.membershipId, roleIds: [roleIds.dsl, roleIds.teacher] });
  });

  it("does not alert for changes that do not touch safeguarding or wellbeing access", async () => {
    const before = (await alertsFor(khalid)).length;
    await setRolePermission(aisha, { roleId: roleIds.teacher, permission: "calendar.manage", granted: true });
    await setRolePermission(aisha, { roleId: roleIds.teacher, permission: "calendar.manage", granted: false });
    expect((await alertsFor(khalid)).length).toBe(before);
  });
});

describe("time-limited access", () => {
  it("needs a role without an end date, and records the end date", async () => {
    await expectCode(setMemberRoles(aisha, { membershipId: daniel.membershipId, roleIds: [roleIds.teacher], expires: {} }).then(() => setAssignmentEnd(aisha, { roleId: roleIds.teacher, membershipId: daniel.membershipId, expiresAt: new Date(Date.now() + DAY) })), "NEEDS_PERMANENT_ROLE");
    await expectCode(addRoleMember(aisha, { roleId: roleIds.nurse, membershipId: daniel.membershipId, confirmSensitive: true, expiresAt: new Date(Date.now() - DAY) }), "PAST_DATE");
    const until = new Date(Date.now() + 10 * DAY);
    await addRoleMember(aisha, { roleId: roleIds.deputy_dsl, membershipId: daniel.membershipId, confirmSensitive: true, expiresAt: until });
    const row = await owner.membershipRole.findFirstOrThrow({ where: { membershipId: daniel.membershipId, roleId: roleIds.deputy_dsl } });
    expect(row.expiresAt?.toISOString()).toBe(until.toISOString());
    const change = await owner.auditEvent.findFirst({ where: { orgId, action: "people.roles_change", entityId: daniel.membershipId }, orderBy: { createdAt: "desc" } });
    expect((change?.meta as { until?: Record<string, string> }).until?.deputy_dsl).toBe(until.toISOString());
    // The access report shows the cover and when it ends.
    const members = await tenantDb(orgId).membership.findMany({ where: reportMemberWhere(), select: reportMemberSelect });
    const sg = buildAccessReport(members).find((a) => a.key === "safeguarding")!;
    expect(sg.entries.find((e) => e.membershipId === daniel.membershipId)?.until?.toISOString()).toBe(until.toISOString());
    expect(sg.entries.some((e) => e.membershipId === aisha.membershipId)).toBe(false);
  });

  it("stops working on the next request after it ends, and the daily job removes it once", async () => {
    expect((await permsNow(daniel)).has("safeguarding.view")).toBe(true);
    // The end date passes (moved into the past directly, as time would).
    await owner.membershipRole.updateMany({ where: { membershipId: daniel.membershipId, roleId: roleIds.deputy_dsl }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const p = await permsNow(daniel);
    expect(p.has("safeguarding.view")).toBe(false);
    expect(p.has("grades.enter")).toBe(true);

    const khalidBefore = (await alertsFor(khalid)).length;
    const res = await expireRoleAssignments(orgId, { flush: async () => undefined });
    expect(res.removed).toBe(1);
    expect(await owner.membershipRole.count({ where: { membershipId: daniel.membershipId, roleId: roleIds.deputy_dsl } })).toBe(0);
    const ev = await owner.auditEvent.findFirst({ where: { orgId, action: "people.role_expired", entityId: daniel.membershipId } });
    expect(ev?.meta).toMatchObject({ roles: ["deputy_dsl"] });
    const alerts = await alertsFor(khalid);
    expect(alerts.length).toBe(khalidBefore + 1);
    expect(alerts.at(-1)!.bodyEn).toContain("Access removed from Daniel Teacher");
    expect(alerts.at(-1)!.titleEn).toContain("automatic end date");

    // Running again finds nothing and sends nothing.
    expect((await expireRoleAssignments(orgId, { flush: async () => undefined })).removed).toBe(0);
    expect((await alertsFor(khalid)).length).toBe(khalidBefore + 1);
    expect(await owner.auditEvent.count({ where: { orgId, action: "people.role_expired", entityId: daniel.membershipId } })).toBe(1);
  });

  it("can be extended or ended early by another person who manages roles", async () => {
    await addRoleMember(aisha, { roleId: roleIds.wellbeing_lead, membershipId: daniel.membershipId, confirmSensitive: true, expiresAt: new Date(Date.now() + 3 * DAY) });
    const later = new Date(Date.now() + 30 * DAY);
    await setAssignmentEnd(aisha, { roleId: roleIds.wellbeing_lead, membershipId: daniel.membershipId, expiresAt: later });
    expect((await owner.membershipRole.findFirstOrThrow({ where: { membershipId: daniel.membershipId, roleId: roleIds.wellbeing_lead } })).expiresAt?.toISOString()).toBe(later.toISOString());
    expect((await alertsFor(khalid)).at(-1)!.bodyEn).toContain("Access extended for Daniel Teacher");
    await removeRoleMember(aisha, { roleId: roleIds.wellbeing_lead, membershipId: daniel.membershipId });
    expect((await permsNow(daniel)).has("cases.wellbeing")).toBe(false);
    const ended = await owner.auditEvent.findFirst({ where: { orgId, action: "people.roles_change", entityId: daniel.membershipId }, orderBy: { createdAt: "desc" } });
    expect(ended?.meta).toMatchObject({ endedEarly: true });
  });

  it("stays inside its own school", async () => {
    const row = await owner.membershipRole.findFirstOrThrow({ where: { orgId } });
    expect(await tenantDb(otherOrgId).membershipRole.findUnique({ where: { id: row.id } })).toBeNull();
    await expect(tenantDb(otherOrgId).membershipRole.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + DAY) } })).rejects.toThrow();
    expect((await expireRoleAssignments(otherOrgId, { flush: async () => undefined })).removed).toBe(0);
  });
});
