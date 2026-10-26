// Planning and applying a roster: staged records (src/server/rostering/stage.ts) become staff, students, parents,
// classes and enrollments. The same code runs for the preview (nothing is written; counts, sample changes and
// problems are collected) and for the sync (written in batches, one transaction per batch). Work is cut into
// phases and batches with a cursor, so a run resumes after the last committed batch and never repeats a write:
// every record goes through RosterLink, which says what it became and the hash last applied.
//
// Conflict rules (also in docs/guides/classlink.md):
// - The feed wins for the fields it sends: English names, grade, staff number, class title, room, homeroom flag,
//   class teacher and the enrollments it created. Everything else is Horizon's: Arabic names, Emirates ID and
//   passport, medical notes, sections, curriculum, roles after creation, enrollments made in Horizon.
// - An unchanged record (same hash) is not touched. A changed one is updated only in the fields above.
// - A record already in Horizon is matched once (staff by email, students by student number, parents by email)
//   and linked; Horizon records the feed did not create are never removed by it.
// - A sign-in address never changes through the feed (that could hand an account to someone else): a changed
//   staff email is reported for an administrator to handle.
// - Duplicate emails or student numbers in the feed are reported and neither record is applied.
// - Grade codes without a mapping and staff roles without a Horizon role are reported, never guessed.
// - Removal means deactivation: students become inactive, staff are suspended (school administrators never),
//   parent links and enrollments the feed created are removed. A run that would remove more than the school's
//   limit stops for review (BLOCKED) and applies nothing of the removals until someone confirms.
import { Prisma } from "@prisma/client";
import { identityDb, tenantDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { gradeLevelFor, readOptions, removalBlocked, type RosterOptions } from "@/lib/rostering/options";
import { recordHash, relationshipLabel, type RClass, type RCourse, type RDemographic, type REnrollment, type RSession, type RUser } from "@/lib/rostering/records";
import { matchByName } from "@/lib/imports/staff";

export const PHASES = ["staff", "students", "guardians", "classes", "enrollments", "removals", "done"] as const;
export type Phase = (typeof PHASES)[number];
export type PlanKind = "staff" | "students" | "guardians" | "classes" | "enrollments";
export const PLAN_KINDS: PlanKind[] = ["staff", "students", "guardians", "classes", "enrollments"];

export type KindCounts = { create: number; update: number; unchanged: number; remove: number; skipped: number };
export type Counts = Record<PlanKind, KindCounts> & { removalBlocked?: PlanKind[]; total?: number };
export type Issue = { kind: PlanKind; code: string; ext: string; label: string; detail?: string };
export type Change = { kind: PlanKind; action: "create" | "update" | "remove"; ext: string; label: string; fields?: string[] };
export type PlanCursor = { phase: Phase; after: string | null };

export const emptyCounts = (): Counts => Object.fromEntries(PLAN_KINDS.map((k) => [k, { create: 0, update: 0, unchanged: 0, remove: 0, skipped: 0 }])) as unknown as Counts;

export const MAX_ISSUES = 300;
export const MAX_CHANGES = 300;
const USER_BATCH = 200;
const ENROLL_BATCH = 500;

const STAFF_ROLES = ["teacher", "aide", "administrator", "principal", "counselor", "proctor", "staff"];
const FAMILY_ROLES = ["parent", "guardian", "relative"];
const ROLE_SET: Record<"staff" | "students" | "guardians", string[]> = { staff: STAFF_ROLES, students: ["student"], guardians: FAMILY_ROLES };
const LINK_KIND: Record<PlanKind, string> = { staff: "staff", students: "student", guardians: "guardian", classes: "class", enrollments: "enrollment" };

export type PlanSetup = {
  orgId: string;
  runId: string;
  /** RosterLink namespace: classlink, clever or oneroster. */
  provider: string;
  mode: "FULL" | "DELTA";
  apply: boolean;
  allowMassDelete: boolean;
  options: unknown;
  /** Feed school ids to import (empty: all). */
  schoolIds: string[];
  now?: Date;
};

export type PlanState = { counts: Counts; issues: Issue[]; changes: Change[]; cursor: PlanCursor; blocked: boolean };

type Ctx = PlanSetup & {
  opts: RosterOptions;
  now: Date;
  yearId: string | null;
  yearStart: Date | null;
  campusId: string | null;
  curriculum: string | null;
  roles: Map<string, string>;
  subjects: Array<{ id: string; code: string; nameEn: string; nameAr: string }>;
  courses: Map<string, RCourse>;
  sessions: Map<string, RSession>;
  demographics: Map<string, RDemographic>;
  dupEmails: Set<string>;
  dupNumbers: Set<string>;
  /** Preview only: what would exist after earlier phases (feed id to local id, or "new"). */
  planned: { staff: Map<string, string>; students: Map<string, string>; classes: Map<string, string> };
  state: PlanState;
};

const label = (u: RUser) => [u.givenName, u.familyName].filter(Boolean).join(" ") || u.id;

function issue(ctx: Ctx, i: Issue) {
  if (ctx.state.issues.length < MAX_ISSUES) ctx.state.issues.push(i);
}
function change(ctx: Ctx, c: Change) {
  ctx.state.counts[c.kind][c.action] += 1;
  if (ctx.state.changes.length < MAX_CHANGES) ctx.state.changes.push(c);
}

async function loadContext(setup: PlanSetup, state: PlanState): Promise<Ctx> {
  const db = tenantDb(setup.orgId);
  const [year, campus, org, roles, subjects, aux] = await Promise.all([
    db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, startsOn: true } }),
    db.campus.findFirst({ where: { isMain: true }, select: { id: true } }),
    db.organization.findUnique({ where: { id: setup.orgId }, select: { curricula: true } }),
    db.role.findMany({ select: { id: true, key: true } }),
    db.subject.findMany({ select: { id: true, code: true, nameEn: true, nameAr: true } }),
    db.rosterRecord.findMany({ where: { runId: setup.runId, kind: { in: ["course", "session", "demographic"] } }, select: { kind: true, externalId: true, data: true } }),
  ]);
  const courses = new Map<string, RCourse>();
  const sessions = new Map<string, RSession>();
  const demographics = new Map<string, RDemographic>();
  for (const r of aux) {
    if (r.kind === "course") courses.set(r.externalId, r.data as unknown as RCourse);
    else if (r.kind === "session") sessions.set(r.externalId, r.data as unknown as RSession);
    else demographics.set(r.externalId, r.data as unknown as RDemographic);
  }
  // Duplicates across the whole feed: same email for two active people, or the same student number.
  // Raw SQL must run inside tenantTx: only that sets the organization for row-level security.
  const dups = await tenantTx(setup.orgId, (tx) => tx.$queryRaw<Array<{ k: string; v: string }>>`
    SELECT 'email' AS k, lower(data->>'email') AS v FROM "RosterRecord"
      WHERE "runId" = ${setup.runId} AND kind = 'user' AND data->>'status' = 'active' AND coalesce(data->>'email', '') <> ''
      GROUP BY lower(data->>'email') HAVING count(*) > 1
    UNION ALL
    SELECT 'number' AS k, upper(data->>'identifier') AS v FROM "RosterRecord"
      WHERE "runId" = ${setup.runId} AND kind = 'user' AND data->>'role' = 'student' AND data->>'status' = 'active' AND coalesce(data->>'identifier', '') <> ''
      GROUP BY upper(data->>'identifier') HAVING count(*) > 1`);
  return {
    ...setup,
    opts: readOptions(setup.options),
    now: setup.now ?? new Date(),
    yearId: year?.id ?? null,
    yearStart: year?.startsOn ?? null,
    campusId: campus?.id ?? null,
    curriculum: org?.curricula?.[0] ?? null,
    roles: new Map(roles.map((r) => [r.key, r.id])),
    subjects,
    courses,
    sessions,
    demographics,
    dupEmails: new Set(dups.filter((d) => d.k === "email").map((d) => d.v)),
    dupNumbers: new Set(dups.filter((d) => d.k === "number").map((d) => d.v)),
    planned: { staff: new Map(), students: new Map(), classes: new Map() },
    state,
  };
}

