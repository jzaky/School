// Staff import: creates the staff directory straight away (an INVITED membership with staff profile, roles,
// department and the subjects they teach) so people can be given classes and appear in pickers before they
// accept, and optionally sends each new person an invitation (src/server/access/invitations.ts).
// Re-importing matches people by email and updates them: names (only while the school still manages the
// account), job title, department and grades change when the cell has a value; roles and subjects are added,
// never removed (removing access is done on the People or Roles page). Each row saves in its own transaction.
import { identityDb, tenantDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { parseStaffRecords, type StaffLookups, type StaffRow } from "@/lib/imports/staff";
import type { SheetRecord } from "@/lib/imports/table";
import { MAX_ROWS, finishPreview, type ImportPreview, type ImportSummary, type PreviewRow, type RowAction, type RowIssue } from "@/lib/imports/types";
import { audit } from "@/server/audit/audit";
import type { Effect } from "@/server/db";
import { inviteStaff, MAX_BULK } from "@/server/access/invitations";
import { audienceOfRole, opensSensitiveRecords } from "@/server/access/permission-catalog";
import { importAccess, ImportError, type ImportActor } from "./access";
import { finishRecord, startRecord } from "./record";

const ALL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Ctx = {
  lookups: StaffLookups;
  roleKeyById: Map<string, string>;
  /** Grades each subject is taught in this year (classes and offerings), used when the file gives none. */
  subjectGrades: Map<string, number[]>;
  schoolGrades: number[];
};

async function loadContext(tx: TenantTx, orgId: string): Promise<Ctx> {
  const [roles, departments, subjects, year, studentGrades] = await Promise.all([
    tx.role.findMany({ select: { id: true, key: true, nameEn: true, nameAr: true, permissions: true } }),
    tx.department.findMany({ select: { id: true, key: true, nameEn: true, nameAr: true } }),
    tx.subject.findMany({ select: { id: true, code: true, nameEn: true, nameAr: true } }),
    tx.academicYear.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } }),
    tx.student.groupBy({ by: ["gradeLevel"], where: { status: "ACTIVE" } }),
  ]);
  const subjectGrades = new Map<string, number[]>();
  if (year) {
    const [classes, offerings] = await Promise.all([
      tx.schoolClass.findMany({ where: { academicYearId: year.id, subjectId: { not: null } }, select: { subjectId: true, gradeLevel: true } }),
      tx.subjectOffering.findMany({ where: { academicYearId: year.id }, select: { subjectId: true, gradeLevel: true } }),
    ]);
    for (const c of [...classes, ...offerings]) {
      const list = subjectGrades.get(c.subjectId!) ?? [];
      if (!list.includes(c.gradeLevel)) list.push(c.gradeLevel);
      subjectGrades.set(c.subjectId!, list.sort((a, b) => a - b));
    }
  }
  const schoolGrades = studentGrades.map((g) => g.gradeLevel).sort((a, b) => a - b);
  return {
    lookups: {
      roles: roles.map((r) => ({ id: r.id, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, family: audienceOfRole(r.key) !== "staff", sensitive: opensSensitiveRecords(r.permissions) })),
      departments,
      subjects,
    },
    roleKeyById: new Map(roles.map((r) => [r.id, r.key])),
    subjectGrades,
    schoolGrades: schoolGrades.length ? schoolGrades : ALL_GRADES,
  };
}

type Existing = {
  membershipId: string;
  status: string;
  family: boolean;
  titleEn: string | null;
  titleAr: string | null;
  roleIds: Set<string>;
  profile: { departmentId: string | null; jobTitleEn: string | null; jobTitleAr: string | null; gradeLevels: number[] } | null;
  quals: Map<string, number[]>;
};
type UserInfo = { id: string; nameEn: string; nameAr: string | null; managedBySchool: boolean };

