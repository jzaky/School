"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx, type Ctx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { identityDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { encryptField } from "@/lib/crypto";
import { STAFF_ROLE_KEYS } from "@/server/identity/permissions";
import { RELATIONSHIPS, emiratesIdLast4, isEmail, parseDate, parseEmiratesId } from "@/lib/people-csv";
import { ImportTooLargeError, importStudentRows } from "@/server/admin/people-import";
import { AccessError, assertMemberRolesChangeAllowed } from "@/server/access/roles";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const ADMIN_ROLE = "school_admin";

async function manager(): Promise<Ctx | null> {
  const ctx = await getCtx();
  return ctx.can("people.manage") ? ctx : null;
}

const actorOf = (ctx: Ctx) => ({ actorId: ctx.membershipId, actorUserId: ctx.user.id });

function done() {
  revalidatePath("/[locale]/admin/people", "page");
}

async function roleIds(tx: TenantTx, keys: string[]) {
  const roles = await tx.role.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  return roles;
}

/** Active members, other than `exceptMembershipId`, who hold the school administrator role. */
async function otherActiveAdmins(tx: TenantTx, exceptMembershipId: string) {
  return tx.membership.count({
    where: { id: { not: exceptMembershipId }, status: "ACTIVE", roles: { some: { role: { key: ADMIN_ROLE } } } },
  });
}

const staffRoleKeys = z.array(z.string()).min(1).max(STAFF_ROLE_KEYS.length).refine((ks) => ks.every((k) => STAFF_ROLE_KEYS.includes(k)), "role");

const addStaffSchema = z.object({
  email: z.string().trim().toLowerCase().refine(isEmail, "email"),
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().max(120).optional(),
  titleEn: z.string().trim().max(120).optional(),
  titleAr: z.string().trim().max(120).optional(),
  departmentId: z.string().nullable().optional(),
  roleKeys: staffRoleKeys,
  status: z.enum(["ACTIVE", "INVITED"]),
});

/** Add a staff member: creates the global user when the email is new, then membership, profile and roles. */
export async function addStaffAction(input: z.input<typeof addStaffSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = addStaffSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message === "email" ? "EMAIL" : "INVALID");
  const d = parsed.data;
  if (d.roleKeys.includes(ADMIN_ROLE) && !ctx.can("school.manage")) return fail("ADMIN_ROLE_ONLY");
  if (d.departmentId && !(await ctx.db.department.findUnique({ where: { id: d.departmentId }, select: { id: true } }))) return fail("INVALID");

  let user = await identityDb.user.findUnique({ where: { email: d.email } });
  const newUser = !user;
  if (user) {
    const existing = await ctx.db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: user.id } }, select: { id: true } });
    if (existing) return fail("ALREADY_MEMBER");
  } else {
    user = await identityDb.user.create({ data: { email: d.email, nameEn: d.nameEn, nameAr: d.nameAr || null } });
  }
  const userId = user.id;
  const membershipId = await tenantTx(ctx.orgId, async (tx) => {
    const m = await tx.membership.create({
      data: { orgId: ctx.orgId, userId, status: d.status, titleEn: d.titleEn || null, titleAr: d.titleAr || d.titleEn || null },
    });
    await tx.staffProfile.create({
      data: { orgId: ctx.orgId, membershipId: m.id, departmentId: d.departmentId || null, jobTitleEn: d.titleEn || null, jobTitleAr: d.titleAr || d.titleEn || null },
    });
    const roles = await roleIds(tx, d.roleKeys);
    await tx.membershipRole.createMany({ data: roles.map((r) => ({ orgId: ctx.orgId, membershipId: m.id, roleId: r.id })) });
    await audit(tx, ctx.orgId, { ...actorOf(ctx), action: "people.staff_add", entityType: "Membership", entityId: m.id, meta: { roles: d.roleKeys, status: d.status, newUser } });
    return m.id;
  });
  done();
  return { ok: true as const, membershipId };
}