const inSchools = (ctx: Ctx, orgIds: Array<string | null>) => ctx.schoolIds.length === 0 || orgIds.some((o) => !!o && ctx.schoolIds.includes(o));

async function linksFor(tx: TenantTx | ReturnType<typeof tenantDb>, ctx: Ctx, kind: string, exts: string[]) {
  if (!exts.length) return new Map<string, { id: string; localId: string; hash: string; deactivatedAt: Date | null }>();
  const rows = await tx.rosterLink.findMany({ where: { orgId: ctx.orgId, provider: ctx.provider, kind, externalId: { in: exts } }, select: { id: true, externalId: true, localId: true, hash: true, deactivatedAt: true } });
  return new Map(rows.map((r) => [r.externalId, r]));
}

async function saveLink(tx: TenantTx, ctx: Ctx, kind: string, ext: string, localId: string, hash: string, existing?: { id: string } | null) {
  if (existing) await tx.rosterLink.update({ where: { id: existing.id }, data: { localId, hash, lastSeenRunId: ctx.runId, deactivatedAt: null } });
  else await tx.rosterLink.create({ data: { orgId: ctx.orgId, provider: ctx.provider, kind, externalId: ext, localId, hash, lastSeenRunId: ctx.runId } });
}

async function batchOf(ctx: Ctx, kind: "user" | "class" | "enrollment", roles: string[] | null, after: string | null, take: number) {
  return tenantDb(ctx.orgId).rosterRecord.findMany({
    where: { runId: ctx.runId, kind, externalId: { gt: after ?? "" }, ...(roles ? { OR: roles.map((r) => ({ data: { path: ["role"], equals: r } })) } : {}) },
    orderBy: { externalId: "asc" },
    take,
    select: { externalId: true, data: true, hash: true },
  });
}

