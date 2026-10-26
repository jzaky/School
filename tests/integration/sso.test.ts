// Single sign-on, email links and password reset against a local mock identity provider and real Postgres
// (through the RLS-restricted app role): the flow checks (state, nonce, PKCE, ID token), the linking rules
// (verified email, tenants, domains, self-join, no relinking, no linking across schools) and single-use tokens.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { encryptField } from "@/lib/crypto";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { beginSso, completeSso, FlowError, type NormalizedIdentity } from "@/server/sso/flow";
import { clearDiscoveryCache, providerConfig, type FlowProvider } from "@/server/sso/providers";
import { resolveSignIn } from "@/server/sso/link";
import { loadPolicy } from "@/server/sso/policy";
import { issueTicket, redeemTicket } from "@/server/sso/ticket";
import { requestMagicLink, redeemMagicLink } from "@/server/sso/magic-link";
import { requestPasswordReset, resetPassword, resetLinkValid } from "@/server/sso/password-reset";
import { sessionRevoked } from "@/server/sso/session-revocation";
import { approve, startMockIdp, type MockIdp } from "../../scripts/lib/mock-idp";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();
let idp: MockIdp;
type School = { orgId: string; slug: string; roleIds: Record<string, string> };
let A: School;
let B: School;
const ip = () => `sso-${uid("ip")}`;
const DOMAIN = "sso-school.test";

async function makeSchool(label: string): Promise<School> {
  const slug = uid(`sso-${label.toLowerCase()}`);
  const org = await owner.organization.create({ data: { slug, nameEn: `SSO School ${label}`, nameAr: `مدرسة الدخول ${label}` } });
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const row = await owner.role.create({ data: { orgId: org.id, key: r.key, nameEn: r.nameEn, nameAr: r.nameAr, descEn: r.descEn, descAr: r.descAr, permissions: r.permissions } });
    roleIds[r.key] = row.id;
  }
  return { orgId: org.id, slug, roleIds };
}

async function member(s: School, email: string, role: string, opts: { status?: "ACTIVE" | "INVITED" | "SUSPENDED"; password?: string } = {}) {
  const user = (await owner.user.findUnique({ where: { email } })) ?? (await owner.user.create({ data: { email, nameEn: "Test Person", passwordHash: opts.password ? await bcrypt.hash(opts.password, 4) : null } }));
  const m = await owner.membership.create({ data: { orgId: s.orgId, userId: user.id, status: opts.status ?? "ACTIVE" } });
  await owner.membershipRole.create({ data: { orgId: s.orgId, membershipId: m.id, roleId: s.roleIds[role] } });
  if (role === "parent") await owner.guardian.create({ data: { orgId: s.orgId, membershipId: m.id, firstNameEn: "P", lastNameEn: "T", firstNameAr: "", lastNameAr: "", email } });
  else if (role !== "student") await owner.staffProfile.create({ data: { orgId: s.orgId, membershipId: m.id } });
  return { userId: user.id, membershipId: m.id };
}

async function setPolicy(s: School, data: Record<string, unknown>) {
  await owner.signInPolicy.upsert({ where: { orgId: s.orgId }, create: { orgId: s.orgId, methods: ["password"], ...data }, update: data });
}

const email = (p: string) => `${uid(p)}@${DOMAIN}`;

function identity(over: Partial<NormalizedIdentity>): NormalizedIdentity {
  return { provider: "oidc", subject: uid("sub"), email: null, emailVerified: true, name: "Test Person", givenName: null, familyName: null, tenant: null, externalId: null, role: null, emiratesId: null, assurance: null, ...over };
}

async function runFlow(provider: FlowProvider, s: School | null, tweak?: (url: URL) => void) {
  const policy = s ? await loadPolicy(s.orgId) : null;
  const cfg = await providerConfig(provider, policy);
  const begun = beginSso(cfg, { orgId: s?.orgId ?? null, locale: "en", returnTo: "/en/home", redirectUri: "https://app.test/api/sso/cb" });
  const url = new URL(begun.url);
  tweak?.(url);
  const query = await approve(url.toString());
  return { cfg, begun, query, complete: (q = query, cookie = begun.cookie) => completeSso(cfg, { query: q, cookie }) };
}

