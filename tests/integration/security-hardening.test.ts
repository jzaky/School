// Security fixes against real Postgres through the RLS-restricted app role: uploads checked by content and rate
// limited, request size limits on public endpoints, accounts whose address was never proven, the demonstration
// school's on-screen code, session revocation on sign-out, and sealing of older case notes.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ ctx: null as unknown, cookie: undefined as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "hz_applicant" && current.cookie ? { value: current.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/server/queue", () => ({ flushEffects: async () => undefined, queue: () => null }));
vi.mock("@/server/context", () => ({ getCtx: async () => current.ctx, getOptionalCtx: async () => current.ctx, requirePermission: async () => current.ctx }));

import { rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";
import type { PrismaClient } from "@prisma/client";
import { tenantDb } from "@/lib/tenant-db";
import { can, permissionsOf, roleKeysOf } from "@/server/identity/can";
import type { Ctx } from "@/server/context";
import { POST as upload } from "@/app/api/uploads/route";
import { POST as paymentWebhook } from "@/app/api/payments/webhook/[provider]/route";
import { addStaffAction } from "@/server/admin/people-actions";
import { resolveAccount } from "@/server/access/join";
import { releaseUnprovenPassword } from "@/server/identity/unproven-account";
import { confirmEmailCode, currentApplicant, issueEmailCode, makeApplicantToken } from "@/server/admissions/applicant";
import { revokeSessionId, sessionIdRevoked } from "@/server/sso/session-revocation";
import { sealLegacyCaseNotes } from "@/server/cases/note-encryption";
import { isSealed, openText } from "@/lib/sealed-text";
import { getObject } from "@/server/documents/storage-core";
import { installStarterTemplate } from "../../prisma/seed/starter";
import { ownerClient, uid } from "./helpers";

let owner: PrismaClient;
let orgId = "";
const m: Record<string, string> = {};

async function ctxFor(membershipId: string): Promise<Ctx> {
  const membership = await owner.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { roles: { include: { role: true } }, staffProfile: true, student: true, guardian: { include: { links: { include: { student: true } } } } } });
  const user = await owner.user.findUniqueOrThrow({ where: { id: membership.userId } });
  const org = await owner.organization.findUniqueOrThrow({ where: { id: membership.orgId } });
  const roles = roleKeysOf(membership);
  const isParent = roles.includes("parent");
  return { orgId: org.id, db: tenantDb(org.id), org, user, membership, membershipId, roles, perms: permissionsOf(membership), locale: "en", persona: null, isStudent: false, isParent, isStaff: !isParent, can: (p) => can(membership, p), session: null as never } as Ctx;
}

async function member(key: string, role: string) {
  const u = await owner.user.create({ data: { email: `${uid(key)}@harden.test`, nameEn: `Person ${key}`, emailVerified: new Date() } });
  const mem = await owner.membership.create({ data: { orgId, userId: u.id, status: "ACTIVE" } });
  const r = await owner.role.findFirstOrThrow({ where: { orgId, key: role } });
  await owner.membershipRole.create({ data: { orgId, membershipId: mem.id, roleId: r.id } });
  if (role !== "parent") await owner.staffProfile.create({ data: { orgId, membershipId: mem.id } });
  m[key] = mem.id;
}

function uploadRequest(name: string, bytes: Uint8Array | string, type = "") {
  const fd = new FormData();
  fd.set("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type }));
  return new Request("http://localhost/api/uploads", { method: "POST", body: fd });
}

beforeAll(async () => {
  owner = ownerClient();
  const org = await owner.organization.create({ data: { slug: uid("harden"), nameEn: "Hardening Test School", nameAr: "مدرسة الاختبار", emirate: "Sharjah", curricula: ["AMERICAN"] } });
  orgId = org.id;
  await installStarterTemplate(owner, orgId, { curricula: ["AMERICAN"], locale: "en", now: new Date(), installCourses: false });
  await member("admin", "school_admin");
  await member("parent", "parent");
}, 120_000);

afterAll(async () => {
  await rm(path.join(process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), ".uploads"), orgId), { recursive: true, force: true });
  await owner.$disconnect();
});