/** One batch in one transaction (a preview only reads, so its transaction writes nothing). */
async function work<T>(ctx: Ctx, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return tenantTx(ctx.orgId, fn, { timeout: 120_000, maxWait: 10_000 });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

async function planStaff(ctx: Ctx, batch: Array<{ externalId: string; data: unknown; hash: string }>) {
  await work(ctx, async (tx) => {
    const users = batch.map((b) => b.data as RUser);
    const links = await linksFor(tx, ctx, "staff", users.map((u) => u.id));
    const emails = users.map((u) => u.email).filter((e): e is string => !!e);
    const accounts = emails.length ? await identityDb.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } }) : [];
    const accountBy = new Map(accounts.map((a) => [a.email, a.id]));
    const members = accounts.length
      ? await tx.membership.findMany({ where: { userId: { in: accounts.map((a) => a.id) } }, select: { id: true, userId: true, status: true, student: { select: { id: true } }, guardian: { select: { id: true } }, roles: { select: { role: { select: { key: true } } } } } })
      : [];
    const memberByUser = new Map(members.map((m) => [m.userId, m]));
    const linkedMembers = await tx.membership.findMany({ where: { id: { in: [...links.values()].map((l) => l.localId) } }, select: { id: true, status: true, user: { select: { email: true } }, roles: { select: { role: { select: { key: true } } } } } });
    const linkedBy = new Map(linkedMembers.map((m) => [m.id, m]));

    for (const rec of batch) {
      const u = rec.data as RUser;
      const link = links.get(u.id);
      const name = label(u);
      if (!ctx.opts.importStaff || !inSchools(ctx, u.orgIds)) continue;
      if (u.status === "tobedeleted" || !u.enabled) {
        if (link && !link.deactivatedAt) await removeStaff(tx, ctx, u.id, name, link);
        continue;
      }
      if (u.email && ctx.dupEmails.has(u.email)) {
        issue(ctx, { kind: "staff", code: "DUPLICATE_EMAIL", ext: u.id, label: name });
        ctx.state.counts.staff.skipped++;
        continue;
      }
      if (link && !link.deactivatedAt && link.hash === rec.hash && linkedBy.has(link.localId)) {
        ctx.state.counts.staff.unchanged++;
        ctx.planned.staff.set(u.id, link.localId);
        continue;
      }
      const roleKey = u.role ? (ctx.opts.roleMap as Record<string, string | null>)[u.role] ?? null : null;
      if (!u.email) {
        issue(ctx, { kind: "staff", code: "NO_EMAIL", ext: u.id, label: name });
        ctx.state.counts.staff.skipped++;
        continue;
      }
      const linked = link ? linkedBy.get(link.localId) : undefined;
      if (linked) {
        const fields: string[] = [];
        if (linked.user.email.toLowerCase() !== u.email) issue(ctx, { kind: "staff", code: "EMAIL_CHANGED", ext: u.id, label: name });
        if (link?.deactivatedAt && linked.status === "SUSPENDED") fields.push("status");
        fields.push("staffNumber");
        if (ctx.apply) {
          if (link?.deactivatedAt && linked.status === "SUSPENDED") await tx.membership.update({ where: { id: linked.id }, data: { status: "ACTIVE" } });
          await tx.staffProfile.upsert({ where: { membershipId: linked.id }, create: { orgId: ctx.orgId, membershipId: linked.id, employeeNo: u.identifier }, update: { employeeNo: u.identifier } });
          await saveLink(tx, ctx, "staff", u.id, linked.id, rec.hash, link);
        }
        ctx.planned.staff.set(u.id, linked.id);
        change(ctx, { kind: "staff", action: "update", ext: u.id, label: name, fields });
        continue;
      }
      const accountId = accountBy.get(u.email) ?? null;
      const existing = accountId ? memberByUser.get(accountId) : undefined;
      if (existing) {
        const keys = existing.roles.map((r) => r.role.key);
        if (existing.student || existing.guardian || keys.includes("parent") || keys.includes("student")) {
          issue(ctx, { kind: "staff", code: "FAMILY_ACCOUNT", ext: u.id, label: name });
          ctx.state.counts.staff.skipped++;
          continue;
        }
        if (ctx.apply) {
          await tx.staffProfile.upsert({ where: { membershipId: existing.id }, create: { orgId: ctx.orgId, membershipId: existing.id, employeeNo: u.identifier }, update: { employeeNo: u.identifier } });
          await saveLink(tx, ctx, "staff", u.id, existing.id, rec.hash, null);
        }
        ctx.planned.staff.set(u.id, existing.id);
        change(ctx, { kind: "staff", action: "update", ext: u.id, label: name, fields: ["linked"] });
        continue;
      }
      if (!roleKey || !ctx.roles.has(roleKey)) {
        issue(ctx, { kind: "staff", code: "ROLE_NOT_MAPPED", ext: u.id, label: name, detail: u.role ?? "" });
        ctx.state.counts.staff.skipped++;
        continue;
      }
      let membershipId = "new";
      if (ctx.apply) {
        const userId = accountId ?? (await identityDb.user.create({ data: { email: u.email, nameEn: name.slice(0, 120) } })).id;
        const m = await tx.membership.create({ data: { orgId: ctx.orgId, userId, status: "INVITED" } });
        await tx.staffProfile.create({ data: { orgId: ctx.orgId, membershipId: m.id, employeeNo: u.identifier } });
        await tx.membershipRole.create({ data: { orgId: ctx.orgId, membershipId: m.id, roleId: ctx.roles.get(roleKey)! } });
        await saveLink(tx, ctx, "staff", u.id, m.id, rec.hash, link ?? null);
        membershipId = m.id;
      }
      ctx.planned.staff.set(u.id, membershipId);
      change(ctx, { kind: "staff", action: "create", ext: u.id, label: name, fields: [roleKey] });
    }
  });
}