beforeAll(async () => {
  process.env.REDIS_URL = "";
  process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS = "true";
  process.env.RESEND_API_KEY = "test-key";
  idp = await startMockIdp();
  Object.assign(process.env, {
    CLASSLINK_CLIENT_ID: idp.clients.classlink.id,
    CLASSLINK_CLIENT_SECRET: idp.clients.classlink.secret,
    CLASSLINK_ISSUER: `${idp.base}/classlink`,
    CLEVER_CLIENT_ID: idp.clients.clever.id,
    CLEVER_CLIENT_SECRET: idp.clients.clever.secret,
    CLEVER_OAUTH_BASE: `${idp.base}/clever`,
    CLEVER_API_BASE: `${idp.base}/clever-api`,
    UAEPASS_CLIENT_ID: idp.clients.uaepass.id,
    UAEPASS_CLIENT_SECRET: idp.clients.uaepass.secret,
    UAEPASS_BASE: `${idp.base}/uaepass/idshub`,
    AUTH_MICROSOFT_ENTRA_ID_ID: "ms-test",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "ms-test",
    AUTH_GOOGLE_ID: "google-test",
    AUTH_GOOGLE_SECRET: "google-test",
  });
  // Tenant ids are unique across schools: clear any left by an interrupted earlier run.
  await owner.signInPolicy.deleteMany({ where: { OR: [{ classlinkTenantId: { in: ["1234", "5678"] } }, { cleverDistrictId: "district-1" }] } });
  A = await makeSchool("A");
  B = await makeSchool("B");
  const oidc = { oidcIssuer: `${idp.base}/oidc`, oidcClientId: idp.clients.oidc.id, oidcSecretEnc: encryptField(idp.clients.oidc.secret) };
  await setPolicy(A, { methods: ["password", "magic_link", "classlink", "clever", "uaepass", "oidc", "google", "microsoft"], classlinkTenantId: "1234", cleverDistrictId: "district-1", ...oidc });
  await setPolicy(B, { methods: ["password", "oidc", "classlink"], classlinkTenantId: "5678", ...oidc });
});

beforeEach(() => {
  idp.tamper = {};
  clearDiscoveryCache();
});

