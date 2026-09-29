// Join requests: people who joined with the school code or a staff email domain and wait for approval.
// Admins see the children a parent claimed with hints about which student records match, choose what to
// link (or which roles to give staff), and approve or reject with a note. The person is told either way.
import type { Prisma } from "@prisma/client";
import { tenantTx, type TenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { execCtx, type Effect } from "@/server/db";
import { queueDirectEmail } from "@/server/notify/direct";
import { bilingualEmail } from "./email-text";
import { audienceOfRole } from "./permission-catalog";
import { cleanClaim, namesOf, type ChildClaim } from "./join";
import { JoinError, ensureGuardian, ensureStaffProfile, grantRoles, linkChildren, linkStudent } from "./membership-setup";
import type { Actor } from "./roles";

export type MatchHint = {
  studentId: string;
  reasons: Array<"STUDENT_NO" | "DOB" | "NAME" | "GRADE">;
  exact: boolean;
};

type StudentForHint = { id: string; studentNo: string; dateOfBirth: Date | null; gradeLevel: number; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; preferredName: string | null };

/** Which student records look like the child a parent described, strongest first. */
export function matchHints(claim: ChildClaim, students: StudentForHint[]): MatchHint[] {
  const out: MatchHint[] = [];
  const name = claim.fullName ? claim.fullName.normalize("NFKD").toLowerCase().replace(/\s+/g, " ").trim() : null;
  const tokens = name ? name.split(" ").filter((t) => t.length > 1) : [];
  for (const s of students) {
    const reasons: MatchHint["reasons"] = [];
    if (claim.studentNo && s.studentNo.toUpperCase() === claim.studentNo.toUpperCase()) reasons.push("STUDENT_NO");
    if (claim.dateOfBirth && s.dateOfBirth && s.dateOfBirth.toISOString().slice(0, 10) === claim.dateOfBirth) reasons.push("DOB");
    if (tokens.length) {
      const names = namesOf(s).join(" ");
      if (tokens.filter((t) => names.includes(t)).length >= Math.min(2, tokens.length)) reasons.push("NAME");
    }
    if (typeof claim.grade === "number" && s.gradeLevel === claim.grade) reasons.push("GRADE");
    const strong = reasons.includes("STUDENT_NO") || reasons.includes("NAME");
    if (!strong) continue;
    const exact = (reasons.includes("STUDENT_NO") && reasons.includes("DOB")) || (reasons.includes("NAME") && reasons.includes("GRADE"));
    out.push({ studentId: s.id, reasons, exact });
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.reasons.length - a.reasons.length).slice(0, 5);
}

export function claimsOf(json: Prisma.JsonValue | null): ChildClaim[] {
  if (!Array.isArray(json)) return [];
  return json.map((c) => cleanClaim((c ?? {}) as ChildClaim)).filter((c): c is ChildClaim => c !== null);
}

/** Candidate students for a set of claims (by number, by grade and by any name token). */
export async function studentsForClaims(tx: TenantTx | Prisma.TransactionClient, claims: ChildClaim[]) {
  const nos = claims.map((c) => c.studentNo).filter((x): x is string => !!x);
  const grades = claims.map((c) => c.grade).filter((x): x is number => typeof x === "number");
  const tokens = claims.flatMap((c) => (c.fullName ? c.fullName.split(/\s+/).filter((t) => t.length > 2) : []));
  const or: Prisma.StudentWhereInput[] = [];
  if (nos.length) or.push({ studentNo: { in: nos, mode: "insensitive" } });
  if (grades.length && tokens.length) {
    or.push({
      gradeLevel: { in: grades },
      OR: tokens.flatMap((t) => [{ firstNameEn: { contains: t, mode: "insensitive" as const } }, { lastNameEn: { contains: t, mode: "insensitive" as const } }, { firstNameAr: { contains: t } }, { lastNameAr: { contains: t } }]),
    });
  }
  if (or.length === 0) return [];
  return tx.student.findMany({
    where: { OR: or },
    select: { id: true, studentNo: true, dateOfBirth: true, gradeLevel: true, section: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, preferredName: true, membershipId: true },
    take: 50,
  });
}

async function loadPending(tx: TenantTx, requestId: string) {
  const req = await tx.joinRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== "PENDING") throw new JoinError("NOT_FOUND");
  const m = await tx.membership.findUnique({ where: { id: req.membershipId }, include: { user: true } });
  if (!m) throw new JoinError("NOT_FOUND");
  return { req, m };
}

async function orgInfo(tx: TenantTx, orgId: string) {
  const o = await tx.organization.findUnique({ where: { id: orgId }, select: { nameEn: true, nameAr: true, defaultLocale: true } });
  return o ?? { nameEn: "", nameAr: "", defaultLocale: "en" as const };
}

/**
 * Approve a request: activate the membership, give roles, link the chosen children (parents), the
 * student record (students) or the chosen staff roles, then notify the person in the app and by email.
 */