async function removeStaff(tx: TenantTx, ctx: Ctx, ext: string, name: string, link: { id: string; localId: string }) {
  const m = await tx.membership.findUnique({ where: { id: link.localId }, select: { id: true, status: true, roles: { select: { role: { select: { key: true } } } } } });
  if (!m) return;
  if (m.roles.some((r) => r.role.key === "school_admin")) {
    issue(ctx, { kind: "staff", code: "ADMIN_KEPT", ext, label: name });
    ctx.state.counts.staff.skipped++;
    return;
  }
  if (ctx.apply) {
    if (m.status !== "SUSPENDED") await tx.membership.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
    await tx.rosterLink.update({ where: { id: link.id }, data: { deactivatedAt: ctx.now, lastSeenRunId: ctx.runId } });
  }
  change(ctx, { kind: "staff", action: "remove", ext, label: name });
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

function studentHash(ctx: Ctx, u: RUser, hash: string) {
  const d = ctx.opts.importDemographics ? ctx.demographics.get(u.id) : undefined;
  return d ? recordHash({ ...u, id: `${hash}:${d.birthDate ?? ""}:${d.sex ?? ""}` }) : hash;
}

async function planStudents(ctx: Ctx, batch: Array<{ externalId: string; data: unknown; hash: string }>) {
  await work(ctx, async (tx) => {
    const users = batch.map((b) => b.data as RUser);
    const links = await linksFor(tx, ctx, "student", users.map((u) => u.id));
    const numbers = users.map((u) => (u.identifier ?? u.id).slice(0, 40));
    const byNumber = new Map((await tx.student.findMany({ where: { studentNo: { in: numbers } }, select: { id: true, studentNo: true } })).map((s) => [s.studentNo, s.id]));
    const linkedStudents = new Map((await tx.student.findMany({ where: { id: { in: [...links.values()].map((l) => l.localId) } }, select: { id: true, status: true, firstNameEn: true, lastNameEn: true, gradeLevel: true, dateOfBirth: true, gender: true } })).map((s) => [s.id, s]));

    for (const rec of batch) {
      const u = rec.data as RUser;
      const link = links.get(u.id);
      const name = label(u);
      if (!ctx.opts.importStudents || !inSchools(ctx, u.orgIds)) continue;
      if (u.status === "tobedeleted" || !u.enabled) {
        if (link && !link.deactivatedAt) {
          if (ctx.apply) {
            await tx.student.updateMany({ where: { id: link.localId, status: "ACTIVE" }, data: { status: "INACTIVE" } });
            await tx.rosterLink.update({ where: { id: link.id }, data: { deactivatedAt: ctx.now, lastSeenRunId: ctx.runId } });
          }
          change(ctx, { kind: "students", action: "remove", ext: u.id, label: name });
        }
        continue;
      }
      const number = (u.identifier ?? u.id).slice(0, 40);
      if (ctx.dupNumbers.has(number.toUpperCase())) {
        issue(ctx, { kind: "students", code: "DUPLICATE_NUMBER", ext: u.id, label: name, detail: number });
        ctx.state.counts.students.skipped++;
        continue;
      }
      const hash = studentHash(ctx, u, rec.hash);
      const current = link ? linkedStudents.get(link.localId) : undefined;
      if (link && current && !link.deactivatedAt && link.hash === hash) {
        ctx.state.counts.students.unchanged++;
        ctx.planned.students.set(u.id, link.localId);
        continue;
      }
      const code = u.grades[0] ?? null;
      const level = gradeLevelFor(code, ctx.opts.gradeMap);
      if (level === null) {
        issue(ctx, { kind: "students", code: "UNKNOWN_GRADE", ext: u.id, label: name, detail: code ?? "" });
        ctx.state.counts.students.skipped++;
        continue;
      }
      const demo = ctx.opts.importDemographics ? ctx.demographics.get(u.id) : undefined;
      const fields: Prisma.StudentUncheckedUpdateInput = { firstNameEn: u.givenName || number, lastNameEn: u.familyName, gradeLevel: level, status: "ACTIVE" };
      if (demo?.birthDate) fields.dateOfBirth = new Date(`${demo.birthDate}T00:00:00Z`);
      if (demo?.sex) fields.gender = demo.sex;
      const targetId = current?.id ?? byNumber.get(number) ?? null;
      if (targetId) {
        const prev = current ?? (await tx.student.findUnique({ where: { id: targetId }, select: { firstNameEn: true, lastNameEn: true, gradeLevel: true, status: true } }));
        const changed = prev ? (["firstNameEn", "lastNameEn", "gradeLevel", "status"] as const).filter((k) => String((prev as Record<string, unknown>)[k]) !== String((fields as Record<string, unknown>)[k])) : [];
        if (demo?.birthDate) changed.push("dateOfBirth" as never);
        if (ctx.apply) {
          await tx.student.update({ where: { id: targetId }, data: fields });
          await saveLink(tx, ctx, "student", u.id, targetId, hash, link ?? null);
        }
        ctx.planned.students.set(u.id, targetId);
        change(ctx, { kind: "students", action: "update", ext: u.id, label: name, fields: link ? changed : ["linked", ...changed] });
        continue;
      }
      let id = "new";
      if (ctx.apply) {
        const s = await tx.student.create({
          data: {
            orgId: ctx.orgId,
            studentNo: number,
            firstNameEn: u.givenName || number,
            lastNameEn: u.familyName,
            firstNameAr: "",
            lastNameAr: "",
            gradeLevel: level,
            status: "ACTIVE",
            enrolledOn: ctx.now,
            campusId: ctx.campusId,
            ...(ctx.curriculum ? { curriculum: ctx.curriculum as never } : {}),
            ...(demo?.birthDate ? { dateOfBirth: new Date(`${demo.birthDate}T00:00:00Z`) } : {}),
            ...(demo?.sex ? { gender: demo.sex } : {}),
          },
          select: { id: true },
        });
        await saveLink(tx, ctx, "student", u.id, s.id, hash, link ?? null);
        id = s.id;
      }
      ctx.planned.students.set(u.id, id);
      change(ctx, { kind: "students", action: "create", ext: u.id, label: name, fields: [code ?? ""] });
    }
  });
}

// ---------------------------------------------------------------------------
// Parents and guardians
// ---------------------------------------------------------------------------

async function planGuardians(ctx: Ctx, batch: Array<{ externalId: string; data: unknown; hash: string }>) {
  await work(ctx, async (tx) => {
    const users = batch.map((b) => b.data as RUser);
    const exts = users.map((u) => u.id);
    const links = await linksFor(tx, ctx, "guardian", exts);
    const emails = users.map((u) => u.email).filter((e): e is string => !!e);
    const byEmail = new Map<string, string>();
    if (emails.length) {
      for (const g of await tx.guardian.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { id: true, email: true }, orderBy: { createdAt: "asc" } })) {
        const k = g.email!.toLowerCase();
        if (!byEmail.has(k)) byEmail.set(k, g.id);
      }
    }
    // Children named on the student side of the feed (students list their parents as agents).
    const reverse = await tx.$queryRaw<Array<{ ext: string; agents: string[] }>>`
      SELECT "externalId" AS ext, ARRAY(SELECT jsonb_array_elements_text(data->'agentIds')) AS agents FROM "RosterRecord"
      WHERE "runId" = ${ctx.runId} AND kind = 'user' AND data->>'role' = 'student' AND data->'agentIds' ?| ${exts}::text[]`;
    const childrenOf = new Map<string, Set<string>>();
    for (const r of reverse) for (const a of r.agents) if (exts.includes(a)) (childrenOf.get(a) ?? childrenOf.set(a, new Set()).get(a)!).add(r.ext);
    const studentExts = [...new Set([...users.flatMap((u) => u.agentIds), ...reverse.map((r) => r.ext)])];
    const studentLinks = await linksFor(tx, ctx, "student", studentExts);
    const pairLinks = await tx.rosterLink.findMany({ where: { orgId: ctx.orgId, provider: ctx.provider, kind: "guardianLink", OR: exts.map((e) => ({ externalId: { startsWith: `${e}:` } })) }, select: { id: true, externalId: true, localId: true, deactivatedAt: true } });

    for (const rec of batch) {
      const u = rec.data as RUser;
      const link = links.get(u.id);
      const name = label(u);
      if (!ctx.opts.importGuardians || (u.orgIds.length && !inSchools(ctx, u.orgIds))) continue;
      const mine = pairLinks.filter((p) => p.externalId.startsWith(`${u.id}:`) && !p.deactivatedAt);
      if (u.status === "tobedeleted" || !u.enabled) {
        if (link && !link.deactivatedAt) {
          if (ctx.apply) {
            await tx.guardianLink.deleteMany({ where: { id: { in: mine.map((p) => p.localId) } } });
            await tx.rosterLink.updateMany({ where: { id: { in: [link.id, ...mine.map((p) => p.id)] } }, data: { deactivatedAt: ctx.now, lastSeenRunId: ctx.runId } });
          }
          change(ctx, { kind: "guardians", action: "remove", ext: u.id, label: name });
        }
        continue;
      }
      // Children: from either side of the feed, limited to students this sync knows.
      const kids = [...new Set([...u.agentIds, ...(childrenOf.get(u.id) ?? [])])].filter((s) => studentLinks.has(s) || ctx.planned.students.has(s));
      if (!kids.length) {
        issue(ctx, { kind: "guardians", code: "NO_CHILDREN", ext: u.id, label: name });
        ctx.state.counts.guardians.skipped++;
        continue;
      }
      if (u.email && ctx.dupEmails.has(u.email)) {
        issue(ctx, { kind: "guardians", code: "DUPLICATE_EMAIL", ext: u.id, label: name });
        ctx.state.counts.guardians.skipped++;
        continue;
      }
      const unchanged = link && !link.deactivatedAt && link.hash === rec.hash;
      let guardianId: string | null = link && !link.deactivatedAt ? link.localId : (u.email ? byEmail.get(u.email) ?? null : null);
      if (guardianId && ctx.apply && !(await tx.guardian.findUnique({ where: { id: guardianId }, select: { id: true } }))) guardianId = null;
      let action: "create" | "update" | null = unchanged ? null : guardianId ? "update" : "create";
      if (ctx.apply) {
        if (!guardianId) {
          guardianId = (await tx.guardian.create({ data: { orgId: ctx.orgId, firstNameEn: u.givenName, lastNameEn: u.familyName, firstNameAr: "", lastNameAr: "", email: u.email, phone: u.phone } })).id;
        } else if (!unchanged) {
          await tx.guardian.update({ where: { id: guardianId }, data: { firstNameEn: u.givenName, lastNameEn: u.familyName, ...(u.phone ? { phone: u.phone } : {}) } });
        }
        await saveLink(tx, ctx, "guardian", u.id, guardianId, rec.hash, link ?? null);
      }
      // Links to children, created once; in a full sync, links the feed made earlier and no longer lists go.
      let linksChanged = 0;
      for (const s of kids) {
        const pairExt = `${u.id}:${s}`;
        if (mine.some((p) => p.externalId === pairExt)) continue;
        linksChanged++;
        if (!ctx.apply) continue;
        const studentId = studentLinks.get(s)?.localId;
        if (!studentId || !guardianId) continue;
        const rel = relationshipLabel(u.relationships?.[s], u.role);
        const gl = await tx.guardianLink.upsert({
          where: { guardianId_studentId: { guardianId, studentId } },
          create: { orgId: ctx.orgId, guardianId, studentId, relationshipEn: rel.en, relationshipAr: rel.ar, isPrimary: false, canApprove: true, receivesUpdates: true },
          update: {},
          select: { id: true },
        });
        const existingPair = pairLinks.find((p) => p.externalId === pairExt);
        await saveLink(tx, ctx, "guardianLink", pairExt, gl.id, "", existingPair ?? null);
      }
      if (ctx.mode === "FULL") {
        const stale = mine.filter((p) => !kids.includes(p.externalId.slice(u.id.length + 1)));
        if (stale.length) {
          linksChanged += stale.length;
          if (ctx.apply) {
            await tx.guardianLink.deleteMany({ where: { id: { in: stale.map((p) => p.localId) } } });
            await tx.rosterLink.updateMany({ where: { id: { in: stale.map((p) => p.id) } }, data: { deactivatedAt: ctx.now } });
          }
        }
      }
      if (!action && linksChanged) action = "update";
      if (action) change(ctx, { kind: "guardians", action, ext: u.id, label: name, fields: linksChanged ? ["children"] : [] });
      else ctx.state.counts.guardians.unchanged++;
    }
  });
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