afterAll(async () => {
  await idp?.close();
  for (const s of [A, B]) {
    if (!s) continue;
    for (const t of ["SignInPolicy", "SsoIdentity", "RosterLink"]) await owner.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "orgId" = $1`, s.orgId);
    await owner.organization.delete({ where: { id: s.orgId } }).catch(() => undefined);
  }
  await owner.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await owner.user.deleteMany({ where: { email: { endsWith: "@other-sso.test" } } });
  await owner.$disconnect();
});

describe("authorization code flow", () => {
  it("completes an OpenID Connect sign-in with state, nonce and PKCE", async () => {
    const f = await runFlow("oidc", A);
    const sent = idp.lastAuthorize.oidc;
    expect(sent.state).toBe(f.begun.state.s);
    expect(sent.nonce).toBe(f.begun.state.n);
    expect(sent.code_challenge_method).toBe("S256");
    expect(sent.code_challenge).toBe(createHash("sha256").update(f.begun.state.v!).digest("base64url"));
    const { identity: id } = await f.complete();
    expect(id).toMatchObject({ provider: "oidc", subject: "oidc-sub-1", email: "staff@school.test", emailVerified: true });
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const f = await runFlow("oidc", A);
    const q = new URLSearchParams(f.query);
    q.set("state", "forged-state-value-000000000");
    await expect(f.complete(q)).rejects.toMatchObject({ code: "STATE_MISMATCH" });
  });

  it("rejects a callback without the flow cookie, or with another provider's cookie", async () => {
    const f = await runFlow("oidc", A);
    await expect(f.complete(f.query, "")).rejects.toMatchObject({ code: "STATE_MISSING" });
    await expect(f.complete(f.query, "garbage.value.here")).rejects.toMatchObject({ code: "STATE_MISSING" });
    const other = await runFlow("classlink", A);
    await expect(f.complete(f.query, other.begun.cookie)).rejects.toBeInstanceOf(FlowError);
  });

  it("rejects an ID token with another nonce, issuer, audience, an expiry in the past or a bad signature", async () => {
    for (const [tamper, code] of [
      [{ nonce: "not-our-nonce" }, "NONCE_MISMATCH"],
      [{ dropNonce: true }, "NONCE_MISMATCH"],
      [{ iss: "https://evil.test" }, "ID_TOKEN_INVALID"],
      [{ aud: "someone-else" }, "ID_TOKEN_INVALID"],
      [{ expired: true }, "ID_TOKEN_INVALID"],
      [{ badSignature: true }, "ID_TOKEN_INVALID"],
      [{ alg: "none" }, "ID_TOKEN_INVALID"],
      [{ alg: "HS256" }, "ID_TOKEN_INVALID"],
      [{ userinfoSub: "someone-else" }, "SUBJECT_MISMATCH"],
      [{ noIdToken: true }, "ID_TOKEN_MISSING"],
    ] as const) {
      idp.tamper = { ...tamper };
      const f = await runFlow("oidc", A);
      await expect(f.complete(), JSON.stringify(tamper)).rejects.toMatchObject({ code });
    }
  });

  it("refuses a provider error and a missing code", async () => {
    const f = await runFlow("oidc", A);
    await expect(f.complete(new URLSearchParams({ error: "access_denied", state: f.begun.state.s }))).rejects.toMatchObject({ code: "PROVIDER_DENIED" });
    await expect(f.complete(new URLSearchParams({ state: f.begun.state.s }))).rejects.toMatchObject({ code: "CODE_MISSING" });
  });

  it("a code cannot be exchanged twice", async () => {
    const f = await runFlow("oidc", A);
    await f.complete();
    await expect(f.complete()).rejects.toMatchObject({ code: "TOKEN_EXCHANGE" });
  });

  it("reads ClassLink's tenant, sourcedId and role", async () => {
    const f = await runFlow("classlink", A);
    expect(idp.lastAuthorize.classlink.code_challenge).toBeUndefined();
    const { identity: id } = await f.complete();
    expect(id).toMatchObject({ provider: "classlink", tenant: "1234", externalId: "t-1", role: "teacher", email: "teacher@school.test" });
  });

  it("reads Clever's district and user through /me, sending the school's district id", async () => {
    const f = await runFlow("clever", A, (u) => u.searchParams.set("district_id", "district-1"));
    expect(idp.lastAuthorize.clever.district_id).toBe("district-1");
    const { identity: id } = await f.complete();
    expect(id).toMatchObject({ provider: "clever", subject: "clever-user-1", tenant: "district-1", externalId: "clever-user-1", role: "teacher" });
  });

  it("reads UAE PASS user info with the assurance level and Emirates ID, and asks for the documented acr", async () => {
    const f = await runFlow("uaepass", A);
    expect(idp.lastAuthorize.uaepass.scope).toBe("urn:uae:digitalid:profile:general");
    expect(idp.lastAuthorize.uaepass.acr_values).toBe("urn:safelayer:tws:policies:authentication:level:low");
    expect(idp.lastAuthorize.uaepass.nonce).toBeUndefined();
    const { identity: id } = await f.complete();
    expect(id).toMatchObject({ provider: "uaepass", subject: "uuid-1", assurance: "SOP3", emailVerified: true, emiratesId: "784201012345671" });
  });
});

describe("linking rules", () => {
  it("links a first sign-in by verified email, then signs in by the link", async () => {
    const e = email("teacher");
    const m = await member(A, e, "teacher");
    const sub = uid("sub");
    const first = await resolveSignIn(A.orgId, identity({ subject: sub, email: e }));
    expect(first).toMatchObject({ ok: true, membershipId: m.membershipId, linkedVia: "email" });
    const again = await resolveSignIn(A.orgId, identity({ subject: sub, email: null, emailVerified: false }));
    expect(again).toMatchObject({ ok: true, membershipId: m.membershipId, linkedVia: null });
    const audits = await owner.auditEvent.findMany({ where: { orgId: A.orgId, entityId: m.membershipId, action: { in: ["auth.sso_linked", "auth.sign_in"] } } });
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audits.map((a) => a.meta))).not.toContain(e);
  });

  it("does not create an account for an unknown person", async () => {
    const r = await resolveSignIn(A.orgId, identity({ email: email("stranger") }));
    expect(r).toMatchObject({ ok: false, code: "NOT_PROVISIONED" });
  });

  it("does not link an unverified address", async () => {
    const e = email("unverified");
    await member(A, e, "teacher");
    const r = await resolveSignIn(A.orgId, identity({ email: e, emailVerified: false }));
    expect(r).toMatchObject({ ok: false, code: "EMAIL_UNVERIFIED" });
  });

  it("lets unknown staff self-join only on the school's chosen domains, waiting for approval", async () => {
    await setPolicy(A, { selfJoinDomains: [DOMAIN], selfJoinApproval: true });
    const e = email("newstaff");
    const r = await resolveSignIn(A.orgId, identity({ email: e }));
    expect(r).toMatchObject({ ok: true, status: "PENDING_APPROVAL", linkedVia: "self_join", created: true });
    if (r.ok) expect(await owner.joinRequest.count({ where: { membershipId: r.membershipId, status: "PENDING" } })).toBe(1);
    const other = await resolveSignIn(A.orgId, identity({ email: `${uid("x")}@other-sso.test` }));
    expect(other).toMatchObject({ ok: false, code: "NOT_PROVISIONED" });
    await setPolicy(A, { selfJoinDomains: [] });
  });

  it("never relinks a member to a second account of the same provider", async () => {
    const e = email("relink");
    await member(A, e, "teacher");
    expect(await resolveSignIn(A.orgId, identity({ subject: uid("s1"), email: e }))).toMatchObject({ ok: true });
    expect(await resolveSignIn(A.orgId, identity({ subject: uid("s2"), email: e }))).toMatchObject({ ok: false, code: "IDENTITY_TAKEN" });
  });

  it("refuses when the roster id and the email point at different members", async () => {
    const e1 = email("x1");
    const e2 = email("x2");
    const m1 = await member(A, e1, "teacher");
    await member(A, e2, "teacher");
    const ext = uid("ext");
    await owner.rosterLink.create({ data: { orgId: A.orgId, provider: "classlink", kind: "staff", externalId: ext, localId: m1.membershipId, hash: "h" } });
    const r = await resolveSignIn(A.orgId, identity({ provider: "classlink", tenant: "1234", externalId: ext, email: e2, emailVerified: false }));
    expect(r).toMatchObject({ ok: false, code: "LINK_CONFLICT" });
    const byExt = await resolveSignIn(A.orgId, identity({ provider: "classlink", tenant: "1234", externalId: ext, email: e1, emailVerified: false }));
    expect(byExt).toMatchObject({ ok: true, membershipId: m1.membershipId, linkedVia: "external_id" });
  });

  it("only accepts ClassLink sign-ins from the school's own tenant", async () => {
    const e = email("tenant");
    await member(A, e, "teacher");
    expect(await resolveSignIn(A.orgId, identity({ provider: "classlink", tenant: "9999", email: e }))).toMatchObject({ ok: false, code: "WRONG_TENANT" });
  });

  it("keeps links per school: an identity linked in one school opens nothing in another", async () => {
    const e = email("twoschools");
    const a = await member(A, e, "teacher");
    const sub = uid("shared");
    expect(await resolveSignIn(A.orgId, identity({ subject: sub, email: e }))).toMatchObject({ ok: true, orgId: A.orgId, membershipId: a.membershipId });
    // Not a member of B: the link in A does not carry over.
    expect(await resolveSignIn(B.orgId, identity({ subject: sub, email: e }))).toMatchObject({ ok: false, code: "NOT_PROVISIONED" });
    // Once B adds the person, B makes its own link to B's membership.
    const b = await member(B, e, "teacher");
    expect(await resolveSignIn(B.orgId, identity({ subject: sub, email: e }))).toMatchObject({ ok: true, orgId: B.orgId, membershipId: b.membershipId });
    const links = await owner.ssoIdentity.findMany({ where: { subject: sub } });
    expect(links.map((l) => l.orgId).sort()).toEqual([A.orgId, B.orgId].sort());
  });

  it("applies the allowed domains to staff but not to parents", async () => {
    await setPolicy(A, { allowedDomains: ["only-this.test"] });
    const staff = email("domainstaff");
    await member(A, staff, "teacher");
    expect(await resolveSignIn(A.orgId, identity({ email: staff }))).toMatchObject({ ok: false, code: "DOMAIN_NOT_ALLOWED" });
    const parent = email("domainparent");
    await member(A, parent, "parent");
    expect(await resolveSignIn(A.orgId, identity({ email: parent }))).toMatchObject({ ok: true });
    await setPolicy(A, { allowedDomains: [] });
  });

  it("refuses suspended members, switched-off options and low-assurance UAE PASS accounts", async () => {
    const e = email("suspended");
    await member(A, e, "teacher", { status: "SUSPENDED" });
    expect(await resolveSignIn(A.orgId, identity({ email: e }))).toMatchObject({ ok: false, code: "SUSPENDED" });
    expect(await resolveSignIn(B.orgId, identity({ provider: "uaepass", email: e }))).toMatchObject({ ok: false, code: "METHOD_OFF" });
    expect(await resolveSignIn(A.orgId, identity({ provider: "uaepass", assurance: "SOP1", email: email("sop1") }))).toMatchObject({ ok: false, code: "LOW_ASSURANCE" });
  });

  it("activates invited staff when their school's directory confirms them", async () => {
    const e = email("invited");
    const m = await member(A, e, "teacher", { status: "INVITED" });
    const r = await resolveSignIn(A.orgId, identity({ provider: "classlink", tenant: "1234", email: e, emailVerified: false }));
    expect(r).toMatchObject({ ok: true, status: "ACTIVE" });
    expect((await owner.membership.findUnique({ where: { id: m.membershipId } }))?.status).toBe("ACTIVE");
  });

  it("does not trust a Microsoft address from another organisation's tenant", async () => {
    const e = email("ms");
    await member(A, e, "teacher");
    const r = await resolveSignIn(A.orgId, identity({ provider: "microsoft", email: e, emailVerified: false, tenant: "11111111-2222-3333-4444-555555555555" }), { msTenant: "11111111-2222-3333-4444-555555555555" });
    expect(r).toMatchObject({ ok: false, code: "EMAIL_UNVERIFIED" });
    const ok = await resolveSignIn(A.orgId, identity({ provider: "microsoft", email: e, emailVerified: false }), { msTenant: "x", msVerifiedDomain: true });
    expect(ok).toMatchObject({ ok: true });
  });

  it("matches UAE PASS by the Emirates ID on the student record", async () => {
    const e = `${uid("student")}@${DOMAIN}`;
    const m = await member(A, e, "student");
    await owner.student.create({ data: { orgId: A.orgId, membershipId: m.membershipId, studentNo: uid("S"), firstNameEn: "S", lastNameEn: "T", firstNameAr: "", lastNameAr: "", gradeLevel: 10, emiratesIdEnc: encryptField("784-2009-7654321-5"), emiratesIdLast4: "4321" } });
    const r = await resolveSignIn(A.orgId, identity({ provider: "uaepass", assurance: "SOP3", email: `${uid("other")}@other-sso.test`, emiratesId: "784200976543215" }));
    expect(r).toMatchObject({ ok: true, membershipId: m.membershipId, linkedVia: "emirates_id" });
    const audit = await owner.auditEvent.findFirst({ where: { orgId: A.orgId, action: "auth.sso_linked", entityId: m.membershipId } });
    expect(JSON.stringify(audit?.meta)).not.toContain("7654321");
  });
});

describe("one-time tokens", () => {
  it("a sign-in ticket works once", async () => {
    const m = await member(A, email("ticket"), "teacher");
    const raw = await issueTicket({ userId: m.userId, orgId: A.orgId, membershipId: m.membershipId, method: "classlink" });
    expect(await redeemTicket(raw)).toMatchObject({ userId: m.userId, orgId: A.orgId, membershipId: m.membershipId });
    expect(await redeemTicket(raw)).toBeNull();
    const old = await issueTicket({ userId: m.userId, orgId: A.orgId, membershipId: m.membershipId, method: "classlink" }, new Date(Date.now() - 10 * 60_000));
    expect(await redeemTicket(old)).toBeNull();
  });

  it("email links: same answer for unknown addresses, single use, and blocked for staff who must use single sign-on", async () => {
    const e = email("magic");
    const m = await member(A, e, "parent");
    const unknown = await requestMagicLink({ email: email("nobody"), orgId: A.orgId, locale: "en", ip: ip(), minMs: 0 });
    expect(unknown.sent).toBe(false);
    const sent = await requestMagicLink({ email: e, orgId: A.orgId, locale: "en", ip: ip(), minMs: 0 });
    expect(sent.sent).toBe(true);
    const row = await owner.verificationToken.findFirst({ where: { identifier: `magic:${m.userId}:${A.orgId}` } });
    expect(row).not.toBeNull();
    // Only the hash is stored, so the link itself cannot be read back from the database. Plant a known one.
    const raw = uid("magic-raw-token-for-the-test-0000000");
    await owner.verificationToken.update({ where: { identifier_token: { identifier: row!.identifier, token: row!.token } }, data: { token: createHash("sha256").update(raw).digest("hex") } });
    expect(await redeemMagicLink(raw, { ip: ip() })).toMatchObject({ userId: m.userId, orgId: A.orgId, membershipId: m.membershipId });
    expect(await redeemMagicLink(raw, { ip: ip() })).toBeNull();

    await setPolicy(A, { staffSsoRequired: true });
    const staff = email("magicstaff");
    await member(A, staff, "teacher");
    expect(await requestMagicLink({ email: staff, orgId: A.orgId, locale: "en", ip: ip(), minMs: 0 })).toMatchObject({ sent: false, reason: "NOT_ALLOWED" });
    await setPolicy(A, { staffSsoRequired: false });
  });

  it("limits email link requests per address", async () => {
    const e = email("magiclimit");
    await member(A, e, "parent");
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await requestMagicLink({ email: e, orgId: A.orgId, locale: "en", ip: ip(), minMs: 0 }));
    expect(results.filter((r) => r.reason === "RATE_LIMITED").length).toBe(2);
  });
});

describe("password reset", () => {
  it("resets with a single-use link, keeps the link on a weak password, and ends older sessions", async () => {
    const e = email("reset");
    const m = await member(A, e, "parent", { password: "Old-password-1" });
    expect((await requestPasswordReset({ email: email("ghost"), locale: "ar", ip: ip(), minMs: 0 })).sent).toBe(false);
    expect((await requestPasswordReset({ email: e, locale: "ar", ip: ip(), minMs: 0 })).sent).toBe(true);
    const row = await owner.verificationToken.findFirst({ where: { identifier: `pwreset:${m.userId}` } });
    expect(row?.expires.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect(row?.expires.getTime()).toBeLessThan(Date.now() + 61 * 60_000);
    const raw = uid("reset-raw-token-for-the-test-00000000");
    await owner.verificationToken.update({ where: { identifier_token: { identifier: row!.identifier, token: row!.token } }, data: { token: createHash("sha256").update(raw).digest("hex") } });
    expect(await resetLinkValid(raw)).toBe(true);
    expect(await resetPassword({ token: raw, password: "short", ip: ip(), locale: "en" })).toMatchObject({ ok: false, code: "WEAK" });
    const before = Date.now() - 1000;
    expect(await resetPassword({ token: raw, password: "New-garden-2026", ip: ip(), locale: "en" })).toEqual({ ok: true });
    expect(await resetPassword({ token: raw, password: "New-garden-2026", ip: ip(), locale: "en" })).toMatchObject({ ok: false, code: "INVALID" });
    const user = await owner.user.findUnique({ where: { id: m.userId } });
    expect(await bcrypt.compare("New-garden-2026", user!.passwordHash!)).toBe(true);
    expect(sessionRevoked(user!.sessionsValidFrom, before)).toBe(true);
    expect(sessionRevoked(user!.sessionsValidFrom, Date.now() + 1000)).toBe(false);
    expect(await owner.auditEvent.count({ where: { orgId: A.orgId, action: "auth.password_reset", entityId: m.membershipId } })).toBe(1);
    expect(await owner.outboundMessage.count({ where: { orgId: A.orgId, templateKey: "password_reset", to: e } })).toBe(2);
  });

  it("tells staff who must use single sign-on to use it, with the same answer on screen", async () => {
    await setPolicy(A, { staffSsoRequired: true });
    const e = email("ssostaff");
    const m = await member(A, e, "teacher", { password: "Old-password-1" });
    const r = await requestPasswordReset({ email: e, locale: "en", ip: ip(), minMs: 0 });
    expect(r).toMatchObject({ sent: true, reason: "SSO_ONLY" });
    expect(await owner.verificationToken.count({ where: { identifier: `pwreset:${m.userId}` } })).toBe(0);
    await setPolicy(A, { staffSsoRequired: false });
  });

  it("limits reset requests per address", async () => {
    const e = email("resetlimit");
    await member(A, e, "parent");
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await requestPasswordReset({ email: e, locale: "en", ip: ip(), minMs: 0 }));
    expect(results.filter((r) => r.reason === "RATE_LIMITED").length).toBe(2);
  });
});