export async function approveJoinRequest(actor: Actor, input: { requestId: string; studentIds?: string[]; roleKeys?: string[]; note?: string | null }, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return tenantTx(actor.orgId, async (tx): Promise<{ effects: Effect[] }> => {
    const { req, m } = await loadPending(tx, input.requestId);
    const ec = execCtx(tx, actor.orgId, { now, actorId: actor.membershipId });
    let linked = 0;
    let roleKeys: string[];
    if (req.kind === "STAFF") {
      roleKeys = [...new Set(input.roleKeys ?? [])];
      if (roleKeys.length === 0) throw new JoinError("ROLES_REQUIRED");
      const roles = await tx.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });
      if (roles.length !== roleKeys.length || roles.some((r) => audienceOfRole(r.key) !== "staff")) throw new JoinError("ROLE_AUDIENCE");
      await grantRoles(tx, actor.orgId, m.id, roles.map((r) => r.id));
      await ensureStaffProfile(tx, actor.orgId, m.id);
    } else {
      const ids = [...new Set(input.studentIds ?? [])];
      if (ids.length === 0) throw new JoinError("CHILDREN_REQUIRED");
      const found = await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (found.length !== ids.length) throw new JoinError("NOT_FOUND");
      roleKeys = [req.kind === "STUDENT" ? "student" : "parent"];
      const roles = await tx.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true } });
      await grantRoles(tx, actor.orgId, m.id, roles.map((r) => r.id));
      if (req.kind === "PARENT") {
        const guardianId = await ensureGuardian(tx, actor.orgId, m.id, { email: m.user.email, nameEn: m.user.nameEn, nameAr: m.user.nameAr });
        linked = await linkChildren(tx, actor.orgId, guardianId, ids);
      } else {
        if (ids.length !== 1) throw new JoinError("CHILDREN_REQUIRED");
        await linkStudent(tx, m.id, ids[0]);
        linked = 1;
      }
    }
    await tx.membership.update({ where: { id: m.id }, data: { status: "ACTIVE" } });
    await tx.joinRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedById: actor.membershipId, decidedAt: now, decisionNote: input.note?.trim().slice(0, 500) || null } });
    const org = await orgInfo(tx, actor.orgId);
    const mail = bilingualEmail("approvedSubject", "approvedBody", { school: { en: org.nameEn, ar: org.nameAr } }, org.defaultLocale);
    await tx.notification.create({
      data: { orgId: actor.orgId, recipientId: m.id, kind: "join_approved", titleEn: mail.subjectEn, titleAr: mail.subjectAr, href: "/home", createdAt: now },
    });
    await queueDirectEmail(ec, { to: m.user.email, templateKey: "join_approved", subject: mail.subject, body: mail.body, href: "/home", locale: org.defaultLocale, idempotencyKey: `join-approved:${req.id}` });
    await audit(tx, actor.orgId, {
      actorId: actor.membershipId,
      actorUserId: actor.userId,
      action: "join.approve",
      entityType: "JoinRequest",
      entityId: req.id,
      meta: { kind: req.kind, membershipId: m.id, roles: roleKeys, linked, before: { status: "PENDING" }, after: { status: "APPROVED" } },
    });
    return { effects: ec.effects };
  });
}

/** Reject a request with a note. The membership is suspended so it grants nothing; the person is told why. */
export async function rejectJoinRequest(actor: Actor, input: { requestId: string; note: string }, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const note = input.note.trim().slice(0, 500);
  if (note.length < 2) throw new JoinError("NOTE_REQUIRED");
  return tenantTx(actor.orgId, async (tx): Promise<{ effects: Effect[] }> => {
    const { req, m } = await loadPending(tx, input.requestId);
    const ec = execCtx(tx, actor.orgId, { now, actorId: actor.membershipId });
    await tx.membership.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
    await tx.joinRequest.update({ where: { id: req.id }, data: { status: "REJECTED", decidedById: actor.membershipId, decidedAt: now, decisionNote: note } });
    const org = await orgInfo(tx, actor.orgId);
    const mail = bilingualEmail("rejectedSubject", "rejectedBody", { school: { en: org.nameEn, ar: org.nameAr }, note }, org.defaultLocale);
    await queueDirectEmail(ec, { to: m.user.email, templateKey: "join_rejected", subject: mail.subject, body: mail.body, href: null, locale: org.defaultLocale, idempotencyKey: `join-rejected:${req.id}` });
    await audit(tx, actor.orgId, {
      actorId: actor.membershipId,
      actorUserId: actor.userId,
      action: "join.reject",
      entityType: "JoinRequest",
      entityId: req.id,
      meta: { kind: req.kind, membershipId: m.id, before: { status: "PENDING" }, after: { status: "REJECTED" } },
    });
    return { effects: ec.effects };
  });
}