function subjectFor(ctx: Ctx, c: RClass) {
  const course = c.courseId ? ctx.courses.get(c.courseId) : undefined;
  const candidates = [course?.courseCode, ...c.subjectCodes, ...(course?.subjectCodes ?? []), ...c.subjects, ...(course?.subjects ?? []), course?.title, c.title].filter((x): x is string => !!x);
  for (const v of candidates) {
    const s = matchByName(ctx.subjects, v, (x) => x.code);
    if (s) return s.id;
  }
  return null;
}

function pastTerm(ctx: Ctx, c: RClass) {
  if (!ctx.yearStart || !c.termIds.length) return false;
  const known = c.termIds.map((t) => ctx.sessions.get(t)).filter((s): s is RSession => !!s?.endDate);
  return known.length > 0 && known.every((s) => new Date(`${s.endDate}T23:59:59Z`) < ctx.yearStart!);
}

async function planClasses(ctx: Ctx, batch: Array<{ externalId: string; data: unknown; hash: string }>) {
  await work(ctx, async (tx) => {
    const classes = batch.map((b) => b.data as RClass);
    const links = await linksFor(tx, ctx, "class", classes.map((c) => c.id));
    const existing = new Map((await tx.schoolClass.findMany({ where: { id: { in: [...links.values()].map((l) => l.localId) } }, select: { id: true, academicYearId: true, nameEn: true, gradeLevel: true, isHomeroom: true, room: true, subjectId: true } })).map((c) => [c.id, c]));
    for (const rec of batch) {
      const c = rec.data as RClass;
      const link = links.get(c.id);
      if (!ctx.opts.importClasses || !inSchools(ctx, [c.orgId])) continue;
      const current = link ? existing.get(link.localId) : undefined;
      if (c.status === "tobedeleted") {
        if (link && !link.deactivatedAt) await removeClass(tx, ctx, c.id, c.title, link);
        continue;
      }
      if (link && current && !link.deactivatedAt && link.hash === rec.hash && current.academicYearId === ctx.yearId) {
        ctx.state.counts.classes.unchanged++;
        ctx.planned.classes.set(c.id, link.localId);
        continue;
      }
      if (pastTerm(ctx, c)) {
        issue(ctx, { kind: "classes", code: "PAST_TERM", ext: c.id, label: c.title });
        ctx.state.counts.classes.skipped++;
        continue;
      }
      const levels = c.grades.map((g) => gradeLevelFor(g, ctx.opts.gradeMap));
      const level = levels.find((l): l is number => l !== null) ?? null;
      if (level === null) {
        issue(ctx, { kind: "classes", code: "UNKNOWN_GRADE", ext: c.id, label: c.title, detail: c.grades.join(", ") });
        ctx.state.counts.classes.skipped++;
        continue;
      }
      const subjectId = c.homeroom ? null : subjectFor(ctx, c);
      if (!c.homeroom && !subjectId) issue(ctx, { kind: "classes", code: "SUBJECT_NOT_MATCHED", ext: c.id, label: c.title, detail: c.subjects[0] ?? "" });
      const data = { nameEn: c.title.slice(0, 120), gradeLevel: level, isHomeroom: c.homeroom, room: c.location, ...(subjectId ? { subjectId } : {}) };
      if (current && current.academicYearId === ctx.yearId) {
        const fields = (["nameEn", "gradeLevel", "isHomeroom", "room", "subjectId"] as const).filter((k) => k in data && String((current as Record<string, unknown>)[k] ?? "") !== String((data as Record<string, unknown>)[k] ?? ""));
        if (ctx.apply) {
          await tx.schoolClass.update({ where: { id: current.id }, data });
          await saveLink(tx, ctx, "class", c.id, current.id, rec.hash, link ?? null);
        }
        ctx.planned.classes.set(c.id, current.id);
        change(ctx, { kind: "classes", action: "update", ext: c.id, label: c.title, fields });
        continue;
      }
      if (!ctx.yearId) {
        issue(ctx, { kind: "classes", code: "NO_YEAR", ext: c.id, label: c.title });
        ctx.state.counts.classes.skipped++;
        continue;
      }
      let id = "new";
      if (ctx.apply) {
        const created = await tx.schoolClass.create({ data: { orgId: ctx.orgId, academicYearId: ctx.yearId, campusId: ctx.campusId, nameAr: c.title.slice(0, 120), ...data }, select: { id: true } });
        await saveLink(tx, ctx, "class", c.id, created.id, rec.hash, link ?? null);
        id = created.id;
      }
      ctx.planned.classes.set(c.id, id);
      change(ctx, { kind: "classes", action: "create", ext: c.id, label: c.title });
    }
  });
}