async function loadPeople(orgId: string, emails: string[]) {
  const users = new Map<string, UserInfo>();
  const members = new Map<string, Existing>();
  if (!emails.length) return { users, members };
  const found = await identityDb.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, nameEn: true, nameAr: true, passwordHash: true, _count: { select: { accounts: true } } },
  });
  // An account nobody has signed in to yet (no password, no Google or Microsoft link) is still the school's to name.
  for (const u of found) users.set(u.email, { id: u.id, nameEn: u.nameEn, nameAr: u.nameAr, managedBySchool: !u.passwordHash && u._count.accounts === 0 });
  if (!found.length) return { users, members };
  const ms = await tenantDb(orgId).membership.findMany({
    where: { userId: { in: found.map((u) => u.id) } },
    select: {
      id: true,
      status: true,
      titleEn: true,
      titleAr: true,
      user: { select: { email: true } },
      student: { select: { id: true } },
      guardian: { select: { id: true } },
      roles: { select: { roleId: true, role: { select: { key: true } } } },
      staffProfile: { select: { departmentId: true, jobTitleEn: true, jobTitleAr: true, gradeLevels: true } },
    },
  });
  const quals = ms.length ? await tenantDb(orgId).teacherSubject.findMany({ where: { membershipId: { in: ms.map((m) => m.id) } }, select: { membershipId: true, subjectId: true, gradeLevels: true } }) : [];
  for (const m of ms) {
    members.set(m.user.email, {
      membershipId: m.id,
      status: m.status,
      family: !!m.student || !!m.guardian || m.roles.some((r) => audienceOfRole(r.role.key) !== "staff"),
      titleEn: m.titleEn,
      titleAr: m.titleAr,
      roleIds: new Set(m.roles.map((r) => r.roleId)),
      profile: m.staffProfile,
      quals: new Map(quals.filter((q) => q.membershipId === m.id).map((q) => [q.subjectId, q.gradeLevels])),
    });
  }
  return { users, members };
}

type Plan = {
  action: RowAction;
  changes: string[];
  error: string | null;
  addRoleIds: string[];
  quals: Array<{ subjectId: string; grades: number[]; isNew: boolean }>;
  profile: { departmentId?: string; jobTitleEn?: string; jobTitleAr?: string; gradeLevels?: number[] };
  names: { nameEn: string; nameAr: string | null } | null;
};

const union = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y);

function planRow(r: StaffRow, user: UserInfo | undefined, m: Existing | undefined, ctx: Ctx): Plan {
  const plan: Plan = { action: m ? "update" : "create", changes: [], error: null, addRoleIds: [], quals: [], profile: {}, names: null };
  if (m?.family) return { ...plan, error: "familyAccount" };
  if (m?.status === "SUSPENDED") return { ...plan, error: "suspended" };
  if (m?.status === "PENDING_APPROVAL") return { ...plan, error: "pendingApproval" };

  if (user?.managedBySchool && (user.nameEn !== r.nameEn || (r.nameAr && user.nameAr !== r.nameAr))) {
    plan.names = { nameEn: r.nameEn, nameAr: r.nameAr ?? user.nameAr };
    plan.changes.push("name");
  } else if (!user) plan.names = { nameEn: r.nameEn, nameAr: r.nameAr };

  plan.addRoleIds = r.roleIds.filter((id) => !m?.roleIds.has(id));
  if (m && plan.addRoleIds.length) plan.changes.push("roles");

  const p = m?.profile;
  if (r.departmentId && r.departmentId !== p?.departmentId) {
    plan.profile.departmentId = r.departmentId;
    if (m) plan.changes.push("department");
  }
  if (r.jobTitleEn || r.jobTitleAr) {
    const curEn = p?.jobTitleEn ?? m?.titleEn ?? null;
    const curAr = p?.jobTitleAr ?? m?.titleAr ?? null;
    const nextEn = r.jobTitleEn ?? curEn;
    const nextAr = r.jobTitleAr ?? curAr ?? r.jobTitleEn;
    if (nextEn !== curEn || nextAr !== curAr) {
      plan.profile.jobTitleEn = nextEn ?? undefined;
      plan.profile.jobTitleAr = nextAr ?? undefined;
      if (m) plan.changes.push("title");
    }
  }
  if (r.grades && r.grades.join(",") !== (p?.gradeLevels ?? []).join(",")) {
    plan.profile.gradeLevels = r.grades;
    if (m) plan.changes.push("grades");
  }

  for (const subjectId of r.subjectIds) {
    const wanted = r.grades ?? ctx.subjectGrades.get(subjectId) ?? ctx.schoolGrades;
    const cur = m?.quals.get(subjectId);
    const merged = union(cur ?? [], wanted);
    if (!cur) plan.quals.push({ subjectId, grades: merged, isNew: true });
    else if (merged.length !== cur.length) plan.quals.push({ subjectId, grades: merged, isNew: false });
  }
  if (m && plan.quals.length) plan.changes.push("subjects");
  if (m && plan.changes.length === 0) plan.action = "unchanged";
  return plan;
}

