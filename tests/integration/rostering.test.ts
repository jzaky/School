// Rostering against a mock OneRoster server (OAuth 1.0a), a mock Clever district and OneRoster CSV files, with
// real Postgres through the RLS-restricted app role: preview, apply, unchanged re-sync, updates, removals, the
// removal limit, resuming, delta pulls, grade mapping (KG1 and KG2) and tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptField } from "@/lib/crypto";
import { createZip } from "@/lib/zip";
import { tenantDb } from "@/lib/tenant-db";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { encryptCredentials } from "@/server/rostering/connections";
import { applyRun, createRun, dueRosterRuns, processRun, stageRecords } from "@/server/rostering/run";
import { parseOneRosterZip } from "@/server/rostering/csv";
import type { Counts, Issue } from "@/server/rostering/plan";
import { startMockIdp, type MockIdp } from "../../scripts/lib/mock-idp";
import { serveClever, serveOneRoster, smallFeed, type FeedServer } from "../fixtures/oneroster";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let idp: MockIdp;
let srv: FeedServer;
type School = { orgId: string; adminId: string; roleIds: Record<string, string>; connectionId: string };
let A: School;
let B: School;

async function makeSchool(label: string): Promise<Omit<School, "connectionId">> {
  const org = await owner.organization.create({ data: { slug: uid(`roster-${label.toLowerCase()}`), nameEn: `Roster School ${label}`, nameAr: `مدرسة القوائم ${label}`, curricula: ["AMERICAN"] } });
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) roleIds[r.key] = (await owner.role.create({ data: { orgId: org.id, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, descEn: r.descEn, descAr: r.descAr, permissions: r.permissions } })).id;
  const year = new Date().getUTCFullYear();
  await owner.academicYear.create({ data: { orgId: org.id, nameEn: "This year", nameAr: "هذا العام", startsOn: new Date(Date.UTC(year - 1, 7, 20)), endsOn: new Date(Date.UTC(year + 1, 6, 1)), isCurrent: true } });
  await owner.campus.create({ data: { orgId: org.id, nameEn: "Main", nameAr: "الرئيسي", isMain: true } });
  await owner.subject.create({ data: { orgId: org.id, code: "MATH", nameEn: "Mathematics", nameAr: "الرياضيات" } });
  const admin = await owner.user.create({ data: { email: `${uid("admin")}@roster.test`, nameEn: "Admin" } });
  const m = await owner.membership.create({ data: { orgId: org.id, userId: admin.id } });
  await owner.membershipRole.create({ data: { orgId: org.id, membershipId: m.id, roleId: roleIds.school_admin } });
  return { orgId: org.id, adminId: m.id, roleIds };
}

async function connection(s: Omit<School, "connectionId">, data: { provider?: string; baseUrl?: string; authMode?: string; key?: string; secret?: string; token?: string; options?: object; schoolIds?: string[] }) {
  const mode = (data.authMode ?? "OAUTH1") as "OAUTH1" | "BEARER";
  return (
    await tenantDb(s.orgId).rosterConnection.create({
      data: {
        orgId: s.orgId,
        provider: data.provider ?? "classlink",
        name: "Feed",
        baseUrl: data.baseUrl ?? srv.baseUrl,
        authMode: mode,
        credentialsEnc: encryptCredentials(mode, { key: data.key ?? srv.key, secret: data.secret ?? srv.secret, token: data.token }),
        schoolIds: data.schoolIds ?? ["org-ald"],
        options: (data.options ?? { importDemographics: true }) as object,
        createdById: s.adminId,
      },
    })
  ).id;
}

async function run(s: School, opts: { dryRun: boolean; mode?: "FULL" | "DELTA"; connectionId?: string; provider?: string; budgetMs?: number }) {
  const r = await createRun({ orgId: s.orgId, connectionId: opts.connectionId ?? s.connectionId, provider: opts.provider ?? "classlink", source: "API", trigger: "MANUAL", mode: opts.mode ?? "FULL", dryRun: opts.dryRun, actorId: s.adminId });
  for (let i = 0; i < 200; i++) if ((await processRun(s.orgId, r.id, { budgetMs: opts.budgetMs })) === "done") break;
  return (await tenantDb(s.orgId).rosterRun.findUnique({ where: { id: r.id } }))!;
}
const counts = (r: { counts: unknown }) => r.counts as Counts;
const codes = (r: { issues: unknown }) => (r.issues as Issue[]).map((i) => `${i.kind}:${i.code}:${i.ext}`);