async function removeClass(tx: TenantTx, ctx: Ctx, ext: string, title: string, link: { id: string; localId: string }) {
  if (ctx.apply) {
    // The class stays (grades and attendance may hang off it); the enrollments and teacher the feed set go.
    const inClass = await tx.enrollment.findMany({ where: { classId: link.localId }, select: { id: true } });
    const fed = await tx.rosterLink.findMany({
      where: { orgId: ctx.orgId, provider: ctx.provider, kind: "enrollment", deactivatedAt: null, OR: [{ localId: { in: inClass.map((e) => e.id) } }, { localId: { startsWith: `teacher:${link.localId}:` } }] },
      select: { id: true, localId: true },
    });
    const enrollmentIds = fed.filter((f) => !f.localId.startsWith("teacher:")).map((f) => f.localId);
    if (enrollmentIds.length) await tx.enrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
    for (const f of fed.filter((x) => x.localId.startsWith("teacher:"))) {
      const [, classId, membershipId] = f.localId.split(":");
      await tx.schoolClass.updateMany({ where: { id: classId, teacherMembershipId: membershipId }, data: { teacherMembershipId: null } });
    }
    if (fed.length) await tx.rosterLink.updateMany({ where: { id: { in: fed.map((f) => f.id) } }, data: { deactivatedAt: ctx.now } });
    await tx.rosterLink.update({ where: { id: link.id }, data: { deactivatedAt: ctx.now, lastSeenRunId: ctx.runId } });
  }
  change(ctx, { kind: "classes", action: "remove", ext, label: title });
}

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