const updateStaffSchema = z.object({
  membershipId: z.string().min(1),
  roleKeys: staffRoleKeys,
  departmentId: z.string().nullable().optional(),
  titleEn: z.string().trim().max(120).optional(),
  titleAr: z.string().trim().max(120).optional(),
});

/** Change a staff member's roles, department and title. Keeps at least one active school administrator. */
export async function updateStaffAction(input: z.input<typeof updateStaffSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = updateStaffSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  if (d.departmentId && !(await ctx.db.department.findUnique({ where: { id: d.departmentId }, select: { id: true } }))) return fail("INVALID");
  const result = await tenantTx(ctx.orgId, async (tx): Promise<Fail | { ok: true }> => {
    const m = await tx.membership.findUnique({ where: { id: d.membershipId }, include: { roles: { include: { role: true } }, student: { select: { id: true } }, guardian: { select: { id: true } } } });
    if (!m || m.student || m.guardian) return fail("NOT_FOUND");
    const before = m.roles.map((r) => r.role.key);
    const hadAdmin = before.includes(ADMIN_ROLE);
    const hasAdmin = d.roleKeys.includes(ADMIN_ROLE);
    if (hadAdmin !== hasAdmin && !ctx.can("school.manage")) return fail("ADMIN_ROLE_ONLY");
    if (hadAdmin && !hasAdmin) {
      if (m.id === ctx.membershipId) return fail("SELF_ADMIN");
      if (m.status === "ACTIVE" && (await otherActiveAdmins(tx, m.id)) === 0) return fail("LAST_ADMIN");
    }
    const wanted = await roleIds(tx, d.roleKeys);
    const wantedIds = new Set(wanted.map((r) => r.id));
    const keep = m.roles.filter((r) => wantedIds.has(r.roleId) || !STAFF_ROLE_KEYS.includes(r.role.key));
    try {
      await assertMemberRolesChangeAllowed(tx, { orgId: ctx.orgId, membershipId: ctx.membershipId, userId: ctx.user.id }, m.id, [...new Set([...keep.map((r) => r.roleId), ...wanted.map((r) => r.id)])]);
    } catch (e) {
      if (e instanceof AccessError) return fail(e.code);
      throw e;
    }
    await tx.membershipRole.deleteMany({ where: { membershipId: m.id, id: { notIn: keep.map((r) => r.id) } } });
    const have = new Set(keep.map((r) => r.roleId));
    const add = wanted.filter((r) => !have.has(r.id));
    if (add.length) await tx.membershipRole.createMany({ data: add.map((r) => ({ orgId: ctx.orgId, membershipId: m.id, roleId: r.id })) });
    const titleEn = d.titleEn || null;
    const titleAr = d.titleAr || d.titleEn || null;
    await tx.membership.update({ where: { id: m.id }, data: { titleEn, titleAr } });
    await tx.staffProfile.upsert({
      where: { membershipId: m.id },
      create: { orgId: ctx.orgId, membershipId: m.id, departmentId: d.departmentId || null, jobTitleEn: titleEn, jobTitleAr: titleAr },
      update: { departmentId: d.departmentId || null, jobTitleEn: titleEn, jobTitleAr: titleAr },
    });
    const after = [...d.roleKeys].sort();
    await audit(tx, ctx.orgId, {
      ...actorOf(ctx),
      action: "people.staff_update",
      entityType: "Membership",
      entityId: m.id,
      meta: { rolesBefore: [...before].sort(), rolesAfter: after, departmentId: d.departmentId || null },
    });
    return { ok: true };
  });
  if (result.ok) done();
  return result;
}

const statusSchema = z.object({ membershipId: z.string().min(1), status: z.enum(["ACTIVE", "SUSPENDED"]) });

