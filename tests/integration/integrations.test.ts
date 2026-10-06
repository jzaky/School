// Integrations against real Postgres through the RLS-restricted app role: API keys (hash only, revoke,
// aggregated usage audit, owner losing access), REST API v1 upserts through the Import center services
// (idempotent, matching on student number, email and class code), tenant isolation with two schools, and
// scheduled sync through a local HTTP fixture (mapping, basic auth, idempotent slots, failure alert).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { authenticateApiKey, createApiKey, revokeApiKey } from "@/server/integrations/keys";
import { listClasses, listEnrollments, listStaff, listStudents, upsert, upsertAttendance, listAttendance } from "@/server/integrations/api";
import { encryptAuth, runDueSyncs, runSync } from "@/server/integrations/sync";
import { GET as apiGet, POST as apiPost } from "@/app/api/v1/[resource]/route";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
type School = { orgId: string; membershipId: string; userId: string; tag: string };
let A: School;
let B: School;
let server: http.Server;
let base = "";
const noFlush = async () => undefined;

async function makeSchool(label: string): Promise<School> {
  const tag = `${label}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const org = await owner.organization.create({ data: { slug: uid(`integr-${label.toLowerCase()}`), nameEn: `Integration School ${label}`, nameAr: `مدرسة التكامل ${label}` } });
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) roleIds[r.key] = (await owner.role.create({ data: { orgId: org.id, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, permissions: r.permissions } })).id;
  const dept = await owner.department.create({ data: { orgId: org.id, key: "science", nameEn: "Science", nameAr: "العلوم" } });
  await owner.subject.create({ data: { orgId: org.id, code: "MATH", nameEn: "Mathematics", nameAr: "الرياضيات", departmentId: dept.id } });
  await owner.academicYear.create({ data: { orgId: org.id, nameEn: "2026-2027", nameAr: "2026-2027", startsOn: new Date("2026-08-25"), endsOn: new Date("2027-07-01"), isCurrent: true } });
  await owner.campus.create({ data: { orgId: org.id, nameEn: "Main", nameAr: "الرئيسي", isMain: true } });
  const user = await owner.user.create({ data: { email: `${uid("admin")}@integrations.test`, nameEn: `Admin ${label}` } });
  const m = await owner.membership.create({ data: { orgId: org.id, userId: user.id } });
  await owner.membershipRole.create({ data: { orgId: org.id, membershipId: m.id, roleId: roleIds.school_admin } });
  return { orgId: org.id, membershipId: m.id, userId: user.id, tag };
}

const actorOf = (s: School) => ({ orgId: s.orgId, membershipId: s.membershipId, userId: s.userId });

async function keyFor(s: School, scopes: string[]) {
  return createApiKey(actorOf(s), { label: "SIS", scopes });
}

async function authed(key: string) {
  const res = await authenticateApiKey(key);
  if (!res.ok) throw new Error(`auth failed: ${res.code}`);
  return res;
}

// Local export server: /students.csv in a school's own layout (needs basic auth), /broken answers 500.
const FILE = (tag: string) => ["Pupil ID,Forename,Surname,Year Group,Parent Email,Parent First,Parent Last", `${tag}-P1,Maya,Haddad,10,nour.${tag.toLowerCase()}@integrations.test,Nour,Haddad`, `${tag}-P2,Omar,Saleh,10,,,`, `,Nobody,Here,10,,,`].join("\n");
let fileTag = "";
let hits = 0;

beforeAll(async () => {
  process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = "true";
  A = await makeSchool("A");
  B = await makeSchool("B");
  fileTag = A.tag;
  server = http.createServer((req, res) => {
    hits++;
    if (req.url === "/students.csv") {
      if (req.headers.authorization !== `Basic ${Buffer.from("sis:secret").toString("base64")}`) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/csv" }).end(FILE(fileTag));
      return;
    }
    res.writeHead(500).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  for (const s of [A, B]) if (s) await owner.organization.delete({ where: { id: s.orgId } }).catch(() => undefined);
  for (const s of [A, B]) {
    if (!s) continue;
    for (const t of ["apiKey", "syncRun", "syncSource", "csvImport", "auditEvent", "notification", "outboundMessage", "messageTemplate", "attendanceRecord"] as const) await (owner[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { orgId: s.orgId } });
  }
  await owner.user.deleteMany({ where: { email: { endsWith: "@integrations.test" } } });
  await owner.$disconnect();
});

describe("API keys", () => {
  it("stores only the hash, authenticates to the right school, and stops working when revoked", async () => {
    const k = await keyFor(A, ["students:write"]);
    const row = await owner.apiKey.findUnique({ where: { id: k.id } });
    expect(row?.keyHash).not.toContain(k.key.slice(4));
    expect(JSON.stringify(row)).not.toContain(k.key);
    const auth = await authed(k.key);
    expect(auth.orgId).toBe(A.orgId);
    expect(auth.actor.membershipId).toBe(A.membershipId);
    expect(await owner.auditEvent.count({ where: { orgId: A.orgId, action: "integrations.api_key_created", entityId: k.id } })).toBe(1);

    await revokeApiKey(actorOf(A), k.id);
    const after = await authenticateApiKey(k.key);
    expect(after).toMatchObject({ ok: false, code: "KEY_REVOKED" });
    expect(await authenticateApiKey(`hzk_${"x".repeat(43)}`)).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("audits use once per hour per key, with the request count, not per request", async () => {
    const k = await keyFor(A, ["staff:read"]);
    for (let i = 0; i < 4; i++) await authed(k.key);
    const events = await owner.auditEvent.findMany({ where: { orgId: A.orgId, action: "integrations.api_key_used", entityId: k.id } });
    expect(events).toHaveLength(1);
    const row = await owner.apiKey.findUnique({ where: { id: k.id } });
    expect(row?.useCount).toBe(4);
    expect(row?.unauditedUses).toBe(3);
    // An hour later the next request writes one event with the requests since the last one.
    await authenticateApiKey(k.key, new Date(Date.now() + 61 * 60_000));
    const later = await owner.auditEvent.findMany({ where: { orgId: A.orgId, action: "integrations.api_key_used", entityId: k.id }, orderBy: { createdAt: "asc" } });
    expect(later).toHaveLength(2);
    expect((later[1].meta as { requests: number }).requests).toBe(4);
  });

  it("stops working when its creator loses integrations access", async () => {
    const user = await owner.user.create({ data: { email: `${uid("reg")}@integrations.test`, nameEn: "Registrar" } });
    const m = await owner.membership.create({ data: { orgId: A.orgId, userId: user.id } });
    const role = await owner.role.findFirstOrThrow({ where: { orgId: A.orgId, key: "school_admin" } });
    const mr = await owner.membershipRole.create({ data: { orgId: A.orgId, membershipId: m.id, roleId: role.id } });
    const k = await createApiKey({ orgId: A.orgId, membershipId: m.id, userId: user.id }, { label: "Old", scopes: ["students:read"] });
    expect((await authenticateApiKey(k.key)).ok).toBe(true);
    await owner.membershipRole.delete({ where: { id: mr.id } });
    expect(await authenticateApiKey(k.key)).toMatchObject({ ok: false, code: "KEY_OWNER_INACTIVE" });
  });
});

describe("REST API v1", () => {
  it("upserts students with guardians idempotently, matching on student number and guardian email", async () => {
    const k = await keyFor(A, ["students:write"]);
    const { actor } = await authed(k.key);
    const body = {
      students: [
        { student_no: `${A.tag}-1`, first_name_en: "Adam", last_name_en: "Nasser", first_name_ar: "آدم", last_name_ar: "ناصر", grade: 9, section: "A", date_of_birth: "2011-04-02", guardians: [{ first_name_en: "Rania", last_name_en: "Nasser", email: `rania.${A.tag}@integrations.test`, relationship: "mother" }, { first_name_en: "Sami", last_name_en: "Nasser", email: `sami.${A.tag}@integrations.test`, relationship: "father" }] },
        { student_no: `${A.tag}-2`, first_name_en: "Lina", last_name_en: "Nasser", grade: 6, guardians: [{ first_name_en: "Rania", last_name_en: "Nasser", email: `rania.${A.tag}@integrations.test`, relationship: "mother" }] },
        { student_no: `${A.tag}-3`, first_name_en: "Bad", last_name_en: "Grade", grade: 42, secret_note: "ignored" },
      ],
    };
    const first = await upsert("students", actor, body, "API test");
    expect(first).toMatchObject({ total: 3, created: 2, updated: 0, failed: 1, unknown_fields: ["secret_note"] });
    expect(first.errors).toEqual([{ index: 2, field: "grade", code: "grade" }]);
    expect(JSON.stringify(first)).not.toContain("42");
    const adam = await owner.student.findFirstOrThrow({ where: { orgId: A.orgId, studentNo: `${A.tag}-1` }, include: { guardians: { include: { guardian: true } } } });
    expect(adam.guardians.map((g) => g.relationshipEn).sort()).toEqual(["Father", "Mother"]);
    expect(await owner.guardian.count({ where: { orgId: A.orgId, email: { startsWith: "rania." } } })).toBe(1);

    const again = await upsert("students", actor, body, "API test");
    expect(again).toMatchObject({ created: 0, updated: 2, failed: 1 });
    expect(await owner.student.count({ where: { orgId: A.orgId, studentNo: { startsWith: `${A.tag}-` } } })).toBe(2);
    expect(await owner.guardianLink.count({ where: { orgId: A.orgId, studentId: adam.id } })).toBe(2);
    // The calls show up in the Import center history.
    expect(await owner.csvImport.count({ where: { orgId: A.orgId, fileName: "API test" } })).toBe(2);
  });

  it("upserts staff, classes and enrollments idempotently through the import services", async () => {
    const k = await keyFor(A, ["staff:write", "classes:write", "students:read"]);
    const { actor } = await authed(k.key);
    const teacher = `teacher.${A.tag.toLowerCase()}@integrations.test`;
    const staff = { staff: [{ name_en: "Hana Karimi", email: teacher, roles: ["teacher"], department: "science", subjects: ["MATH"], grades: "9-10" }] };
    expect(await upsert("staff", actor, staff, "API test")).toMatchObject({ created: 1, failed: 0 });
    expect(await upsert("staff", actor, staff, "API test")).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    const classes = { classes: [{ class_code: `${A.tag}-9A-MATH`, subject: "MATH", grade: 9, section: "A", teacher_email: teacher, homeroom: false, students: [`${A.tag}-1`] }] };
    expect(await upsert("classes", actor, classes, "API test")).toMatchObject({ created: 1, failed: 0 });
    expect(await upsert("classes", actor, classes, "API test")).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    const enroll = { enrollments: [{ class_code: `${A.tag}-9A-MATH`, student_no: `${A.tag}-1` }] };
    expect(await upsert("enrollments", actor, enroll, "API test")).toMatchObject({ created: 0, unchanged: 1 });

    const classList = await listClasses(A.orgId, new URLSearchParams());
    expect(classList.data.find((c) => c.class_code === `${A.tag}-9A-MATH`)).toMatchObject({ grade: 9, teacher_email: teacher, student_count: 1, homeroom: false });
    const enrollments = await listEnrollments(A.orgId, new URLSearchParams());
    expect(enrollments.data).toEqual([expect.objectContaining({ class_code: `${A.tag}-9A-MATH`, student_no: `${A.tag}-1` })]);
    const staffList = await listStaff(A.orgId, new URLSearchParams());
    expect(staffList.data.find((s) => s.email === teacher)).toMatchObject({ roles: ["teacher"], department: "science", subjects: ["MATH"], grades: [9, 10] });
  });

  it("paginates lists with a cursor", async () => {
    const p1 = await listStudents(A.orgId, new URLSearchParams({ limit: "1" }));
    expect(p1.data).toHaveLength(1);
    expect(p1.next_cursor).toBeTruthy();
    const p2 = await listStudents(A.orgId, new URLSearchParams({ limit: "1", cursor: p1.next_cursor! }));
    expect(p2.data[0].id).not.toBe(p1.data[0].id);
    expect(p2.next_cursor).toBeNull();
    expect(p1.data[0]).not.toHaveProperty("emirates_id");
  });

  it("upserts attendance by student number and date", async () => {
    const k = await keyFor(A, ["attendance:write"]);
    const { actor } = await authed(k.key);
    const day = new Date().toISOString().slice(0, 10);
    const body = { attendance: [{ student_no: `${A.tag}-1`, date: day, status: "late", minutes_late: 10 }, { student_no: "NOPE-1", date: day, status: "absent" }, { student_no: `${A.tag}-2`, date: "2026-02-30", status: "absent" }] };
    expect(await upsertAttendance(actor, body, "API test")).toMatchObject({ created: 1, failed: 2, errors: [{ index: 1, field: "student_no", code: "unknownStudent" }, { index: 2, field: "date", code: "date" }] });
    expect(await upsertAttendance(actor, body, "API test")).toMatchObject({ created: 0, unchanged: 1 });
    const list = await listAttendance(A.orgId, new URLSearchParams({ student_no: `${A.tag}-1` }));
    expect(list.data).toEqual([expect.objectContaining({ date: day, status: "late", minutes_late: 10 })]);
  });

  it("keeps schools apart: a key only ever reads and writes its own school", async () => {
    const kb = await keyFor(B, ["students:write"]);
    const authB = await authed(kb.key);
    expect(authB.orgId).toBe(B.orgId);
    const listB = await listStudents(authB.orgId, new URLSearchParams());
    expect(listB.data).toEqual([]);
    // Same student number in school B creates B's own student; A's record is untouched.
    const res = await upsert("students", authB.actor, { students: [{ student_no: `${A.tag}-1`, first_name_en: "Other", last_name_en: "Child", grade: 3 }] }, "API test");
    expect(res).toMatchObject({ created: 1, updated: 0 });
    const a1 = await owner.student.findFirstOrThrow({ where: { orgId: A.orgId, studentNo: `${A.tag}-1` } });
    expect(a1.firstNameEn).toBe("Adam");
    // Keys and runs of one school are invisible to the other through the app role.
    expect(await tenantDb(B.orgId).apiKey.count({ where: { orgId: A.orgId } })).toBe(0);
    expect((await tenantDb(B.orgId).apiKey.findMany()).every((k) => k.orgId === B.orgId)).toBe(true);
    expect(await tenantDb(B.orgId).csvImport.count({ where: { orgId: A.orgId } })).toBe(0);
  });

  it("checks key and scope over HTTP and never echoes values in errors", async () => {
    const k = await keyFor(A, ["students:read"]);
    const params = Promise.resolve({ resource: "students" });
    const ok = await apiGet(new Request("http://x/api/v1/students?limit=2", { headers: { authorization: `Bearer ${k.key}` } }), { params });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.length).toBeGreaterThan(0);
    const denied = await apiPost(new Request("http://x/api/v1/students", { method: "POST", headers: { authorization: `Bearer ${k.key}` }, body: JSON.stringify({ students: [{ student_no: "X" }] }) }), { params });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("FORBIDDEN_SCOPE");
    const anon = await apiGet(new Request("http://x/api/v1/students"), { params });
    expect(anon.status).toBe(401);
    const kw = await keyFor(A, ["staff:write"]);
    const bad = await apiPost(new Request("http://x/api/v1/staff", { method: "POST", headers: { authorization: `Bearer ${kw.key}` }, body: "{not json secret@x.test" }), { params: Promise.resolve({ resource: "staff" }) });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("secret");
    const bigQuery = await apiGet(new Request("http://x/api/v1/students?limit=9999", { headers: { authorization: `Bearer ${k.key}` } }), { params });
    expect(bigQuery.status).toBe(400);
  });
});

describe("scheduled sync", () => {
  async function source(path: string, extra: Record<string, unknown> = {}) {
    return tenantDb(A.orgId).syncSource.create({
      data: {
        orgId: A.orgId,
        name: "SIS students",
        kind: "students",
        url: `${base}${path}`,
        authType: "BASIC",
        secretEnc: encryptAuth({ type: "BASIC", username: "sis", password: "secret" }),
        mapping: { "pupil id": "student_no", forename: "first_name_en", surname: "last_name_en", "parent email": "guardian_email", "parent first": "guardian_first_name_en", "parent last": "guardian_last_name_en" },
        schedule: "DAILY",
        hour: 0,
        createdById: A.membershipId,
        ...extra,
      },
    });
  }

  it("fetches a mapped export with basic auth, imports it, records counts only, and runs a slot once", async () => {
    const s = await source("/students.csv");
    const out = await runSync(A.orgId, s.id, { slot: "d:2026-10-06", trigger: "SCHEDULE", flush: noFlush });
    expect(out).toMatchObject({ status: "PARTIAL", errorCode: null });
    const run = await owner.syncRun.findUniqueOrThrow({ where: { id: out!.runId } });
    expect(run).toMatchObject({ total: 3, created: 2, failed: 1, status: "PARTIAL" });
    expect(JSON.stringify(run)).not.toContain("Maya");
    const maya = await owner.student.findFirstOrThrow({ where: { orgId: A.orgId, studentNo: `${A.tag}-P1` }, include: { guardians: true } });
    expect(maya.guardians).toHaveLength(1);
    // The same slot again does nothing (idempotency key: source + slot).
    const before = hits;
    expect(await runSync(A.orgId, s.id, { slot: "d:2026-10-06", trigger: "SCHEDULE", flush: noFlush })).toBeNull();
    expect(hits).toBe(before);
    // A new slot updates instead of duplicating.
    const next = await runSync(A.orgId, s.id, { slot: "d:2026-10-07", trigger: "SCHEDULE", flush: noFlush });
    const run2 = await owner.syncRun.findUniqueOrThrow({ where: { id: next!.runId } });
    expect(run2).toMatchObject({ created: 0, updated: 2 });
    expect(await owner.student.count({ where: { orgId: A.orgId, studentNo: { startsWith: `${A.tag}-P` } } })).toBe(2);
    expect((await owner.syncSource.findUniqueOrThrow({ where: { id: s.id } })).lastSlot).toBe("d:2026-10-07");
    await owner.syncSource.update({ where: { id: s.id }, data: { enabled: false } });
  });

  it("the scheduler runs due sources, and repeated failures notify integration admins once", async () => {
    const s = await source("/broken", { schedule: "HOURLY" });
    const t0 = new Date("2026-10-06T06:10:00Z");
    for (let i = 0; i < 4; i++) {
      const res = await runDueSyncs(A.orgId, { now: new Date(t0.getTime() + i * 3600_000), flush: noFlush });
      expect(res.ran).toBe(1);
    }
    // The same hour again: nothing due.
    expect((await runDueSyncs(A.orgId, { now: new Date(t0.getTime() + 3 * 3600_000 + 60_000), flush: noFlush })).ran).toBe(0);
    const runs = await owner.syncRun.findMany({ where: { sourceId: s.id } });
    expect(runs).toHaveLength(4);
    expect(runs.every((r) => r.status === "FAILED" && r.errorCode === "FETCH_HTTP_STATUS")).toBe(true);
    expect((await owner.syncSource.findUniqueOrThrow({ where: { id: s.id } })).consecutiveFailures).toBe(4);
    const alerts = await owner.notification.findMany({ where: { orgId: A.orgId, kind: "integration_sync_failed" } });
    expect(alerts.map((n) => n.recipientId)).toEqual([A.membershipId]);
    expect(alerts[0].titleEn).toContain("SIS students");
    await owner.syncSource.update({ where: { id: s.id }, data: { enabled: false } });
  });

  it("reports a wrong password as an auth failure without importing anything", async () => {
    const s = await source("/students.csv", { secretEnc: encryptAuth({ type: "BASIC", username: "sis", password: "wrong" }) });
    const out = await runSync(A.orgId, s.id, { slot: "m:test", trigger: "MANUAL", flush: noFlush });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "FETCH_AUTH" });
  });
});