async function planEnrollments(ctx: Ctx, batch: Array<{ externalId: string; data: unknown; hash: string }>) {
  await work(ctx, async (tx) => {
    const rows = batch.map((b) => b.data as REnrollment);
    const links = await linksFor(tx, ctx, "enrollment", rows.map((e) => e.id));
    const studentLinks = await linksFor(tx, ctx, "student", rows.filter((e) => e.role === "student").map((e) => e.userId));
    const staffLinks = await linksFor(tx, ctx, "staff", rows.filter((e) => e.role !== "student").map((e) => e.userId));
    const classLinks = await linksFor(tx, ctx, "class", rows.map((e) => e.classId));
    const classIds = [...classLinks.values()].map((l) => l.localId);
    const teachers = new Map((await tx.schoolClass.findMany({ where: { id: { in: classIds } }, select: { id: true, teacherMembershipId: true } })).map((c) => [c.id, c.teacherMembershipId]));
    const label = (e: REnrollment) => `${e.userId} / ${e.classId}`;
    for (const rec of batch) {
      const e = rec.data as REnrollment;
      if (!ctx.opts.importClasses) continue;
      const link = links.get(e.id);
      const teacherRole = e.role === "teacher" || e.role === "aide";
      if (e.role !== "student" && !teacherRole) continue;
      if (e.status === "tobedeleted") {
        if (link && !link.deactivatedAt) {
          if (ctx.apply) {
            if (link.localId.startsWith("teacher:")) {
              const [, classId, membershipId] = link.localId.split(":");
              await tx.schoolClass.updateMany({ where: { id: classId, teacherMembershipId: membershipId }, data: { teacherMembershipId: null } });
            } else await tx.enrollment.deleteMany({ where: { id: link.localId } });
            await tx.rosterLink.update({ where: { id: link.id }, data: { deactivatedAt: ctx.now, lastSeenRunId: ctx.runId } });
          }
          change(ctx, { kind: "enrollments", action: "remove", ext: e.id, label: label(e) });
        }
        continue;
      }
      if (link && !link.deactivatedAt && link.hash === rec.hash) {
        ctx.state.counts.enrollments.unchanged++;
        continue;
      }
      const classId = classLinks.get(e.classId)?.localId ?? ctx.planned.classes.get(e.classId) ?? null;
      if (!classId) {
        issue(ctx, { kind: "enrollments", code: "UNKNOWN_CLASS", ext: e.id, label: label(e) });
        ctx.state.counts.enrollments.skipped++;
        continue;
      }
      if (teacherRole) {
        const membershipId = staffLinks.get(e.userId)?.localId ?? ctx.planned.staff.get(e.userId) ?? null;
        if (!membershipId) {
          issue(ctx, { kind: "enrollments", code: "UNKNOWN_TEACHER", ext: e.id, label: label(e) });
          ctx.state.counts.enrollments.skipped++;
          continue;
        }
        const current = teachers.get(classId) ?? null;
        if (!e.primary && current && current !== membershipId) {
          ctx.state.counts.enrollments.unchanged++;
          continue;
        }
        if (ctx.apply && classId !== "new" && membershipId !== "new") {
          await tx.schoolClass.update({ where: { id: classId }, data: { teacherMembershipId: membershipId } });
          teachers.set(classId, membershipId);
          await saveLink(tx, ctx, "enrollment", e.id, `teacher:${classId}:${membershipId}`, rec.hash, link ?? null);
        }
        change(ctx, { kind: "enrollments", action: current === membershipId ? "update" : "create", ext: e.id, label: label(e), fields: ["teacher"] });
        continue;
      }
      const studentId = studentLinks.get(e.userId)?.localId ?? ctx.planned.students.get(e.userId) ?? null;
      if (!studentId) {
        issue(ctx, { kind: "enrollments", code: "UNKNOWN_STUDENT", ext: e.id, label: label(e) });
        ctx.state.counts.enrollments.skipped++;
        continue;
      }
      if (ctx.apply && classId !== "new" && studentId !== "new") {
        const en = await tx.enrollment.upsert({ where: { studentId_classId: { studentId, classId } }, create: { orgId: ctx.orgId, studentId, classId, status: "ACTIVE" }, update: { status: "ACTIVE" }, select: { id: true } });
        await saveLink(tx, ctx, "enrollment", e.id, en.id, rec.hash, link ?? null);
      }
      change(ctx, { kind: "enrollments", action: link ? "update" : "create", ext: e.id, label: label(e) });
    }
  });
}

// ---------------------------------------------------------------------------
// Removals (full syncs only): what the feed created and no longer lists
// ---------------------------------------------------------------------------

const REMOVAL_KINDS: Array<{ kind: PlanKind; link: string; staged: string; enabled: (o: RosterOptions) => boolean }> = [
  { kind: "staff", link: "staff", staged: "user", enabled: (o) => o.importStaff },
  { kind: "students", link: "student", staged: "user", enabled: (o) => o.importStudents },
  { kind: "guardians", link: "guardian", staged: "user", enabled: (o) => o.importGuardians },
  { kind: "classes", link: "class", staged: "class", enabled: (o) => o.importClasses },
  { kind: "enrollments", link: "enrollment", staged: "enrollment", enabled: (o) => o.importClasses },
];