async function prepare(actor: ImportActor, records: SheetRecord[]) {
  if (records.length > MAX_ROWS.staff) throw new ImportError("TOO_MANY_ROWS");
  const access = importAccess(actor.perms);
  if (!access.center) throw new ImportError("FORBIDDEN");
  const ctx = await tenantTx(actor.orgId, (tx) => loadContext(tx, actor.orgId));
  const parsed = parseStaffRecords(records, ctx.lookups, { sensitiveRoles: access.sensitiveRoles, adminRole: access.adminRole });
  const people = await loadPeople(actor.orgId, parsed.rows.map((r) => r.email));
  return { ctx, parsed, people };
}

/** Checks every row against the file rules and the school's current staff, without saving anything. */
export async function previewStaff(actor: ImportActor, records: SheetRecord[], locale: string): Promise<ImportPreview> {
  const { ctx, parsed, people } = await prepare(actor, records);
  const byRow = new Map(parsed.rows.map((r) => [r.row, r]));
  const roleName = new Map(ctx.lookups.roles.map((r) => [r.id, pick(locale, r.nameEn, r.nameAr)]));
  const deptName = new Map(ctx.lookups.departments.map((d) => [d.id, pick(locale, d.nameEn, d.nameAr)]));
  const subjCode = new Map(ctx.lookups.subjects.map((s) => [s.id, s.code]));
  const rows: PreviewRow[] = records.map((rec) => {
    const v = (k: string) => rec.values[k] ?? "";
    const errors = parsed.errors.filter((e) => e.row === rec.row);
    const r = byRow.get(rec.row);
    const plan = r ? planRow(r, people.users.get(r.email), people.members.get(r.email), ctx) : null;
    if (plan?.error) errors.push({ row: rec.row, field: "email", code: plan.error });
    const [main, other] = locale === "ar" && v("name_ar") ? [v("name_ar"), v("name_en")] : [v("name_en"), v("name_ar")];
    return {
      row: rec.row,
      action: errors.length || !plan ? null : plan.action,
      changes: plan?.changes,
      errors,
      warnings: [],
      cells: [
        { text: main, sub: other || undefined },
        { text: v("email"), ltr: true },
        { chips: r ? r.roleIds.map((id) => roleName.get(id) ?? "") : v("roles") ? [v("roles")] : [] },
        { text: r?.departmentId ? deptName.get(r.departmentId) : v("department"), sub: pick(locale, v("job_title_en"), v("job_title_ar")) || undefined },
        { chips: r ? r.subjectIds.map((id) => subjCode.get(id) ?? "") : v("subjects") ? [v("subjects")] : [], sub: v("grades") || undefined, ltr: true },
      ],
    };
  });
  return finishPreview("staff", rows);
}

export type StaffImportOptions = { invite?: boolean; now?: Date };

