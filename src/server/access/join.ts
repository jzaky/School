// Public joining: accept a personal invitation or staff link, or join with the school code.
// No user enumeration (one generic error for any credential problem), rate limits per IP and email,
// lockout after repeated wrong child details, and an audit event for every outcome.
import bcrypt from "bcryptjs";
import type { InviteKind, Prisma } from "@prisma/client";
import { identityDb, tenantDb, tenantTx, userScope } from "@/lib/tenant-db";
import { isEmail, parseDate } from "@/lib/people-csv";
import { audit } from "@/server/audit/audit";
import { findInvitationByToken, findSchoolByJoinCode, schoolById, type PublicSchool } from "@/server/platform/join-lookup";
import { hit, peek } from "./rate-limit";
import { inviteState, isUsable } from "./tokens";
import {
  JoinError,
  closeOpenRequests,
  ensureGuardian,
  ensureMembership,
  ensureStaffProfile,
  findMembership,
  grantRoles,
  linkChildren,
  linkStudent,
  rolesByKeys,
} from "./membership-setup";

export { JoinError };

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type AccountInput =
  | { mode: "create"; name: string; email: string; password: string }
  | { mode: "signin"; email: string; password: string }
  | { mode: "session"; userId: string };

export type ResolvedAccount = { userId: string; email: string; nameEn: string; nameAr: string | null; created: boolean };

export const MIN_PASSWORD = 8;

/**
 * Find or create the person's global account. Every credential problem returns the same CREDENTIALS
 * error, so the form never reveals whether an email address already has an account.
 * `provenEmail` is the address a personal invitation was sent to: holding that link proves the address,
 * which lets a person set a first password on an account the school created for them.
 */
export async function resolveAccount(input: AccountInput, opts: { ip: string; provenEmail?: string | null }): Promise<ResolvedAccount> {
  if (input.mode === "session") {
    const u = await identityDb.user.findUnique({ where: { id: input.userId } });
    if (!u) throw new JoinError("CREDENTIALS");
    return { userId: u.id, email: u.email, nameEn: u.nameEn, nameAr: u.nameAr, created: false };
  }
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email) || input.password.length < 1 || input.password.length > 200) throw new JoinError("CREDENTIALS");
  const limit = await hit(`join-signin:${email}`, 10, 15 * 60);
  if (!limit.ok) throw new JoinError("RATE_LIMITED");
  const existing = await identityDb.user.findUnique({ where: { email } });
  if (input.mode === "signin") {
    if (!existing?.passwordHash || !(await bcrypt.compare(input.password, existing.passwordHash))) throw new JoinError("CREDENTIALS");
    return { userId: existing.id, email, nameEn: existing.nameEn, nameAr: existing.nameAr, created: false };
  }
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) throw new JoinError("NAME");
  if (input.password.length < MIN_PASSWORD) throw new JoinError("PASSWORD");
  if (existing) {
    if (existing.passwordHash) {
      // Someone who already has an account and typed their own password: treat it as signing in.
      if (await bcrypt.compare(input.password, existing.passwordHash)) return { userId: existing.id, email, nameEn: existing.nameEn, nameAr: existing.nameAr, created: false };
      throw new JoinError("CREDENTIALS");
    }
    // An account the school created (staff invite, directory import) with no password yet.
    if (opts.provenEmail !== email) throw new JoinError("CREDENTIALS");
    const u = await identityDb.user.update({ where: { id: existing.id }, data: { passwordHash: await bcrypt.hash(input.password, 10), nameEn: existing.nameEn || name, emailVerified: existing.emailVerified ?? new Date() } });
    return { userId: u.id, email, nameEn: u.nameEn, nameAr: u.nameAr, created: false };
  }
  const created = await identityDb.user.create({
    data: { email, nameEn: name, passwordHash: await bcrypt.hash(input.password, 10), emailVerified: opts.provenEmail === email ? new Date() : null },
  });
  return { userId: created.id, email, nameEn: created.nameEn, nameAr: null, created: true };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InvitePreview =
  | { ok: false; reason: "INVALID" | "EXPIRED" | "REVOKED" | "ACCEPTED" }
  | {
      ok: true;
      school: PublicSchool;
      kind: InviteKind;
      isLink: boolean;
      email: string | null;
      nameEn: string | null;
      roles: Array<{ key: string; nameEn: string; nameAr: string }>;
      childCount: number;
      expiresAt: Date;
    };