async function missingLinks(ctx: Ctx, link: string, staged: string) {
  return tenantTx(ctx.orgId, (tx) => tx.$queryRaw<Array<{ id: string; externalId: string; localId: string }>>`
    SELECT l.id, l."externalId", l."localId" FROM "RosterLink" l
    WHERE l."orgId" = ${ctx.orgId} AND l.provider = ${ctx.provider} AND l.kind = ${link} AND l."deactivatedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "RosterRecord" r WHERE r."runId" = ${ctx.runId} AND r.kind = ${staged} AND r."externalId" = l."externalId")
    ORDER BY l."externalId" LIMIT 5000`);
}

async function planRemovals(ctx: Ctx) {
  if (ctx.mode !== "FULL") return;
  const db = tenantDb(ctx.orgId);
  const todo: Array<{ kind: PlanKind; rows: Array<{ id: string; externalId: string; localId: string }> }> = [];
  const blocked: PlanKind[] = [];
  for (const k of REMOVAL_KINDS) {
    if (!k.enabled(ctx.opts)) continue;
    const rows = await missingLinks(ctx, k.link, k.staged);
    if (!rows.length) continue;
    const linked = await db.rosterLink.count({ where: { orgId: ctx.orgId, provider: ctx.provider, kind: k.link, deactivatedAt: null } });
    if (removalBlocked(rows.length, linked, ctx.opts.removalLimitPercent)) blocked.push(k.kind);
    todo.push({ kind: k.kind, rows });
  }
  ctx.state.counts.removalBlocked = blocked;
  const stop = blocked.length > 0 && !ctx.allowMassDelete;
  if (stop) ctx.state.blocked = true;
  for (const t of todo) {
    if (!ctx.apply || stop) {
      for (const r of t.rows) change(ctx, { kind: t.kind, action: "remove", ext: r.externalId, label: r.externalId });
      continue;
    }
    for (let i = 0; i < t.rows.length; i += 200) {
      const slice = t.rows.slice(i, i + 200);
      await tenantTx(ctx.orgId, async (tx) => {
        for (const r of slice) {
          if (t.kind === "staff") {
            await removeStaff(tx, ctx, r.externalId, r.externalId, r);
            continue;
          }
          if (t.kind === "students") await tx.student.updateMany({ where: { id: r.localId, status: "ACTIVE" }, data: { status: "INACTIVE" } });
          else if (t.kind === "guardians") {
            const pairs = await tx.rosterLink.findMany({ where: { orgId: ctx.orgId, provider: ctx.provider, kind: "guardianLink", externalId: { startsWith: `${r.externalId}:` }, deactivatedAt: null }, select: { id: true, localId: true } });
            await tx.guardianLink.deleteMany({ where: { id: { in: pairs.map((p) => p.localId) } } });
            if (pairs.length) await tx.rosterLink.updateMany({ where: { id: { in: pairs.map((p) => p.id) } }, data: { deactivatedAt: ctx.now } });
          } else if (t.kind === "enrollments") {
            if (r.localId.startsWith("teacher:")) {
              const [, classId, membershipId] = r.localId.split(":");
              await tx.schoolClass.updateMany({ where: { id: classId, teacherMembershipId: membershipId }, data: { teacherMembershipId: null } });
            } else await tx.enrollment.deleteMany({ where: { id: r.localId } });
          }
          await tx.rosterLink.update({ where: { id: r.id }, data: { deactivatedAt: ctx.now } });
          change(ctx, { kind: t.kind, action: "remove", ext: r.externalId, label: r.externalId });
        }
      }, { timeout: 120_000 });
    }
  }
}

// ---------------------------------------------------------------------------
// Driver: one step (one batch) at a time
// ---------------------------------------------------------------------------

export function initialState(): PlanState {
  return { counts: emptyCounts(), issues: [], changes: [], cursor: { phase: "staff", after: null }, blocked: false };
}

/** Runs one batch and moves the cursor. */
export async function planStep(ctx: Ctx): Promise<{ done: boolean; processed: number }> {
  const cur = ctx.state.cursor;
  const next = (phase: Phase) => (ctx.state.cursor = { phase, after: null });
  switch (cur.phase) {
    case "staff":
    case "students":
    case "guardians": {
      const batch = await batchOf(ctx, "user", ROLE_SET[cur.phase], cur.after, USER_BATCH);
      if (!batch.length) {
        next(cur.phase === "staff" ? "students" : cur.phase === "students" ? "guardians" : "classes");
        return { done: false, processed: 0 };
      }
      if (cur.phase === "staff") await planStaff(ctx, batch);
      else if (cur.phase === "students") await planStudents(ctx, batch);
      else await planGuardians(ctx, batch);
      ctx.state.cursor = { phase: cur.phase, after: batch[batch.length - 1].externalId };
      return { done: false, processed: batch.length };
    }
    case "classes": {
      const batch = await batchOf(ctx, "class", null, cur.after, USER_BATCH);
      if (!batch.length) return (next("enrollments"), { done: false, processed: 0 });
      await planClasses(ctx, batch);
      ctx.state.cursor = { phase: "classes", after: batch[batch.length - 1].externalId };
      return { done: false, processed: batch.length };
    }
    case "enrollments": {
      const batch = await batchOf(ctx, "enrollment", null, cur.after, ENROLL_BATCH);
      if (!batch.length) return (next("removals"), { done: false, processed: 0 });
      await planEnrollments(ctx, batch);
      ctx.state.cursor = { phase: "enrollments", after: batch[batch.length - 1].externalId };
      return { done: false, processed: batch.length };
    }
    case "removals":
      await planRemovals(ctx);
      next("done");
      return { done: true, processed: 0 };
    default:
      return { done: true, processed: 0 };
  }
}

export async function planContext(setup: PlanSetup, state: PlanState) {
  return loadContext(setup, state);
}

export type { Ctx as PlanContext };
