// Who a single sign-on belongs to, and whether they may come in. Shared by every provider (ClassLink, Clever,
// UAE PASS, school OpenID Connect, and Google and Microsoft through Auth.js).
//
// Rules (docs/guides/sign-in.md explains them for schools):
// 1. The school must offer the option, and ClassLink and Clever sign-ins must come from the school's own tenant or
//    district. A sign-in from the school's own directory vouches for its addresses inside that school only.
// 2. An identity already linked in this school signs in as that member. Links are per school: a link made in one
//    school never opens another, and the session opened by a single sign-on is locked to that school.
// 3. A first sign-in finds the existing member by roster external id or by email (the school chooses), and only
//    with a verified address: verified by the provider (Google, Microsoft personal accounts or a verified Entra
//    domain, UAE PASS SOP2 and SOP3) or vouched for by the school's own directory. UAE PASS can also match by the
//    Emirates ID on the student record (compared after decryption, never stored or logged).
// 4. A member already linked to a different account of the same provider is refused (no silent relinking), and so
//    is an external id and an email that point at two different members.
// 5. Staff and student addresses must be on the school's allowed domains when it lists any.
// 6. Nobody unknown gets an account unless the school allows self-join for their verified domain; then they join
//    as staff, waiting for approval unless the school turned approval off.
// Every outcome writes an audit event with the provider, the result and how the link was made. No email, name or
// identifier goes into the audit meta or any log.
import { createHash } from "node:crypto";
import type { MembershipStatus } from "@prisma/client";
import { identityDb, tenantDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { decryptField } from "@/lib/crypto";
import { audit } from "@/server/audit/audit";
import { JoinError, ensureMembership, ensureStaffProfile, grantRoles, rolesByKeys } from "@/server/access/membership-setup";
import { domainOf, loadPolicy, methodAvailable, type Policy } from "./policy";
import type { NormalizedIdentity } from "./flow";
import type { SignInMethod } from "./providers";

export type RefusalCode =
  | "NO_SCHOOL"
  | "METHOD_OFF"
  | "WRONG_TENANT"
  | "NO_EMAIL"
  | "EMAIL_UNVERIFIED"
  | "LOW_ASSURANCE"
  | "DOMAIN_NOT_ALLOWED"
  | "NOT_PROVISIONED"
  | "SUSPENDED"
  | "IDENTITY_TAKEN"
  | "LINK_CONFLICT";

export type SignInOutcome =
  | { ok: true; orgId: string; userId: string; membershipId: string; status: "ACTIVE" | "PENDING_APPROVAL"; linkedVia: string | null; created: boolean }
  | { ok: false; code: RefusalCode; orgId: string | null };

const MS_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/** Which roster feed a provider's external ids come from. */
const ROSTER_NAMESPACE: Partial<Record<NormalizedIdentity["provider"], string>> = { classlink: "classlink", clever: "clever" };

type Member = { id: string; userId: string; status: MembershipStatus; audience: "staff" | "student" | "parent" | null; admin: boolean };

async function member(tx: TenantTx, where: { id: string } | { orgId_userId: { orgId: string; userId: string } }): Promise<Member | null> {
  const m = await tx.membership.findUnique({
    where,
    select: { id: true, userId: true, status: true, student: { select: { id: true } }, guardian: { select: { id: true } }, staffProfile: { select: { id: true } }, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!m) return null;
  const keys = m.roles.map((r) => r.role.key);
  const audience = m.guardian || keys.includes("parent") ? "parent" : m.student || keys.includes("student") ? "student" : m.staffProfile || keys.length ? "staff" : null;
  return { id: m.id, userId: m.userId, status: m.status, audience, admin: keys.includes("school_admin") };
}

/** Does the provider or the school's own directory vouch for the address? Also checks the tenant. */
export function emailTrust(identity: NormalizedIdentity, policy: Policy, extra: { msTenant?: string | null; msVerifiedDomain?: boolean } = {}): { tenantOk: boolean; verified: boolean; directory: boolean } {
  switch (identity.provider) {
    case "classlink": {
      const ok = !!policy.classlinkTenantId && identity.tenant === policy.classlinkTenantId;
      return { tenantOk: ok, verified: ok, directory: ok };
    }
    case "clever": {
      const ok = !!policy.cleverDistrictId && identity.tenant === policy.cleverDistrictId;
      return { tenantOk: ok, verified: ok, directory: ok };
    }
    case "microsoft": {
      const tid = extra.msTenant ?? identity.tenant;
      const school = !!policy.microsoftTenantId && tid === policy.microsoftTenantId;
      // Entra ID's email claim is editable by any tenant's administrators. It counts only for the school's own
      // tenant, personal Microsoft accounts (verified by Microsoft) or a domain Microsoft marks as verified (xms_edov).
      return { tenantOk: true, verified: school || tid === MS_CONSUMER_TENANT || extra.msVerifiedDomain === true, directory: school };
    }
    case "oidc":
      return { tenantOk: true, verified: policy.oidcTrustEmail || identity.emailVerified, directory: policy.oidcTrustEmail };
    default:
      return { tenantOk: true, verified: identity.emailVerified, directory: false };
  }
}

const eidDigits = (v: string) => v.replace(/\D/g, "");

/** UAE PASS: the student whose stored Emirates ID equals the one UAE PASS verified. Never logs or stores it. */
async function studentByEmiratesId(tx: TenantTx, eid: string): Promise<{ membershipId: string | null } | null> {
  const digits = eidDigits(eid);
  if (!/^784\d{12}$/.test(digits)) return null;
  const candidates = await tx.student.findMany({ where: { emiratesIdLast4: digits.slice(10, 14), emiratesIdEnc: { not: null } }, select: { id: true, membershipId: true, emiratesIdEnc: true }, take: 20 });
  const want = createHash("sha256").update(digits).digest();
  const matches = candidates.filter((c) => {
    try {
      return createHash("sha256").update(eidDigits(decryptField(c.emiratesIdEnc!))).digest().equals(want);
    } catch {
      return false;
    }
  });
  return matches.length === 1 ? { membershipId: matches[0].membershipId } : null;
}

type ExternalHit = { kind: "student" | "staff" | "guardian"; localId: string; membershipId: string | null };

async function byExternalId(tx: TenantTx, orgId: string, identity: NormalizedIdentity): Promise<ExternalHit | null> {
  if (!identity.externalId) return null;
  const ns = ROSTER_NAMESPACE[identity.provider];
  if (ns) {
    const links = await tx.rosterLink.findMany({ where: { orgId, provider: ns, kind: { in: ["student", "staff", "guardian"] }, externalId: identity.externalId, deactivatedAt: null }, select: { kind: true, localId: true } });
    if (links.length !== 1) return null;
    const l = links[0];
    if (l.kind === "staff") return { kind: "staff", localId: l.localId, membershipId: l.localId };
    if (l.kind === "student") {
      const st = await tx.student.findUnique({ where: { id: l.localId }, select: { id: true, membershipId: true, status: true } });
      return st && st.status === "ACTIVE" ? { kind: "student", localId: st.id, membershipId: st.membershipId } : null;
    }
    const gd = await tx.guardian.findUnique({ where: { id: l.localId }, select: { id: true, membershipId: true } });
    return gd ? { kind: "guardian", localId: gd.id, membershipId: gd.membershipId } : null;
  }
  if (identity.provider === "oidc") {
    // A school directory can send the student number or the staff employee number as its external id.
    const id = identity.externalId.trim();
    const [students, staff] = await Promise.all([
      tx.student.findMany({ where: { studentNo: { equals: id, mode: "insensitive" }, status: "ACTIVE" }, select: { id: true, membershipId: true }, take: 2 }),
      tx.staffProfile.findMany({ where: { employeeNo: { equals: id, mode: "insensitive" } }, select: { membershipId: true }, take: 2 }),
    ]);
    if (students.length + staff.length !== 1) return null;
    if (students[0]) return { kind: "student", localId: students[0].id, membershipId: students[0].membershipId };
    return { kind: "staff", localId: staff[0].membershipId, membershipId: staff[0].membershipId };
  }
  return null;
}

async function refuse(orgId: string | null, identity: NormalizedIdentity, code: RefusalCode): Promise<SignInOutcome> {
  if (orgId) {
    await audit(tenantDb(orgId), orgId, { action: "auth.sign_in_refused", entityType: "SignIn", meta: { method: identity.provider, code } }).catch(() => undefined);
  }
  return { ok: false, code, orgId };
}

const usable = (m: Member | null) => !!m && m.status !== "SUSPENDED";

export type ResolveOptions = { now?: Date; msTenant?: string | null; msVerifiedDomain?: boolean };

/** Decide and link. orgId is the school the person started from (or found from their tenant). */
export async function resolveSignIn(orgId: string | null, identity: NormalizedIdentity, opts: ResolveOptions = {}): Promise<SignInOutcome> {
  const now = opts.now ?? new Date();
  if (!orgId) return refuse(null, identity, "NO_SCHOOL");
  const policy = await loadPolicy(orgId);
  const method = identity.provider as SignInMethod;
  if (!methodAvailable(policy, method) || (method === "classlink" && !policy.classlinkTenantId) || (method === "clever" && !policy.cleverDistrictId)) return refuse(orgId, identity, "METHOD_OFF");
  const trust = emailTrust(identity, policy, { msTenant: opts.msTenant, msVerifiedDomain: opts.msVerifiedDomain });
  if (!trust.tenantOk) return refuse(orgId, identity, "WRONG_TENANT");
  const email = identity.email;
  const emailUsable = !!email && trust.verified;

  type Decision = { outcome: SignInOutcome; activate: boolean } | RefusalCode;
  const decide = () => tenantTx(orgId, async (tx): Promise<Decision> => {
    // 1. Already linked in this school.
    const linked = await tx.ssoIdentity.findUnique({ where: { orgId_provider_subject: { orgId, provider: identity.provider, subject: identity.subject } } });
    if (linked) {
      const m = await member(tx, { id: linked.membershipId });
      if (!m) return "NOT_PROVISIONED";
      if (!usable(m)) return "SUSPENDED";
      if (!(await domainAllowed(m))) return "DOMAIN_NOT_ALLOWED";
      await tx.ssoIdentity.update({ where: { id: linked.id }, data: { lastLoginAt: now } });
      return { outcome: ok(m, null, false), activate: m.status === "INVITED" };
    }
    if (identity.provider === "uaepass" && identity.assurance === "SOP1") return "LOW_ASSURANCE";

    // 2. First sign-in: find the member.
    const ext = policy.matchBy !== "EMAIL" ? await byExternalId(tx, orgId, identity) : null;
    const user = emailUsable ? await identityDb.user.findUnique({ where: { email: email! }, select: { id: true } }) : null;
    const byEmail = user && policy.matchBy !== "EXTERNAL_ID" ? await member(tx, { orgId_userId: { orgId, userId: user.id } }) : null;
    let eidMember: Member | null = null;
    if (identity.provider === "uaepass" && identity.emiratesId && policy.uaePassEidMatch) {
      const st = await studentByEmiratesId(tx, identity.emiratesId);
      if (st?.membershipId) eidMember = await member(tx, { id: st.membershipId });
    }

    let target: Member | null = null;
    let via: string | null = null;
    let created = false;
    if (ext?.membershipId) {
      target = await member(tx, { id: ext.membershipId });
      via = "external_id";
    } else if (ext && !ext.membershipId) {
      // A rostered student or parent without an account yet: the school's own directory may create it.
      if (!trust.directory) return "NOT_PROVISIONED";
      if (!email) return "NO_EMAIL";
      if (byEmail) return "LINK_CONFLICT";
      target = await provisionRostered(tx, orgId, ext, email, identity);
      via = "external_id";
      created = true;
    }
    if (eidMember) {
      if (target && target.id !== eidMember.id) return "LINK_CONFLICT";
      target = target ?? eidMember;
      via = via ?? "emirates_id";
    }
    if (byEmail) {
      if (target && target.id !== byEmail.id) return "LINK_CONFLICT";
      target = target ?? byEmail;
      via = via ?? "email";
    }
    if (!target) {
      // 3. Unknown person: self-join for the school's chosen domains only.
      if (!email) return "NO_EMAIL";
      if (!trust.verified) return "EMAIL_UNVERIFIED";
      if (!policy.selfJoinDomains.includes(domainOf(email))) return "NOT_PROVISIONED";
      target = await selfJoin(tx, orgId, email, identity, policy, now);
      via = "self_join";
      created = true;
    }
    if (!usable(target)) return "SUSPENDED";
    if (!(await domainAllowed(target))) return "DOMAIN_NOT_ALLOWED";
    // 4. One account per provider per member: no silent relinking to a different account.
    const other = await tx.ssoIdentity.findFirst({ where: { orgId, provider: identity.provider, membershipId: target.id }, select: { id: true } });
    if (other) return "IDENTITY_TAKEN";
    await tx.ssoIdentity.create({ data: { orgId, membershipId: target.id, provider: identity.provider, subject: identity.subject, linkedVia: via ?? "email", lastLoginAt: now } });
    await audit(tx, orgId, { actorId: target.id, actorUserId: target.userId, action: "auth.sso_linked", entityType: "Membership", entityId: target.id, meta: { method: identity.provider, linkedVia: via, created } });
    return { outcome: ok(target, via, created), activate: target.status === "INVITED" };

    async function domainAllowed(m: Member): Promise<boolean> {
      if (!policy.allowedDomains.length || m.audience === "parent" || !email) return true;
      return policy.allowedDomains.includes(domainOf(email));
    }
  });
  let decision: Decision;
  try {
    decision = await decide();
  } catch (e) {
    // The person already has another kind of access in this school (for example parent and staff).
    if (e instanceof JoinError) decision = e.code === "SUSPENDED" ? "SUSPENDED" : "LINK_CONFLICT";
    else throw e;
  }

  if (typeof decision === "string") return refuse(orgId, identity, decision);
  const out = decision.outcome;
  if (!out.ok) return out;
  if (decision.activate) {
    // Staff added by an import or the roster arrive INVITED; their school's directory confirming them activates them.
    await tenantDb(orgId).membership.updateMany({ where: { id: out.membershipId, status: "INVITED" }, data: { status: "ACTIVE" } });
    out.status = "ACTIVE";
  }
  await audit(tenantDb(orgId), orgId, { actorId: out.membershipId, actorUserId: out.userId, action: "auth.sign_in", entityType: "Membership", entityId: out.membershipId, meta: { method: identity.provider, linkedVia: out.linkedVia, created: out.created } });
  return out;

  function ok(m: Member, via: string | null, created: boolean): SignInOutcome {
    return { ok: true, orgId: orgId!, userId: m.userId, membershipId: m.id, status: m.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" : "ACTIVE", linkedVia: via, created };
  }
}

async function userFor(email: string, identity: NormalizedIdentity): Promise<string> {
  const existing = await identityDb.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return existing.id;
  const name = identity.name || [identity.givenName, identity.familyName].filter(Boolean).join(" ") || email.split("@")[0];
  const u = await identityDb.user.create({ data: { email, nameEn: name.slice(0, 120), emailVerified: new Date() } });
  return u.id;
}

async function provisionRostered(tx: TenantTx, orgId: string, ext: ExternalHit, email: string, identity: NormalizedIdentity): Promise<Member> {
  const userId = await userFor(email, identity);
  const audience = ext.kind === "student" ? "student" : "parent";
  const m = await ensureMembership(tx, orgId, userId, audience, "ACTIVE");
  const roles = await rolesByKeys(tx, [audience], audience);
  await grantRoles(tx, orgId, m.id, roles.map((r) => r.id));
  if (ext.kind === "student") await tx.student.updateMany({ where: { id: ext.localId, membershipId: null }, data: { membershipId: m.id } });
  else await tx.guardian.updateMany({ where: { id: ext.localId, membershipId: null }, data: { membershipId: m.id } });
  return (await member(tx, { id: m.id }))!;
}

async function selfJoin(tx: TenantTx, orgId: string, email: string, identity: NormalizedIdentity, policy: Policy, now: Date): Promise<Member> {
  const userId = await userFor(email, identity);
  const status = policy.selfJoinApproval ? "PENDING_APPROVAL" : "ACTIVE";
  const m = await ensureMembership(tx, orgId, userId, "staff", status);
  await ensureStaffProfile(tx, orgId, m.id);
  if (status === "ACTIVE") {
    const roles = await rolesByKeys(tx, ["teacher"], "staff");
    await grantRoles(tx, orgId, m.id, roles.map((r) => r.id));
  } else {
    const open = await tx.joinRequest.findFirst({ where: { membershipId: m.id, status: "PENDING" }, select: { id: true } });
    if (!open) await tx.joinRequest.create({ data: { orgId, membershipId: m.id, kind: "STAFF", note: null, createdAt: now } });
  }
  await audit(tx, orgId, { actorId: m.id, actorUserId: userId, action: "join.sso_self_join", entityType: "Membership", entityId: m.id, meta: { method: identity.provider, domain: domainOf(email), approvalRequired: policy.selfJoinApproval } });
  return (await member(tx, { id: m.id }))!;
}