export async function previewInvite(token: string, opts: { ip: string; now?: Date }): Promise<InvitePreview> {
  const now = opts.now ?? new Date();
  const limit = await hit(`invite-view:${opts.ip}`, 60, 10 * 60);
  if (!limit.ok) throw new JoinError("RATE_LIMITED");
  const found = await findInvitationByToken(token);
  if (!found) return { ok: false, reason: "INVALID" };
  const db = tenantDb(found.orgId);
  const inv = await db.invitation.findUnique({ where: { id: found.invitationId } });
  const school = await schoolById(found.orgId);
  if (!inv || !school) return { ok: false, reason: "INVALID" };
  const state = inviteState(inv, now);
  if (state !== "PENDING") return { ok: false, reason: state };
  const roles = await db.role.findMany({ where: { key: { in: inv.roleKeys } }, select: { key: true, nameEn: true, nameAr: true } });
  return { ok: true, school, kind: inv.kind, isLink: !inv.email, email: inv.email, nameEn: inv.nameEn, roles, childCount: inv.studentIds.length, expiresAt: inv.expiresAt };
}

export type JoinResult = { orgId: string; userId: string; email: string; membershipId: string; status: "ACTIVE" | "PENDING_APPROVAL" };

/** Accept an invitation: creates or activates the membership with the invited roles (and children for parents). */
export async function acceptInvite(token: string, account: AccountInput, opts: { ip: string; now?: Date }): Promise<JoinResult> {
  const now = opts.now ?? new Date();
  const limit = await hit(`invite-accept:${opts.ip}`, 20, 10 * 60);
  if (!limit.ok) throw new JoinError("RATE_LIMITED");
  const found = await findInvitationByToken(token);
  if (!found) throw new JoinError("INVALID");
  const { orgId } = found;
  const inv = await tenantDb(orgId).invitation.findUnique({ where: { id: found.invitationId } });
  if (!inv) throw new JoinError("INVALID");
  if (!isUsable(inv, now)) throw new JoinError(inviteState(inv, now));
  const acc = await resolveAccount(account, { ip: opts.ip, provenEmail: inv.email });
  if (inv.email && inv.email.toLowerCase() !== acc.email) throw new JoinError("WRONG_EMAIL");

  const membershipId = await tenantTx(orgId, async (tx) => {
    // Claim one use atomically so a link can never be used more than maxUses times.
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, revokedAt: null, expiresAt: { gt: now }, uses: { lt: inv.maxUses } },
      data: { uses: { increment: 1 }, acceptedById: acc.userId },
    });
    if (claimed.count !== 1) throw new JoinError("ACCEPTED");
    const audience = inv.kind === "PARENT" ? "parent" : inv.kind === "STUDENT" ? "student" : "staff";
    const roles = await rolesByKeys(tx, inv.roleKeys, audience);
    const m = await ensureMembership(tx, orgId, acc.userId, audience, "ACTIVE");
    await tx.membership.update({ where: { id: m.id }, data: { status: "ACTIVE" } });
    await grantRoles(tx, orgId, m.id, roles.map((r) => r.id));
    if (inv.kind === "STAFF") await ensureStaffProfile(tx, orgId, m.id);
    if (inv.kind === "PARENT") {
      const guardianId = await ensureGuardian(tx, orgId, m.id, { email: acc.email, nameEn: acc.nameEn, nameAr: acc.nameAr });
      await linkChildren(tx, orgId, guardianId, inv.studentIds);
    }
    if (inv.kind === "STUDENT" && inv.studentIds[0]) await linkStudent(tx, m.id, inv.studentIds[0]);
    await closeOpenRequests(tx, m.id, null, now, "invite");
    await audit(tx, orgId, {
      actorId: m.id,
      actorUserId: acc.userId,
      action: "join.invite_accept",
      entityType: "Invitation",
      entityId: inv.id,
      meta: { kind: inv.kind, roles: inv.roleKeys, link: !inv.email, newMember: m.created, children: inv.studentIds.length },
    });
    return m.id;
  });
  await identityDb.user.update({ where: { id: acc.userId }, data: { lastActiveOrgId: orgId } });
  return { orgId, userId: acc.userId, email: acc.email, membershipId, status: "ACTIVE" };
}

