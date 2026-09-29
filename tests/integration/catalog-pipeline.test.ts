// Requirement pipeline against a local fixture server and the real database: fetch outcomes, extraction
// cache, publish with version history and audit, access rules for global writes, and change notifications.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb } from "@/lib/tenant-db";
import { runCatalogRefresh } from "@/server/catalog-pipeline/jobs";
import { approveExtraction, subjectLabels, writeVersion } from "@/server/catalog-pipeline/publish";
import { notifyOrgStaff, affectedOrgs, reviewChange } from "@/server/catalog-pipeline/changes";
import { upsertSource } from "@/server/catalog-pipeline/sources";
import type { ChangeDiff } from "@/server/catalog-pipeline/types";
import type { CatalogActor } from "@/server/platform/catalog-db";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
const fixture = (name: string) => readFileSync(path.join(__dirname, "../fixtures/catalog", name), "utf8");
let server: Server;
let base = "";
let page = "uk-cs.html";
let demoOrg: string;
let plainOrg: string;
let uniId: string;
let programId: string;
let sourceId: string;
let blockedSourceId: string;
let counselor: string;
let counselorUser: string;
const users: string[] = [];

const actor = (orgId: string, orgIsDemo: boolean, userId: string | null = null): CatalogActor => ({ orgId, orgIsDemo, email: "reviewer@school.test", canReview: true, membershipId: null, userId });
const deps = (orgId: string, orgIsDemo: boolean) => ({ catalog: owner, tenant: tenantDb(orgId), actor: actor(orgId, orgIsDemo), writable: true });

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") return void res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /private\n");
    if (req.url === "/old") return void res.writeHead(301, { location: "/page" }).end();
    if (req.url === "/page") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fixture(page));
    if (req.url?.startsWith("/private")) return void res.writeHead(200, { "content-type": "text/html" }).end("<p>secret</p>");
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  demoOrg = (await owner.organization.create({ data: { slug: uid("catalog-demo"), nameEn: "Catalog Demo", nameAr: "عرض الدليل", isDemo: true } })).id;
  plainOrg = (await owner.organization.create({ data: { slug: uid("catalog-plain"), nameEn: "Catalog Plain", nameAr: "مدرسة عادية" } })).id;
  uniId = (await owner.university.create({ data: { orgId: null, key: uid("uni"), nameEn: "Fixture University", nameAr: "جامعة الاختبار", countryCode: "GB", cityEn: "London", cityAr: "لندن" } })).id;
  programId = (await owner.universityProgram.create({ data: { orgId: null, universityId: uniId, key: uid("prog"), nameEn: "Computer Science BSc", nameAr: "علوم الحاسوب", field: "computer_science", degree: "BSc", requirements: {} } })).id;
  sourceId = (await upsertSource(owner, { orgId: null, universityId: uniId, programId, url: `${base}/old`, sourceType: "OFFICIAL_UNIVERSITY" }))!.source.id;
  blockedSourceId = (await upsertSource(owner, { orgId: null, universityId: uniId, programId, url: `${base}/private/cs`, sourceType: "MIRROR" }))!.source.id;

  // Advising staff in the demo school, and a student with the programme on a shortlist.
  const user = await owner.user.create({ data: { email: `${uid("counselor")}@catalog.test`, nameEn: "Counselor" } });
  counselorUser = user.id;
  users.push(user.id);
  counselor = (await owner.membership.create({ data: { orgId: demoOrg, userId: user.id } })).id;
  const role = await owner.role.create({ data: { orgId: demoOrg, key: "counselor", nameEn: "Counselor", nameAr: "مرشد", permissions: ["planner.approve", "catalog.review"] } });
  await owner.membershipRole.create({ data: { orgId: demoOrg, membershipId: counselor, roleId: role.id } });
  const student = await owner.student.create({ data: { orgId: demoOrg, studentNo: "CAT-1", firstNameEn: "Test", lastNameEn: "Student", firstNameAr: "طالب", lastNameAr: "اختبار", gradeLevel: 11 } });
  await owner.shortlistEntry.create({ data: { orgId: demoOrg, studentId: student.id, universityId: uniId, programEn: "Computer Science BSc", programId, category: "TARGET" } });

  // An earlier published version (general row) so publishing has something to close.
  const labels = await subjectLabels(owner);
  await owner.$transaction((tx) =>
    writeVersion(tx, { programId, orgId: null, group: { curriculum: null, overall: [], subjects: [], languages: [{ test: "IELTS", minOverall: 6.5, minComponent: 6, evidenceQuote: "IELTS 6.5 overall." }], tests: [], additional: [] }, confidence: "EXAMPLE", sourceId, extractionId: null, verifiedById: null, now: new Date(Date.now() - 90 * 86400_000), labels }),
  );
});

