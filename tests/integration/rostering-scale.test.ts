// A full-size school through the OneRoster REST feed: about 1,500 students, 2,500 parents, 200 staff, 300 classes
// and 9,300 enrollments, fetched in pages, applied in batches, then synced again unchanged. Also checks that
// duplicate emails and student numbers in a feed are reported and not applied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { encryptCredentials } from "@/server/rostering/connections";
import { createRun, processRun } from "@/server/rostering/run";
import type { Counts, Issue } from "@/server/rostering/plan";
import { startMockIdp, type MockIdp } from "../fixtures/mock-idp";
import { largeFeed, serveOneRoster, type FeedServer } from "../fixtures/oneroster";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let idp: MockIdp;
let srv: FeedServer;
let orgId: string;
let adminId: string;
let connectionId: string;

async function sync(dryRun = false) {
  const r = await createRun({ orgId, connectionId, provider: "oneroster", source: "API", trigger: "MANUAL", mode: "FULL", dryRun, actorId: adminId });
  let rounds = 0;
  for (; rounds < 500; rounds++) if ((await processRun(orgId, r.id, { budgetMs: 20_000 })) === "done") break;
  return { run: (await tenantDb(orgId).rosterRun.findUnique({ where: { id: r.id } }))!, rounds };
}

beforeAll(async () => {
  process.env.REDIS_URL = "";
  process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = "true";
  idp = await startMockIdp();
  srv = serveOneRoster(idp, largeFeed(1));
  const org = await owner.organization.create({ data: { slug: uid("roster-big"), nameEn: "Big Roster School", nameAr: "مدرسة كبيرة" } });
  orgId = org.id;
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) roleIds[r.key] = (await owner.role.create({ data: { orgId, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, descEn: r.descEn, descAr: r.descAr, permissions: r.permissions } })).id;
  const year = new Date().getUTCFullYear();
  await owner.academicYear.create({ data: { orgId, nameEn: "Year", nameAr: "العام", startsOn: new Date(Date.UTC(year - 1, 7, 20)), endsOn: new Date(Date.UTC(year + 1, 6, 1)), isCurrent: true } });
  await owner.subject.create({ data: { orgId, code: "MATH", nameEn: "Mathematics", nameAr: "الرياضيات" } });
  const admin = await owner.user.create({ data: { email: `${uid("admin")}@big.test`, nameEn: "Admin" } });
  adminId = (await owner.membership.create({ data: { orgId, userId: admin.id } })).id;
  await owner.membershipRole.create({ data: { orgId, membershipId: adminId, roleId: roleIds.school_admin } });
  connectionId = (await tenantDb(orgId).rosterConnection.create({ data: { orgId, provider: "oneroster", name: "Big feed", baseUrl: srv.baseUrl, authMode: "OAUTH1", credentialsEnc: encryptCredentials("OAUTH1", { key: srv.key, secret: srv.secret }), schoolIds: [], createdById: adminId } })).id;
}, 120_000);

afterAll(async () => {
  await idp?.close();
  if (orgId) {
    for (const t of ["RosterRecord", "RosterLink", "RosterRun", "RosterConnection"]) await owner.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "orgId" = $1`, orgId);
    await owner.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  }
  await owner.user.deleteMany({ where: { email: { endsWith: "@big.test" } } });
  await owner.$disconnect();
}, 120_000);

describe("roster sync at full-school scale", () => {
  it("applies a full school in pages and batches, then re-syncs with no changes", async () => {
    const t0 = Date.now();
    const { run, rounds } = await sync(false);
    const firstMs = Date.now() - t0;
    const c = run.counts as Counts;
    expect(run.status).toBe("SUCCEEDED");
    expect(c.students.create).toBe(1500);
    expect(c.guardians.create).toBe(2500);
    expect(c.staff.create).toBe(200);
    expect(c.classes.create).toBe(300);
    expect(c.enrollments.create).toBe(9300);
    expect(await owner.student.count({ where: { orgId } })).toBe(1500);
    expect(await owner.enrollment.count({ where: { orgId } })).toBe(9000);
    expect(await owner.guardianLink.count({ where: { orgId } })).toBe(2500);
    // Users came in 1,000 per page (OneRoster limit/offset paging).
    expect(srv.calls.filter((x) => x.startsWith("users?")).length).toBe(Math.ceil(4200 / 1000));

    const t1 = Date.now();
    const again = await sync(false);
    const secondMs = Date.now() - t1;
    const c2 = again.run.counts as Counts;
    expect(c2.students.unchanged).toBe(1500);
    expect(c2.enrollments.unchanged).toBe(9300);
    expect(c2.students.create + c2.students.update + c2.enrollments.create).toBe(0);
    console.log(`[scale] first sync ${firstMs} ms in ${rounds + 1} job rounds, unchanged re-sync ${secondMs} ms`);
  }, 600_000);

  it("reports duplicate emails and student numbers instead of applying them", async () => {
    srv.feed = largeFeed(0.01);
    srv.feed.users.push({ ...srv.feed.users.find((u) => u.role === "teacher")!, sourcedId: "dup-t" });
    const firstStudent = srv.feed.users.find((u) => u.role === "student")!;
    srv.feed.users.push({ ...firstStudent, sourcedId: "dup-s" });
    const { run } = await sync(true);
    const codes = (run.issues as Issue[]).map((i) => `${i.code}:${i.ext}`);
    expect(codes).toEqual(expect.arrayContaining(["DUPLICATE_EMAIL:dup-t", "DUPLICATE_NUMBER:dup-s", `DUPLICATE_NUMBER:${firstStudent.sourcedId}`]));
  }, 120_000);
});