// ---------------------------------------------------------------------------
// School code
// ---------------------------------------------------------------------------

export type CodeOptions = { parent: boolean; student: boolean; staff: boolean; staffDomains: string[] };

export async function checkJoinCode(code: string, opts: { ip: string }): Promise<{ school: PublicSchool; options: CodeOptions } | null> {
  const limit = await hit(`join-code:${opts.ip}`, 30, 10 * 60);
  if (!limit.ok) throw new JoinError("RATE_LIMITED");
  const school = await findSchoolByJoinCode(code);
  if (!school) return null;
  return {
    school,
    options: { parent: school.parentSelfJoin, student: school.studentSelfJoin, staff: school.staffEmailDomains.length > 0, staffDomains: school.staffEmailDomains },
  };
}

export type ChildClaim = { studentNo?: string | null; dateOfBirth?: string | null; grade?: number | null; fullName?: string | null };

const MAX_CLAIMS = 8;
export const CLAIM_FAILURE_LIMIT = 5;
const CLAIM_WINDOW = 60 * 60;

function normName(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "")
    .toLowerCase()
    .replace(/[-'’.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Validate what a parent typed. Returns null when the claim is not usable at all. */
export function cleanClaim(c: ChildClaim): ChildClaim | null {
  const studentNo = c.studentNo?.trim().toUpperCase().slice(0, 40) || null;
  const dob = c.dateOfBirth?.trim() ? parseDate(c.dateOfBirth.trim()) : null;
  const grade = typeof c.grade === "number" && Number.isInteger(c.grade) && c.grade >= 0 && c.grade <= 13 ? c.grade : null;
  const fullName = c.fullName?.trim().replace(/\s+/g, " ").slice(0, 120) || null;
  if (studentNo && dob) return { studentNo, dateOfBirth: dob };
  if (grade !== null && fullName && fullName.split(" ").length >= 2) return { grade, fullName };
  return null;
}

type StudentLite = { id: string; studentNo: string; dateOfBirth: Date | null; gradeLevel: number; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; preferredName: string | null };

const STUDENT_LITE = { id: true, studentNo: true, dateOfBirth: true, gradeLevel: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, preferredName: true } satisfies Prisma.StudentSelect;

export function namesOf(s: StudentLite) {
  const names = [`${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`];
  if (s.preferredName) names.push(`${s.preferredName} ${s.lastNameEn}`);
  return names.map(normName);
}

/** The single student who matches a claim exactly, or null. */
export function matchClaim(claim: ChildClaim, students: StudentLite[]): string | null {
  let hits: StudentLite[] = [];
  if (claim.studentNo && claim.dateOfBirth) {
    hits = students.filter((s) => s.studentNo.toUpperCase() === claim.studentNo && s.dateOfBirth && s.dateOfBirth.toISOString().slice(0, 10) === claim.dateOfBirth);
  } else if (claim.fullName && claim.grade !== null && claim.grade !== undefined) {
    const n = normName(claim.fullName);
    hits = students.filter((s) => s.gradeLevel === claim.grade && namesOf(s).includes(n));
  }
  return hits.length === 1 ? hits[0].id : null;
}

async function candidateStudents(tx: Prisma.TransactionClient, claims: ChildClaim[]): Promise<StudentLite[]> {
  const nos = claims.map((c) => c.studentNo).filter((x): x is string => !!x);
  const grades = claims.map((c) => c.grade).filter((x): x is number => typeof x === "number");
  return tx.student.findMany({
    where: { status: "ACTIVE", OR: [...(nos.length ? [{ studentNo: { in: nos, mode: "insensitive" as const } }] : []), ...(grades.length ? [{ gradeLevel: { in: grades } }] : [])] },
    select: STUDENT_LITE,
  });
}

export type CodeJoinInput = {
  code: string;
  kind: InviteKind;
  account: AccountInput;
  children?: ChildClaim[];
  note?: string | null;
};

/**
 * Join with the school code. Parents (and students, when the school allows it) verify with details only
 * the family knows. When every child matches and the school does not require approval, access starts
 * immediately; otherwise the person waits for the school with a PENDING_APPROVAL membership that has no
 * roles and sees no student data. Wrong details never reveal which part was wrong.
 */
export async function joinWithCode(input: CodeJoinInput, opts: { ip: string }): Promise<JoinResult> {
  const limit = await hit(`join-submit:${opts.ip}`, 20, 10 * 60);
  if (!limit.ok) throw new JoinError("RATE_LIMITED");
  const school = await findSchoolByJoinCode(input.code);
  if (!school) throw new JoinError("CODE");
  const orgId = school.id;

  const claims = (input.children ?? []).slice(0, MAX_CLAIMS + 1);
  if (claims.length > MAX_CLAIMS) throw new JoinError("TOO_MANY_CHILDREN");
  const clean = claims.map(cleanClaim);
  if (input.kind === "PARENT") {
    if (!school.parentSelfJoin) throw new JoinError("CLOSED");
    if (clean.length === 0 || clean.some((c) => c === null)) throw new JoinError("CHILD_DETAILS");
  } else if (input.kind === "STUDENT") {
    if (!school.studentSelfJoin) throw new JoinError("CLOSED");
    if (clean.length !== 1 || !clean[0]?.studentNo) throw new JoinError("CHILD_DETAILS");
  }

  const acc = await resolveAccount(input.account, { ip: opts.ip });
  if (input.kind === "STAFF") {
    const domain = acc.email.split("@")[1] ?? "";
    if (!school.staffEmailDomains.includes(domain)) throw new JoinError("STAFF_DOMAIN");
  }
  const lockKeys = [`claims:${orgId}:${acc.userId}`, `claims-ip:${orgId}:${opts.ip}`];
  if (input.kind !== "STAFF") {
    for (const k of lockKeys) if ((await peek(k)) >= CLAIM_FAILURE_LIMIT) throw new JoinError("LOCKED");
  }

  const result = await tenantTx(orgId, async (tx) => {
    const existing = await findMembership(tx, acc.userId);
    if (existing?.status === "ACTIVE") throw new JoinError("ALREADY_MEMBER");
    if (existing?.status === "PENDING_APPROVAL") throw new JoinError("ALREADY_PENDING");
    if (existing?.status === "SUSPENDED") throw new JoinError("SUSPENDED");

    if (input.kind === "STAFF") {
      const auto = school.staffDomainAutoApprove;
      const m = await ensureMembership(tx, orgId, acc.userId, "staff", auto ? "ACTIVE" : "PENDING_APPROVAL");
      await ensureStaffProfile(tx, orgId, m.id);
      if (auto) {
        const roles = await rolesByKeys(tx, ["teacher"], "staff");
        await grantRoles(tx, orgId, m.id, roles.map((r) => r.id));
      } else {
        await tx.joinRequest.create({ data: { orgId, membershipId: m.id, kind: "STAFF", note: input.note?.trim().slice(0, 500) || null } });
      }
      await audit(tx, orgId, { actorId: m.id, actorUserId: acc.userId, action: auto ? "join.staff_domain_active" : "join.request", entityType: "Membership", entityId: m.id, meta: { kind: "STAFF", domain: acc.email.split("@")[1] } });
      return { membershipId: m.id, status: auto ? ("ACTIVE" as const) : ("PENDING_APPROVAL" as const), failures: 0 };
    }

    const valid = clean as ChildClaim[];
    const students = await candidateStudents(tx, valid);
    const matched = valid.map((c) => matchClaim(c, students));
    const failures = matched.filter((x) => x === null).length;
    const allMatched = failures === 0;
    // Students can only claim a record that has no account yet.
    const studentTaken = input.kind === "STUDENT" && allMatched && !!(await tx.student.findFirst({ where: { id: matched[0]!, membershipId: { not: null } }, select: { id: true } }));
    const immediate = allMatched && !studentTaken && !school.parentJoinApproval;
    const audience = input.kind === "STUDENT" ? "student" : "parent";
    const m = await ensureMembership(tx, orgId, acc.userId, audience, immediate ? "ACTIVE" : "PENDING_APPROVAL");
    if (immediate) {
      const roles = await rolesByKeys(tx, [audience], audience);
      await grantRoles(tx, orgId, m.id, roles.map((r) => r.id));
      if (input.kind === "PARENT") {
        const guardianId = await ensureGuardian(tx, orgId, m.id, { email: acc.email, nameEn: acc.nameEn, nameAr: acc.nameAr });
        await linkChildren(tx, orgId, guardianId, matched as string[]);
      } else {
        await linkStudent(tx, m.id, matched[0]!);
      }
    } else {
      await tx.joinRequest.create({
        data: { orgId, membershipId: m.id, kind: input.kind, claimedStudents: valid as unknown as Prisma.InputJsonValue, note: input.note?.trim().slice(0, 500) || null },
      });
    }
    await audit(tx, orgId, {
      actorId: m.id,
      actorUserId: acc.userId,
      action: immediate ? "join.code_linked" : "join.request",
      entityType: "Membership",
      entityId: m.id,
      meta: { kind: input.kind, claims: valid.length, unmatched: failures, approvalRequired: school.parentJoinApproval },
    });
    return { membershipId: m.id, status: immediate ? ("ACTIVE" as const) : ("PENDING_APPROVAL" as const), failures };
  });
  if (result.failures > 0) {
    for (const k of lockKeys) await hit(k, CLAIM_FAILURE_LIMIT, CLAIM_WINDOW);
  }
  await identityDb.user.update({ where: { id: acc.userId }, data: { lastActiveOrgId: orgId } });
  return { orgId, userId: acc.userId, email: acc.email, membershipId: result.membershipId, status: result.status };
}

// ---------------------------------------------------------------------------
// Waiting screen
// ---------------------------------------------------------------------------

export type JoinStatus = {
  orgId: string;
  schoolEn: string;
  schoolAr: string;
  status: "PENDING" | "REJECTED";
  kind: InviteKind | null;
  requestedAt: Date | null;
  childCount: number;
  decisionNote: string | null;
};

/**
 * Pending or declined memberships of a signed-in user, for the "Waiting for the school" screen.
 * Only the person's own request is read: no student records, names or grades.
 */
export async function joinStatusForUser(userId: string): Promise<{ waiting: JoinStatus[]; hasActive: boolean }> {
  const memberships = await userScope(userId, (tx) =>
    tx.membership.findMany({
      where: { userId, status: { in: ["PENDING_APPROVAL", "SUSPENDED", "ACTIVE"] } },
      select: { id: true, orgId: true, status: true, org: { select: { nameEn: true, nameAr: true } } },
    }),
  );
  const waiting: JoinStatus[] = [];
  for (const m of memberships) {
    if (m.status === "ACTIVE") continue;
    const req = await tenantDb(m.orgId).joinRequest.findFirst({
      where: { membershipId: m.id },
      orderBy: { createdAt: "desc" },
      select: { kind: true, status: true, createdAt: true, claimedStudents: true, decisionNote: true },
    });
    if (m.status === "SUSPENDED" && req?.status !== "REJECTED") continue;
    waiting.push({
      orgId: m.orgId,
      schoolEn: m.org.nameEn,
      schoolAr: m.org.nameAr,
      status: m.status === "SUSPENDED" ? "REJECTED" : "PENDING",
      kind: req?.kind ?? null,
      requestedAt: req?.createdAt ?? null,
      childCount: Array.isArray(req?.claimedStudents) ? req.claimedStudents.length : 0,
      decisionNote: m.status === "SUSPENDED" ? (req?.decisionNote ?? null) : null,
    });
  }
  return { waiting, hasActive: memberships.some((m) => m.status === "ACTIVE") };
}