afterAll(async () => {
  server?.close();
  await owner.requirementChange.deleteMany({ where: { programId } });
  await owner.programRequirement.deleteMany({ where: { programId } });
  await owner.requirementSource.deleteMany({ where: { programId } });
  for (const orgId of [demoOrg, plainOrg]) {
    const where = { orgId };
    await owner.notification.deleteMany({ where });
    await owner.messageTemplate.deleteMany({ where });
    await owner.jobRun.deleteMany({ where });
    await owner.auditEvent.deleteMany({ where });
    await owner.shortlistEntry.deleteMany({ where });
    await owner.student.deleteMany({ where });
    await owner.membershipRole.deleteMany({ where });
    await owner.membership.deleteMany({ where });
    await owner.role.deleteMany({ where });
    await owner.organization.delete({ where: { id: orgId } });
  }
  await owner.universityProgram.deleteMany({ where: { id: programId } });
  await owner.university.deleteMany({ where: { id: uniId } });
  await owner.user.deleteMany({ where: { id: { in: users } } });
  await owner.$disconnect();
});

describe("fetch flow against a local fixture server", () => {
  it("inserts, follows redirects, extracts once, ignores cosmetic changes and detects real ones", async () => {
    const quiet = { catalog: owner, store: null, log: () => undefined };
    const first = await runCatalogRefresh({ sourceIds: [sourceId, blockedSourceId] }, quiet);
    expect(first).toMatchObject({ checked: 2, inserted: 1, failed: 1, extracted: 1 });
    const src = await owner.requirementSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(src).toMatchObject({ status: "FETCHED", lastError: null });
    expect(src.contentHash).toHaveLength(64);
    const blocked = await owner.requirementSource.findUniqueOrThrow({ where: { id: blockedSourceId } });
    expect(blocked).toMatchObject({ status: "FAILED", lastError: "robots_disallowed" });
    const ext = await owner.requirementExtraction.findFirstOrThrow({ where: { sourceId } });
    expect(ext.status).toBe("PENDING_REVIEW");
    expect((ext.normalizedJson as { meta: { finalUrl: string } }).meta.finalUrl).toBe(`${base}/page`);

    const again = await runCatalogRefresh({ sourceIds: [sourceId] }, quiet);
    expect(again).toMatchObject({ unchanged: 1, extracted: 0 });
    page = "uk-cs-cosmetic.html";
    expect(await runCatalogRefresh({ sourceIds: [sourceId] }, quiet)).toMatchObject({ unchanged: 1, extracted: 0 });
    page = "uk-cs-changed.html";
    expect(await runCatalogRefresh({ sourceIds: [sourceId] }, quiet)).toMatchObject({ changed: 1, extracted: 1 });
    expect(await owner.requirementExtraction.count({ where: { sourceId } })).toBe(2);
    expect((await owner.requirementSource.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe("CHANGED");
  });

  it("skips cleanly without an owner connection", async () => {
    expect(await runCatalogRefresh({}, { catalog: null, log: () => undefined })).toEqual({ skipped: "no_owner_url" });
  });
});

describe("publish", () => {
  it("does not let a non-demo school publish global requirements without PLATFORM_ADMIN_EMAILS", async () => {
    const prev = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = "";
    const ext = await owner.requirementExtraction.findFirstOrThrow({ where: { sourceId }, orderBy: { createdAt: "asc" } });
    const res = await approveExtraction(deps(plainOrg, false), { extractionId: ext.id });
    expect(res).toEqual({ ok: false, error: "not_platform_reviewer" });
    expect((await owner.requirementExtraction.findUniqueOrThrow({ where: { id: ext.id } })).status).toBe("PENDING_REVIEW");
    process.env.PLATFORM_ADMIN_EMAILS = prev;
  });

  it("creates new versions, closes the old one, records the change and writes an audit event", async () => {
    const ext = await owner.requirementExtraction.findFirstOrThrow({ where: { sourceId }, orderBy: { createdAt: "desc" } });
    const res = await approveExtraction({ ...deps(demoOrg, true), actor: actor(demoOrg, true, counselorUser) }, { extractionId: ext.id, note: "Checked" });
    expect(res.ok).toBe(true);
    const general = await owner.programRequirement.findMany({ where: { programId, curriculum: null }, orderBy: { version: "asc" }, include: { languages: true } });
    expect(general.map((v) => [v.version, v.isCurrent])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(general[0].effectiveTo).not.toBeNull();
    expect(general[1]).toMatchObject({ confidence: "REVIEWED", sourceId, extractionId: ext.id, verifiedById: counselorUser });
    expect(general[1].languages[0]).toMatchObject({ test: "IELTS", minOverall: 7.5, minComponent: 7 });
    expect(general[1].languages[0].evidenceQuote).toContain("IELTS 7.5");
    const british = await owner.programRequirement.findFirstOrThrow({ where: { programId, curriculum: "BRITISH", isCurrent: true } });
    expect(british).toMatchObject({ version: 1, gradeProfile: "A*A*A" });

    const change = await owner.requirementChange.findFirstOrThrow({ where: { programId, fromVersionId: general[0].id } });
    const diff = change.diff as unknown as ChangeDiff;
    expect(change.status).toBe("NEEDS_REVIEW");
    expect(diff.severity).toBe("MAJOR");
    expect(diff.entries.find((e) => e.ref.section === "language" && !("part" in e.ref && e.ref.part))).toMatchObject({ type: "THRESHOLD_RAISED", from: "6.5", to: "7.5" });
    expect(await owner.auditEvent.count({ where: { orgId: demoOrg, action: "catalog.extraction.approve", entityId: ext.id } })).toBe(1);
    expect((await owner.requirementExtraction.findUniqueOrThrow({ where: { id: ext.id } })).status).toBe("APPROVED");

    // Approving again is refused; the change id is deterministic.
    expect(await approveExtraction(deps(demoOrg, true), { extractionId: ext.id })).toEqual({ ok: false, error: "not_pending" });
  });

  it("notifies advising staff once after a change is reviewed", async () => {
    const change = await owner.requirementChange.findFirstOrThrow({ where: { programId, status: "NEEDS_REVIEW" } });
    const res = await reviewChange(deps(demoOrg, true), { changeId: change.id, outcome: "REVIEWED", note: "Confirmed" });
    expect(res).toEqual({ ok: true, notified: 1 });
    const notes = await owner.notification.findMany({ where: { orgId: demoOrg, recipientId: counselor, kind: "catalog_requirement_change" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].titleEn).toContain("Computer Science BSc");
    expect(notes[0].bodyAr).toBeTruthy();
    expect(await reviewChange(deps(demoOrg, true), { changeId: change.id, outcome: "REVIEWED" })).toEqual({ ok: false, error: "already_reviewed" });
    // The per-recipient idempotency key stops a second notice.
    const [affected] = await affectedOrgs(owner, programId);
    expect(await notifyOrgStaff(demoOrg, { id: change.id, programId, summaryEn: change.summaryEn, summaryAr: "" }, affected)).toBe(0);
    expect(await owner.notification.count({ where: { orgId: demoOrg, recipientId: counselor } })).toBe(1);
    expect(await owner.auditEvent.count({ where: { orgId: demoOrg, action: "catalog.change.review" } })).toBe(1);
  });
});