/** Suspend or (re)activate a member. Suspended members cannot sign in and their open sessions stop working. */
export async function setMemberStatusAction(input: z.input<typeof statusSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  if (d.membershipId === ctx.membershipId) return fail("SELF_STATUS");
  const result = await tenantTx(ctx.orgId, async (tx): Promise<Fail | { ok: true }> => {
    const m = await tx.membership.findUnique({ where: { id: d.membershipId }, include: { roles: { include: { role: true } } } });
    if (!m) return fail("NOT_FOUND");
    if (m.status === d.status) return { ok: true };
    const isAdmin = m.roles.some((r) => r.role.key === ADMIN_ROLE);
    if (isAdmin && !ctx.can("school.manage")) return fail("ADMIN_ROLE_ONLY");
    if (d.status === "SUSPENDED" && isAdmin && m.status === "ACTIVE" && (await otherActiveAdmins(tx, m.id)) === 0) return fail("LAST_ADMIN");
    await tx.membership.update({ where: { id: m.id }, data: { status: d.status } });
    await audit(tx, ctx.orgId, {
      ...actorOf(ctx),
      action: d.status === "SUSPENDED" ? "people.member_suspend" : "people.member_activate",
      entityType: "Membership",
      entityId: m.id,
      meta: { from: m.status, to: d.status },
    });
    return { ok: true };
  });
  if (result.ok) done();
  return result;
}

const nameEn = z.string().trim().min(1).max(80);
const nameAr = z.string().trim().max(80).optional();

const addStudentSchema = z.object({
  studentNo: z.string().trim().min(1).max(40),
  firstNameEn: nameEn,
  lastNameEn: nameEn,
  firstNameAr: nameAr,
  lastNameAr: nameAr,
  gradeLevel: z.number().int().min(1).max(13),
  section: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,3}$/).optional(),
  dateOfBirth: z.string().optional(),
  emiratesId: z.string().optional(),
  passportNo: z.string().optional(),
  guardian: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("existing"), guardianId: z.string().min(1), relationship: z.string() }),
    z.object({
      mode: z.literal("new"),
      firstNameEn: nameEn,
      lastNameEn: nameEn,
      firstNameAr: nameAr,
      lastNameAr: nameAr,
      email: z.string().trim().toLowerCase(),
      phone: z.string().trim().max(40).optional(),
      relationship: z.string(),
    }),
  ]),
});