beforeAll(async () => {
  process.env.REDIS_URL = "";
  process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = "true";
  idp = await startMockIdp();
  srv = serveOneRoster(idp, smallFeed());
  const a = await makeSchool("A");
  const b = await makeSchool("B");
  // Already in Horizon before the feed: a student with Arabic names and an Emirates ID, and an invited teacher.
  await owner.student.create({ data: { orgId: a.orgId, studentNo: "S-1004", firstNameEn: "Maya", lastNameEn: "Aziz", firstNameAr: "مايا", lastNameAr: "عزيز", gradeLevel: 10, emiratesIdEnc: encryptField("784-2010-1234567-1"), emiratesIdLast4: "4567" } });
  const yousef = await owner.user.upsert({ where: { email: "yousef.darwish@aldurrah.test" }, create: { email: "yousef.darwish@aldurrah.test", nameEn: "Yousef Darwish" }, update: {} });
  const ym = await owner.membership.create({ data: { orgId: a.orgId, userId: yousef.id, status: "INVITED" } });
  await owner.staffProfile.create({ data: { orgId: a.orgId, membershipId: ym.id } });
  await owner.membershipRole.create({ data: { orgId: a.orgId, membershipId: ym.id, roleId: a.roleIds.teacher } });
  A = { ...a, connectionId: await connection(a, {}) };
  B = { ...b, connectionId: await connection(b, {}) };
});