/** Imports the valid rows and records the import. Returns counts, row errors and post-commit effects (invitation emails). */
export async function importStaff(actor: ImportActor, fileName: string, records: SheetRecord[], opts: StaffImportOptions = {}): Promise<ImportSummary & { effects: Effect[] }> {
  const now = opts.now ?? new Date();
  const { ctx, parsed, people } = await prepare(actor, records);
  const invite = !!opts.invite && importAccess(actor.perms).invite;
  const record = await startRecord(actor, "staff", fileName, records.length);
  const errors: RowIssue[] = [...parsed.errors];
  const failedRows = new Set(errors.map((e) => e.row));
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const done: Array<{ row: StaffRow; membershipId: string }> = [];

  for (const r of parsed.rows) {
    try {
      let user = people.users.get(r.email);
      const member = people.members.get(r.email);
      const plan = planRow(r, user, member, ctx);
      if (plan.error) {
        errors.push({ row: r.row, field: "email", code: plan.error });
        failedRows.add(r.row);
        continue;
      }
      if (!user) {
        const u = await identityDb.user.create({ data: { email: r.email, nameEn: r.nameEn, nameAr: r.nameAr } });
        user = { id: u.id, nameEn: u.nameEn, nameAr: u.nameAr, managedBySchool: true };
      } else if (plan.names && user.managedBySchool) {
        await identityDb.user.update({ where: { id: user.id }, data: plan.names });
      }
      const userId = user.id;
      const membershipId = await tenantTx(actor.orgId, async (tx) => {
        let id = member?.membershipId;
        if (!id) {
          // The unique (orgId, userId) index means a person is never added twice, even by two imports at once.
          const m = await tx.membership.create({ data: { orgId: actor.orgId, userId, status: "INVITED", titleEn: plan.profile.jobTitleEn ?? null, titleAr: plan.profile.jobTitleAr ?? null } });
          id = m.id;
        } else if (plan.profile.jobTitleEn !== undefined || plan.profile.jobTitleAr !== undefined) {
          await tx.membership.update({ where: { id }, data: { titleEn: plan.profile.jobTitleEn ?? null, titleAr: plan.profile.jobTitleAr ?? null } });
        }
        await tx.staffProfile.upsert({
          where: { membershipId: id },
          create: { orgId: actor.orgId, membershipId: id, departmentId: plan.profile.departmentId ?? null, jobTitleEn: plan.profile.jobTitleEn ?? null, jobTitleAr: plan.profile.jobTitleAr ?? null, gradeLevels: plan.profile.gradeLevels ?? [] },
          update: plan.profile,
        });
        if (plan.addRoleIds.length) await tx.membershipRole.createMany({ data: plan.addRoleIds.map((roleId) => ({ orgId: actor.orgId, membershipId: id!, roleId })), skipDuplicates: true });
        for (const q of plan.quals) {
          await tx.teacherSubject.upsert({
            where: { membershipId_subjectId: { membershipId: id, subjectId: q.subjectId } },
            create: { orgId: actor.orgId, membershipId: id, subjectId: q.subjectId, gradeLevels: q.grades },
            update: { gradeLevels: q.grades },
          });
        }
        if (plan.action !== "unchanged") {
          await audit(tx, actor.orgId, {
            actorId: actor.membershipId,
            actorUserId: actor.userId,
            action: "people.staff_import",
            entityType: "Membership",
            entityId: id,
            meta: { importId: record.id, created: !member, rolesAdded: plan.addRoleIds.map((x) => ctx.roleKeyById.get(x)), subjectsAdded: plan.quals.filter((q) => q.isNew).length, changes: plan.changes },
          });
        }
        return id;
      });
      counts[plan.action === "create" ? "created" : plan.action === "update" ? "updated" : "unchanged"]++;
      done.push({ row: r, membershipId });
    } catch {
      errors.push({ row: r.row, field: "row", code: "failed" });
      failedRows.add(r.row);
    }
  }

  // Invitations: people still waiting to join who have no open invitation yet. Re-importing never re-sends.
  const effects: Effect[] = [];
  const extra: Record<string, number> = { invited: 0, alreadyInvited: 0 };
  if (invite && done.length) {
    const db = tenantDb(actor.orgId);
    const invited = await db.membership.findMany({ where: { id: { in: done.map((d) => d.membershipId) }, status: "INVITED" }, select: { id: true } });
    const invitedIds = new Set(invited.map((m) => m.id));
    const open = await db.invitation.findMany({ where: { kind: "STAFF", email: { in: done.map((d) => d.row.email) }, revokedAt: null, uses: 0, expiresAt: { gt: now } }, select: { email: true } });
    const openEmails = new Set(open.map((o) => o.email));
    const toInvite = done.filter((d) => invitedIds.has(d.membershipId) && !openEmails.has(d.row.email));
    extra.alreadyInvited = done.filter((d) => invitedIds.has(d.membershipId) && openEmails.has(d.row.email)).length;
    for (let i = 0; i < toInvite.length; i += MAX_BULK) {
      const chunk = toInvite.slice(i, i + MAX_BULK);
      const res = await inviteStaff(
        { orgId: actor.orgId, membershipId: actor.membershipId, userId: actor.userId },
        chunk.map((d) => ({ nameEn: d.row.nameEn, email: d.row.email, roleKeys: d.row.roleKeys, department: d.row.departmentId })),
        { now },
      );
      extra.invited += res.created.length;
      effects.push(...res.effects);
      for (const p of res.problems) {
        const d = chunk[p.row - 1];
        if (d) errors.push({ row: d.row.row, field: "email", code: "inviteFailed" });
      }
    }
  }

  const summary = await finishRecord(actor, record.id, "people.import_staff", { total: records.length, failedRows, errors, counts, extra });
  return { ...summary, effects };
}