describe("uploads", () => {
  it("stores a real PDF under a rebuilt name with the type found in its content", async () => {
    current.ctx = await ctxFor(m.parent);
    const res = await upload(uploadRequest("../../doctor's note.pdf", "%PDF-1.4\n1 0 obj << >> endobj\n%%EOF", "text/html"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; name: string; type: string };
    expect(body.type).toBe("application/pdf");
    expect(body.name).toBe("doctor-s-note.pdf");
    expect(body.key.startsWith(`local:${orgId}/`) || body.key.startsWith(`r2:${orgId}/`)).toBe(true);
    expect(body.key.endsWith(".pdf")).toBe(true);
    if (body.key.startsWith("local:")) expect((await getObject(body.key))?.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("refuses HTML, SVG and scripts whatever name or type they claim, and PDFs that run code", async () => {
    current.ctx = await ctxFor(m.parent);
    expect((await upload(uploadRequest("report.pdf", "<html><body><script>alert(1)</script></body></html>", "application/pdf"))).status).toBe(415);
    expect((await upload(uploadRequest("logo.png", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "image/png"))).status).toBe(415);
    expect((await upload(uploadRequest("note.pdf", "MZ\x90\x00\x03\x00\x00\x00\x04\x00", ""))).status).toBe(415);
    const js = await upload(uploadRequest("form.pdf", "%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>", "application/pdf"));
    expect(js.status).toBe(415);
    expect(await js.json()).toEqual({ error: "active_content" });
  });

  it("refuses a file over the limit before reading all of it", async () => {
    current.ctx = await ctxFor(m.parent);
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set(Buffer.from("%PDF-1.4\n"));
    const res = await upload(uploadRequest("big.pdf", big, "application/pdf"));
    expect(res.status).toBe(413);
  });

  it("needs a session", async () => {
    current.ctx = null;
    expect((await upload(uploadRequest("note.pdf", "%PDF-1.4\n%%EOF"))).status).toBe(401);
  });
});

describe("public endpoint size limits", () => {
  it("the payments webhook refuses an oversized body", async () => {
    const res = await paymentWebhook(new Request("http://localhost/api/payments/webhook/console", { method: "POST", body: "x".repeat(300 * 1024) }), { params: Promise.resolve({ provider: "console" }) });
    expect(res.status).toBe(413);
  });
});

describe("accounts whose address was never proven", () => {
  it("lose a password they set themselves when the school adds that address, and their sessions end", async () => {
    const email = `${uid("future-staff")}@harden.test`;
    const squatter = await owner.user.create({ data: { email, nameEn: "Someone", passwordHash: await bcrypt.hash("chosen-by-someone-else", 4) } });
    current.ctx = await ctxFor(m.admin);
    const res = await addStaffAction({ email, nameEn: "New Teacher", nameAr: "", titleEn: "", titleAr: "", departmentId: null, roleKeys: ["teacher"], status: "ACTIVE" } as never);
    expect(res.ok).toBe(true);
    const after = await owner.user.findUniqueOrThrow({ where: { id: squatter.id } });
    expect(after.passwordHash).toBeNull();
    expect(after.sessionsValidFrom).not.toBeNull();
  });

  it("keep their password when the address was verified", async () => {
    const u = await owner.user.create({ data: { email: `${uid("verified")}@harden.test`, nameEn: "Verified", passwordHash: "x", emailVerified: new Date() } });
    expect(await releaseUnprovenPassword(u.id)).toBe(false);
    expect((await owner.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash).toBe("x");
  });

  it("an invitation to that address lets the invited person set their own password", async () => {
    const email = `${uid("invited")}@harden.test`;
    await owner.user.create({ data: { email, nameEn: "Someone", passwordHash: await bcrypt.hash("chosen-by-someone-else", 4) } });
    const acc = await resolveAccount({ mode: "create", name: "Real Person", email, password: "my-own-password-1" }, { ip: "203.0.113.5", provenEmail: email });
    const u = await owner.user.findUniqueOrThrow({ where: { id: acc.userId } });
    expect(await bcrypt.compare("my-own-password-1", u.passwordHash!)).toBe(true);
    expect(await bcrypt.compare("chosen-by-someone-else", u.passwordHash!)).toBe(false);
    expect(u.emailVerified).not.toBeNull();
    expect(u.sessionsValidFrom).not.toBeNull();
  });

  it("without an invitation the existing password still has to match", async () => {
    const email = `${uid("noinvite")}@harden.test`;
    await owner.user.create({ data: { email, nameEn: "Someone", passwordHash: await bcrypt.hash("first-password-1", 4) } });
    await expect(resolveAccount({ mode: "create", name: "Other", email, password: "different-pass-2" }, { ip: "203.0.113.6" })).rejects.toThrow();
  });
});

describe("the demonstration school's on-screen code", () => {
  it("counts only in that school's application pages and never verifies the account", async () => {
    const u = await owner.user.create({ data: { email: `${uid("demo-applicant")}@harden.test`, nameEn: "Applicant" } });
    const code = await issueEmailCode(u.id);
    expect(await confirmEmailCode(u.id, code, new Date(), { markVerified: false })).toBe(true);
    expect((await owner.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerified).toBeNull();
    current.cookie = makeApplicantToken(u.id, null, Date.now(), "demo-school-id");
    expect((await currentApplicant("demo-school-id"))?.verified).toBe(true);
    expect((await currentApplicant("another-school-id"))?.verified).toBe(false);
    expect((await currentApplicant())?.verified).toBe(false);
    current.cookie = undefined;
  });
});

describe("sign-out", () => {
  it("records the session id as ended", async () => {
    const sid = uid("sid");
    expect(await sessionIdRevoked(sid)).toBe(false);
    await revokeSessionId(sid);
    expect(await sessionIdRevoked(sid)).toBe(true);
    expect(await sessionIdRevoked(uid("other"))).toBe(false);
  });
});

describe("case notes written before encryption", () => {
  it("are sealed once by the migration step and stay readable", async () => {
    const student = await owner.student.create({ data: { orgId, studentNo: uid("S"), firstNameEn: "A", lastNameEn: "B", firstNameAr: "أ", lastNameAr: "ب", gradeLevel: 8 } });
    const c = await owner.case.create({ data: { orgId, number: uid("C"), type: "ACADEMIC", studentId: student.id, titleEn: "T", titleAr: "ت" } });
    const note = await owner.caseNote.create({ data: { orgId, caseId: c.id, authorId: m.admin } });
    const v = await owner.caseNoteVersion.create({ data: { orgId, noteId: note.id, version: 1, body: "Plain text written before encryption.", editedById: m.admin } });
    const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await client.connect();
    try {
      const query = (sql: string, params?: unknown[]) => client.query(sql, params as unknown[]);
      expect(await sealLegacyCaseNotes(query)).toBeGreaterThanOrEqual(1);
      const stored = (await owner.caseNoteVersion.findUniqueOrThrow({ where: { id: v.id } })).body;
      expect(isSealed(stored)).toBe(true);
      expect(stored).not.toContain("Plain text");
      expect(openText(stored)).toBe("Plain text written before encryption.");
      // A second run finds nothing left to do.
      expect(await sealLegacyCaseNotes(query)).toBe(0);
      expect(await sealLegacyCaseNotes(query, { env: {} as NodeJS.ProcessEnv })).toBeNull();
    } finally {
      await client.end();
    }
  });
});