afterAll(async () => {
  await idp?.close();
  for (const s of [A, B]) {
    if (!s) continue;
    for (const t of ["RosterRecord", "RosterLink", "RosterRun", "RosterConnection"]) await owner.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "orgId" = $1`, s.orgId);
    await owner.organization.delete({ where: { id: s.orgId } }).catch(() => undefined);
  }
  await owner.user.deleteMany({ where: { email: { endsWith: "@roster.test" } } });
  await owner.user.deleteMany({ where: { email: { endsWith: "@aldurrah.test" } } });
  await owner.$disconnect();
});

describe("OneRoster preview and sync", () => {
  it("previews without writing anything, with counts, sample changes and problems", async () => {
    const before = await owner.student.count({ where: { orgId: A.orgId } });
    const r = await run(A, { dryRun: true });
    expect(r.status).toBe("PREVIEWED");
    const c = counts(r);
    expect(c.staff).toMatchObject({ create: 1, update: 1, skipped: 1 });
    expect(c.students).toMatchObject({ create: 3, update: 1, skipped: 1 });
    expect(c.guardians).toMatchObject({ create: 3 });
    expect(c.classes).toMatchObject({ create: 3, skipped: 1 });
    expect(c.enrollments).toMatchObject({ create: 6 });
    expect(codes(r)).toEqual(expect.arrayContaining(["staff:ROLE_NOT_MAPPED:a-1", "students:UNKNOWN_GRADE:s-5", "classes:PAST_TERM:c-old"]));
    expect(await owner.student.count({ where: { orgId: A.orgId } })).toBe(before);
    expect(await owner.rosterLink.count({ where: { orgId: A.orgId } })).toBe(0);
    // The OneRoster server saw signed requests with paging.
    expect(srv.calls.some((c) => c.startsWith("users?") && c.includes("offset=0"))).toBe(true);
  });

  it("applies the preview: staff, students (KG1 and KG2), parents, classes, teachers and enrollments", async () => {
    const preview = await tenantDb(A.orgId).rosterRun.findFirst({ where: { status: "PREVIEWED" }, orderBy: { startedAt: "desc" } });
    await applyRun(A.orgId, preview!.id, { actorId: A.adminId, allowMassDelete: false });
    for (let i = 0; i < 50; i++) if ((await processRun(A.orgId, preview!.id)) === "done") break;
    const r = (await tenantDb(A.orgId).rosterRun.findUnique({ where: { id: preview!.id } }))!;
    expect(r.status).toBe("PARTIAL");
    expect(counts(r).students).toMatchObject({ create: 3, update: 1 });

    const students = await owner.student.findMany({ where: { orgId: A.orgId }, orderBy: { studentNo: "asc" } });
    const by = (n: string) => students.find((s) => s.studentNo === n)!;
    expect(by("S-1001")).toMatchObject({ firstNameEn: "Omar", gradeLevel: 9, curriculum: "AMERICAN", gender: "male" });
    expect(by("S-1001").dateOfBirth?.toISOString().slice(0, 10)).toBe("2011-04-02");
    expect(by("S-1002").gradeLevel).toBe(0);
    expect(by("S-1003").gradeLevel).toBe(-1);
    // Fields the feed does not send stay as the school entered them.
    expect(by("S-1004")).toMatchObject({ firstNameAr: "مايا", lastNameAr: "عزيز", emiratesIdLast4: "4567" });
    expect(students.some((s) => s.studentNo === "X-1" || s.studentNo === "S-1005")).toBe(false);

    const hana = await owner.user.findUnique({ where: { email: "hana.karimi@aldurrah.test" }, include: { memberships: { where: { orgId: A.orgId }, include: { roles: { include: { role: true } }, staffProfile: true } } } });
    expect(hana?.passwordHash).toBeNull();
    expect(hana?.memberships[0]).toMatchObject({ status: "INVITED" });
    expect(hana?.memberships[0].roles.map((x) => x.role.key)).toEqual(["teacher"]);
    expect(hana?.memberships[0].staffProfile?.employeeNo).toBe("EMP-101");

    const lina = by("S-1002");
    const linaParents = await owner.guardianLink.findMany({ where: { studentId: lina.id }, include: { guardian: true } });
    expect(linaParents.map((l) => l.guardian.email).sort()).toEqual(["nour.haddad@family.test", "sami.haddad@family.test"]);
    expect(linaParents.find((l) => l.guardian.email === "sami.haddad@family.test")?.relationshipEn).toBe("Guardian");

    const math = await owner.schoolClass.findFirst({ where: { orgId: A.orgId, nameEn: "Mathematics 9A" }, include: { enrollments: true, subject: true } });
    expect(math?.subject?.code).toBe("MATH");
    expect(math?.room).toBe("B-204");
    expect(math?.teacherMembershipId).toBe(hana?.memberships[0].id);
    expect(math?.enrollments.length).toBe(2);
    const kg = await owner.schoolClass.findFirst({ where: { orgId: A.orgId, nameEn: "KG2 Blue" } });
    expect(kg).toMatchObject({ gradeLevel: 0, isHomeroom: true });
    // The staged copy is gone after a sync, and the run is in the audit log without personal data.
    expect(await owner.rosterRecord.count({ where: { runId: r.id } })).toBe(0);
    const audit = await owner.auditEvent.findFirst({ where: { orgId: A.orgId, action: "roster.sync_applied", entityId: r.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.meta)).not.toMatch(/Haddad|aldurrah|family\.test/);
  });

  it("a second sync of the same feed changes nothing", async () => {
    const before = await owner.enrollment.count({ where: { orgId: A.orgId } });
    const r = await run(A, { dryRun: false });
    const c = counts(r);
    expect(c.students.create + c.students.update + c.staff.create + c.classes.create + c.enrollments.create).toBe(0);
    expect(c.students.unchanged).toBe(4);
    expect(c.enrollments.unchanged).toBe(6);
    expect(await owner.enrollment.count({ where: { orgId: A.orgId } })).toBe(before);
  });

  it("links what Horizon already has, ignores parent-only moves and quietly closes links to records deleted in Horizon", async () => {
    const feed = srv.feed;
    // Zaid's own fields are unchanged; only his list of parents moved (Rami becomes his parent too).
    feed.users.find((u) => u.sourcedId === "s-3")!.agents = [{ sourcedId: "p-3", type: "user", href: "/users/p-3" }];
    // Omar's Mathematics enrollment exists in Horizon but its link is gone (as after an import made outside the feed).
    await owner.rosterLink.deleteMany({ where: { orgId: A.orgId, kind: "enrollment", externalId: "e-1" } });
    // Omar's homeroom enrollment was deleted in Horizon, and the feed has dropped it too.
    const omar = await owner.student.findFirst({ where: { orgId: A.orgId, studentNo: "S-1001" } });
    await owner.enrollment.deleteMany({ where: { orgId: A.orgId, studentId: omar!.id, class: { nameEn: "Homeroom 9A" } } });
    feed.enrollments = feed.enrollments.filter((e) => e.sourcedId !== "e-2");

    const preview = await run(A, { dryRun: true });
    const c = counts(preview);
    expect(c.students).toMatchObject({ create: 0, update: 0, unchanged: 4 });
    expect(c.guardians.update).toBe(1);
    expect(c.enrollments).toMatchObject({ create: 0, update: 1, remove: 0 });
    const changes = preview.changes as Array<{ kind: string; action: string; ext: string; fields?: string[] }>;
    expect(changes.find((x) => x.ext === "e-1")).toMatchObject({ action: "update", fields: ["linked"] });
    expect(changes.some((x) => x.ext === "e-2")).toBe(false);

    const before = await owner.enrollment.count({ where: { orgId: A.orgId } });
    const r = await run(A, { dryRun: false });
    expect(counts(r).enrollments).toMatchObject({ create: 0, remove: 0 });
    expect(await owner.enrollment.count({ where: { orgId: A.orgId } })).toBe(before);
    expect(await owner.rosterLink.findFirst({ where: { orgId: A.orgId, kind: "enrollment", externalId: "e-1", deactivatedAt: null } })).not.toBeNull();
    expect((await owner.rosterLink.findFirst({ where: { orgId: A.orgId, kind: "enrollment", externalId: "e-2" } }))?.deactivatedAt).not.toBeNull();
    // Converged: the next preview has nothing to change.
    const again = counts(await run(A, { dryRun: true }));
    expect(again.students.update + again.guardians.update + again.enrollments.update + again.enrollments.create + again.enrollments.remove).toBe(0);
  });

  it("applies updates and removals: a renamed student, a deleted student and an enrollment the feed dropped", async () => {
    const feed = srv.feed;
    const omar = feed.users.find((u) => u.sourcedId === "s-1")!;
    omar.familyName = "Haddad-Saleh";
    omar.dateLastModified = new Date(Date.now() + 60_000).toISOString();
    feed.users.find((u) => u.sourcedId === "s-4")!.status = "tobedeleted";
    feed.enrollments = feed.enrollments.filter((e) => e.sourcedId !== "e-6");
    const r = await run(A, { dryRun: false });
    expect(counts(r).students).toMatchObject({ update: 1, remove: 1 });
    expect(counts(r).enrollments.remove).toBe(1);
    expect((await owner.student.findFirst({ where: { orgId: A.orgId, studentNo: "S-1001" } }))?.lastNameEn).toBe("Haddad-Saleh");
    expect((await owner.student.findFirst({ where: { orgId: A.orgId, studentNo: "S-1004" } }))?.status).toBe("INACTIVE");
    const math = await owner.schoolClass.findFirst({ where: { orgId: A.orgId, nameEn: "Mathematics 9A" }, include: { enrollments: true } });
    expect(math?.enrollments.length).toBe(1);
  });

  it("stops before removing more than the school's limit, until someone confirms", async () => {
    const keep = srv.feed.users;
    const extra = Array.from({ length: 8 }, (_, i) => ({ ...keep.find((u) => u.sourcedId === "s-3")!, sourcedId: `sx-${i}`, identifier: `S-20${i}`, givenName: `Extra${i}`, agents: [] }));
    srv.feed.users = [...keep, ...extra];
    expect((await run(A, { dryRun: false })).status).toBe("PARTIAL");
    srv.feed.users = keep.filter((u) => u.role !== "student" || u.sourcedId === "s-1");
    const r = await run(A, { dryRun: false });
    expect(r.status).toBe("BLOCKED");
    expect(counts(r).removalBlocked).toContain("students");
    expect((await owner.student.findFirst({ where: { orgId: A.orgId, studentNo: "S-1002" } }))?.status).toBe("ACTIVE");
    await applyRun(A.orgId, r.id, { actorId: A.adminId, allowMassDelete: true });
    for (let i = 0; i < 50; i++) if ((await processRun(A.orgId, r.id)) === "done") break;
    expect((await owner.student.findFirst({ where: { orgId: A.orgId, studentNo: "S-1002" } }))?.status).toBe("INACTIVE");
    srv.feed.users = keep;
  });

  it("resumes where it stopped and never runs one run twice at the same time", async () => {
    const r = await createRun({ orgId: A.orgId, connectionId: A.connectionId, provider: "classlink", source: "API", trigger: "MANUAL", mode: "FULL", dryRun: true, actorId: A.adminId });
    expect(await processRun(A.orgId, r.id, { budgetMs: 0 })).toBe("continue");
    const mid = await tenantDb(A.orgId).rosterRun.findUnique({ where: { id: r.id } });
    expect(mid?.status).toBe("FETCHING");
    const [x, y] = await Promise.all([processRun(A.orgId, r.id), processRun(A.orgId, r.id)]);
    expect([x, y].sort()).toEqual(["busy", "done"]);
    expect((await tenantDb(A.orgId).rosterRun.findUnique({ where: { id: r.id } }))?.status).toBe("PREVIEWED");
  });

  it("asks only for changes in a delta run", async () => {
    srv.calls.length = 0;
    const r = await run(A, { dryRun: true, mode: "DELTA" });
    expect(srv.calls.some((c) => decodeURIComponent(c).includes("dateLastModified>'"))).toBe(true);
    expect(await owner.rosterRecord.count({ where: { runId: r.id, kind: "user" } })).toBe(1);
  });

  it("fails cleanly with wrong credentials", async () => {
    const id = await connection(A, { secret: "wrong" });
    const r = await run(A, { dryRun: true, connectionId: id });
    expect(r).toMatchObject({ status: "FAILED", errorCode: "FETCH_AUTH" });
  });

  it("creates scheduled runs once per slot", async () => {
    await tenantDb(A.orgId).rosterConnection.update({ where: { id: A.connectionId }, data: { schedule: "DAILY", hour: 0 } });
    const first = await dueRosterRuns(A.orgId);
    const second = await dueRosterRuns(A.orgId);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(second.filter((id) => !first.includes(id))).toEqual([]);
    await tenantDb(A.orgId).rosterConnection.update({ where: { id: A.connectionId }, data: { schedule: "OFF" } });
    for (const id of first) for (let i = 0; i < 50; i++) if ((await processRun(A.orgId, id)) !== "continue") break;
  });

  it("keeps each school's roster data to itself", async () => {
    expect(await tenantDb(B.orgId).rosterLink.count()).toBe(0);
    expect(await tenantDb(B.orgId).rosterRun.count()).toBe(0);
    expect(await tenantDb(A.orgId).rosterLink.count()).toBeGreaterThan(0);
    const aRun = await tenantDb(A.orgId).rosterRun.findFirst();
    expect(await tenantDb(B.orgId).rosterRun.findUnique({ where: { id: aRun!.id } })).toBeNull();
    await expect(tenantDb(B.orgId).rosterLink.create({ data: { orgId: A.orgId, provider: "x", kind: "student", externalId: "e", localId: "l", hash: "h" } })).rejects.toThrow();
  });
});

describe("OneRoster CSV and Clever", () => {
  const csv = (rows: Array<Record<string, unknown>>, cols: string[]) => [cols.join(","), ...rows.map((r) => cols.map((c) => String(r[c] ?? "")).join(","))].join("\n");

  it("reads a OneRoster CSV zip into the same records", async () => {
    const zip = createZip([
      { name: "manifest.csv", data: "propertyName,value\nmanifest.version,1.0\noneroster.version,1.1\nfile.users,bulk\nfile.enrollments,bulk" },
      { name: "orgs.csv", data: csv([{ sourcedId: "org-ald", status: "active", name: "Al Durrah", type: "school" }], ["sourcedId", "status", "dateLastModified", "name", "type", "identifier", "parentSourcedId"]) },
      {
        name: "users.csv",
        data: csv(
          [
            { sourcedId: "cs-1", status: "active", enabledUser: "true", orgSourcedIds: "org-ald", role: "student", givenName: "Adam", familyName: "Nasser", identifier: "C-1", grades: "KG", agentSourcedIds: "cp-1" },
            { sourcedId: "cp-1", status: "active", enabledUser: "true", orgSourcedIds: "org-ald", role: "parent", givenName: "Rania", familyName: "Nasser", email: "rania@family.test", agentSourcedIds: "cs-1" },
          ],
          ["sourcedId", "status", "dateLastModified", "enabledUser", "orgSourcedIds", "role", "username", "userIds", "givenName", "familyName", "middleName", "identifier", "email", "sms", "phone", "agentSourcedIds", "grades", "password"],
        ),
      },
      { name: "classes.csv", data: csv([{ sourcedId: "cc-1", status: "active", title: "KG2 Green", classType: "homeroom", grades: "KG", schoolSourcedId: "org-ald" }], ["sourcedId", "status", "dateLastModified", "title", "grades", "courseSourcedId", "classCode", "classType", "location", "schoolSourcedId", "termSourcedIds", "subjects", "subjectCodes", "periods"]) },
      { name: "enrollments.csv", data: csv([{ sourcedId: "ce-1", status: "active", classSourcedId: "cc-1", schoolSourcedId: "org-ald", userSourcedId: "cs-1", role: "student" }], ["sourcedId", "status", "dateLastModified", "classSourcedId", "schoolSourcedId", "userSourcedId", "role", "primary", "beginDate", "endDate"]) },
    ]);
    const parsed = parseOneRosterZip(zip);
    expect(parsed.mode).toBe("FULL");
    const student = parsed.records.find((r) => r.externalId === "cs-1")!.data as { grades: string[]; agentIds: string[]; orgIds: string[] };
    expect(student).toMatchObject({ grades: ["KG"], agentIds: ["cp-1"], orgIds: ["org-ald"] });

    const r = await createRun({ orgId: B.orgId, connectionId: null, provider: "oneroster", source: "CSV", trigger: "UPLOAD", mode: parsed.mode, dryRun: false, actorId: B.adminId });
    await stageRecords(B.orgId, r.id, parsed.records);
    await tenantDb(B.orgId).rosterRun.update({ where: { id: r.id }, data: { cursor: { fetchDone: true } } });
    for (let i = 0; i < 20; i++) if ((await processRun(B.orgId, r.id)) === "done") break;
    const done = await tenantDb(B.orgId).rosterRun.findUnique({ where: { id: r.id } });
    expect(done?.status).toBe("SUCCEEDED");
    const adam = await owner.student.findFirst({ where: { orgId: B.orgId, studentNo: "C-1" }, include: { guardians: true, enrollments: true } });
    expect(adam).toMatchObject({ gradeLevel: 0 });
    expect(adam?.guardians.length).toBe(1);
    expect(adam?.enrollments.length).toBe(1);
  });

  it("syncs a Clever district through the data API with paging", async () => {
    serveClever(idp, "district-token", {
      schools: [{ id: "cs-school", name: "Al Durrah" }],
      terms: [],
      users: [
        { id: "cv-t", email: "clever.teacher@aldurrah.test", name: { first: "Huda", last: "Ali" }, roles: { teacher: { teacher_number: "T-9", schools: ["cs-school"] } } },
        { id: "cv-s1", name: { first: "Karim", last: "Ali" }, roles: { student: { student_number: "CV-1", grade: "Kindergarten", school: "cs-school" } } },
        { id: "cv-s2", name: { first: "Rana", last: "Ali" }, roles: { student: { student_number: "CV-2", grade: "3", school: "cs-school" } } },
        { id: "cv-s3", name: { first: "Sara", last: "Ali" }, roles: { student: { student_number: "CV-3", grade: "PreKindergarten", school: "cs-school" } } },
        { id: "cv-c", email: "parent.ali@family.test", name: { first: "Dana", last: "Ali" }, roles: { contact: { student_relationships: [{ student: "cv-s2", relationship: "Mother" }] } } },
      ],
      sections: [{ id: "sec-1", name: "Grade 3 Math", subject: "math", grade: "3", school: "cs-school", teacher: "cv-t", teachers: ["cv-t"], students: ["cv-s2"] }],
    });
    const id = await connection(B, { provider: "clever", baseUrl: `${idp.base}/clever-api`, authMode: "BEARER", token: "district-token", schoolIds: ["cs-school"], options: {} });
    const r = await run(B, { dryRun: false, connectionId: id, provider: "clever" });
    expect(r.status).toBe("SUCCEEDED");
    expect(counts(r).students.create).toBe(3);
    const karim = await owner.student.findFirst({ where: { orgId: B.orgId, studentNo: "CV-1" } });
    expect(karim?.gradeLevel).toBe(0);
    expect((await owner.student.findFirst({ where: { orgId: B.orgId, studentNo: "CV-3" } }))?.gradeLevel).toBe(-1);
    const rana = await owner.student.findFirst({ where: { orgId: B.orgId, studentNo: "CV-2" }, include: { guardians: true, enrollments: true } });
    expect(rana?.guardians[0]?.relationshipEn).toBe("Mother");
    expect(rana?.enrollments.length).toBe(1);
  });
});