/** Add one student, with encrypted identifiers and an optional guardian link. */
export async function addStudentAction(input: z.input<typeof addStudentSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = addStudentSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  const studentNo = d.studentNo.toUpperCase();
  const dob = d.dateOfBirth ? parseDate(d.dateOfBirth) : null;
  if (d.dateOfBirth && !dob) return fail("DATE");
  const eid = d.emiratesId?.trim() ? parseEmiratesId(d.emiratesId) : null;
  if (d.emiratesId?.trim() && !eid) return fail("EMIRATES_ID");
  const passport = d.passportNo?.replace(/\s/g, "").toUpperCase() || null;
  if (passport && !/^[A-Z0-9]{5,12}$/.test(passport)) return fail("PASSPORT");
  const g = d.guardian;
  if (g.mode !== "none" && !RELATIONSHIPS[g.relationship]) return fail("INVALID");
  if (g.mode === "new" && !isEmail(g.email)) return fail("EMAIL");

  const result = await tenantTx(ctx.orgId, async (tx): Promise<Fail | { ok: true; studentId: string }> => {
    const dup = await tx.student.findUnique({ where: { orgId_studentNo: { orgId: ctx.orgId, studentNo } }, select: { id: true } });
    if (dup) return fail("DUPLICATE_STUDENT_NO");
    const student = await tx.student.create({
      data: {
        orgId: ctx.orgId,
        studentNo,
        firstNameEn: d.firstNameEn,
        lastNameEn: d.lastNameEn,
        firstNameAr: d.firstNameAr || d.firstNameEn,
        lastNameAr: d.lastNameAr || d.lastNameEn,
        gradeLevel: d.gradeLevel,
        section: d.section || null,
        dateOfBirth: dob ? new Date(`${dob}T00:00:00Z`) : null,
        emiratesIdEnc: eid ? encryptField(eid) : null,
        emiratesIdLast4: eid ? emiratesIdLast4(eid) : null,
        passportEnc: passport ? encryptField(passport) : null,
        passportLast4: passport ? passport.slice(-4) : null,
        status: "ACTIVE",
        enrolledOn: new Date(),
      },
    });
    let guardianId: string | null = null;
    if (g.mode === "existing") {
      const found = await tx.guardian.findUnique({ where: { id: g.guardianId }, select: { id: true } });
      if (!found) throw new Error("GUARDIAN_NOT_FOUND");
      guardianId = found.id;
    } else if (g.mode === "new") {
      const byEmail = await tx.guardian.findFirst({ where: { email: { equals: g.email, mode: "insensitive" } }, select: { id: true } });
      guardianId =
        byEmail?.id ??
        (
          await tx.guardian.create({
            data: { orgId: ctx.orgId, firstNameEn: g.firstNameEn, lastNameEn: g.lastNameEn, firstNameAr: g.firstNameAr || g.firstNameEn, lastNameAr: g.lastNameAr || g.lastNameEn, email: g.email, phone: g.phone || null },
          })
        ).id;
    }
    if (guardianId && g.mode !== "none") {
      const rel = RELATIONSHIPS[g.relationship];
      await tx.guardianLink.create({ data: { orgId: ctx.orgId, guardianId, studentId: student.id, relationshipEn: rel.en, relationshipAr: rel.ar, isPrimary: true, canApprove: true, receivesUpdates: true } });
    }
    await audit(tx, ctx.orgId, { ...actorOf(ctx), action: "people.student_add", entityType: "Student", entityId: student.id, meta: { guardian: g.mode, hasEmiratesId: !!eid, hasPassport: !!passport } });
    return { ok: true, studentId: student.id };
  }).catch((e: unknown) => (e instanceof Error && e.message === "GUARDIAN_NOT_FOUND" ? fail("NOT_FOUND") : Promise.reject(e)));
  if (result.ok) done();
  return result;
}

const linkSchema = z.object({ linkId: z.string().min(1), isPrimary: z.boolean(), canApprove: z.boolean(), receivesUpdates: z.boolean() });

/** Update a guardian link. Setting a primary guardian clears the flag on the student's other links. */
export async function updateGuardianLinkAction(input: z.input<typeof linkSchema>) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  const result = await tenantTx(ctx.orgId, async (tx): Promise<Fail | { ok: true }> => {
    const link = await tx.guardianLink.findUnique({ where: { id: d.linkId } });
    if (!link) return fail("NOT_FOUND");
    if (d.isPrimary) await tx.guardianLink.updateMany({ where: { studentId: link.studentId, id: { not: link.id } }, data: { isPrimary: false } });
    await tx.guardianLink.update({ where: { id: link.id }, data: { isPrimary: d.isPrimary, canApprove: d.canApprove, receivesUpdates: d.receivesUpdates } });
    await audit(tx, ctx.orgId, {
      ...actorOf(ctx),
      action: "people.guardian_link_update",
      entityType: "GuardianLink",
      entityId: link.id,
      meta: { before: { isPrimary: link.isPrimary, canApprove: link.canApprove, receivesUpdates: link.receivesUpdates }, after: { isPrimary: d.isPrimary, canApprove: d.canApprove, receivesUpdates: d.receivesUpdates } },
    });
    return { ok: true };
  });
  if (result.ok) done();
  return result;
}

/** Import students with guardians from parsed CSV rows. The server validates every row again. */
export async function importStudentsAction(input: { fileName: string; rows: Array<Record<string, unknown>> }) {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  if (!Array.isArray(input.rows) || input.rows.length === 0) return fail("EMPTY");
  try {
    const res = await importStudentRows(ctx.orgId, { membershipId: ctx.membershipId, userId: ctx.user.id }, String(input.fileName ?? ""), input.rows);
    done();
    return { ok: true as const, ...res };
  } catch (e) {
    if (e instanceof ImportTooLargeError) return fail("TOO_MANY_ROWS");
    throw e;
  }
}
