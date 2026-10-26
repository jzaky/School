// Family accounts: who pays (a guardian or a company sponsor) and which children are billed together.
// syncFamilyAccounts puts every active student without an account on their primary guardian's account (creating it
// when needed), in a handful of queries so it works for a school of 1,500 students in one go.
import type { FeePayerType } from "@prisma/client";
import type { Tx } from "@/server/db";
import type { TenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { FeeError, type Actor } from "./ledger";
import { formatDocNumber, nextGaplessRange } from "./numbering";

const log = (tx: Tx, orgId: string, actor: Actor, action: string, entityId: string, meta: Record<string, unknown>) =>
  audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action, entityType: "FeeAccount", entityId, meta });

export async function syncFamilyAccounts(tx: Tx, orgId: string, actor: Actor) {
  const students = await tx.student.findMany({ where: { orgId, status: "ACTIVE" }, select: { id: true, lastNameEn: true, lastNameAr: true } });
  const profiled = new Set((await tx.studentFeeProfile.findMany({ where: { orgId }, select: { studentId: true } })).map((p) => p.studentId));
  const todo = students.filter((s) => !profiled.has(s.id));
  if (!todo.length) return { created: 0, attached: 0 };
  const links = await tx.guardianLink.findMany({ where: { orgId, studentId: { in: todo.map((s) => s.id) } }, select: { studentId: true, guardianId: true, isPrimary: true, id: true } });
  const payerOf = new Map<string, string | null>();
  for (const s of todo) {
    const mine = links.filter((l) => l.studentId === s.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id.localeCompare(b.id));
    payerOf.set(s.id, mine[0]?.guardianId ?? null);
  }
  const guardianIds = [...new Set([...payerOf.values()].filter((g): g is string => Boolean(g)))];
  const existing = guardianIds.length ? await tx.feeAccount.findMany({ where: { orgId, payerGuardianId: { in: guardianIds } }, select: { id: true, payerGuardianId: true } }) : [];
  const accountOf = new Map(existing.map((a) => [a.payerGuardianId!, a.id]));
  const guardians = guardianIds.length ? await tx.guardian.findMany({ where: { orgId, id: { in: guardianIds } }, select: { id: true, lastNameEn: true, lastNameAr: true } }) : [];
  // New accounts: one per guardian without one, plus one per student with no guardian at all.
  const needGuardian = guardianIds.filter((g) => !accountOf.has(g));
  const orphans = todo.filter((s) => !payerOf.get(s.id));
  const count = needGuardian.length + orphans.length;
  let created = 0;
  if (count) {
    const first = await nextGaplessRange(tx, orgId, "fees:FAM", count);
    const rows = [
      ...needGuardian.map((gid, i) => {
        const g = guardians.find((x) => x.id === gid)!;
        return { id: undefined as string | undefined, orgId, code: formatDocNumber("FAM", null, first + i, 4), nameEn: `${g.lastNameEn} family`, nameAr: `عائلة ${g.lastNameAr}`, payerType: "GUARDIAN" as FeePayerType, payerGuardianId: gid };
      }),
      ...orphans.map((s, i) => ({ id: undefined as string | undefined, orgId, code: formatDocNumber("FAM", null, first + needGuardian.length + i, 4), nameEn: `${s.lastNameEn} family`, nameAr: `عائلة ${s.lastNameAr}`, payerType: "GUARDIAN" as FeePayerType, payerGuardianId: null as string | null })),
    ];
    const made = await tx.feeAccount.createManyAndReturn({ data: rows.map(({ id: _id, ...r }) => r), select: { id: true, code: true, payerGuardianId: true } });
    for (const m of made) if (m.payerGuardianId) accountOf.set(m.payerGuardianId, m.id);
    const orphanCodes = new Map(rows.slice(needGuardian.length).map((r, i) => [r.code, orphans[i].id]));
    for (const m of made) if (!m.payerGuardianId && orphanCodes.has(m.code)) accountOf.set(`student:${orphanCodes.get(m.code)}`, m.id);
    created = made.length;
  }
  const profiles = todo.map((s) => ({ orgId, studentId: s.id, accountId: accountOf.get(payerOf.get(s.id) ?? `student:${s.id}`)! })).filter((p) => p.accountId);
  await tx.studentFeeProfile.createMany({ data: profiles, skipDuplicates: true });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "fees.accounts.sync", entityType: "FeeAccount", entityId: null, meta: { created, attached: profiles.length } });
  return { created, attached: profiles.length };
}

export type AccountUpdate = {
  nameEn: string;
  nameAr: string;
  payerType: FeePayerType;
  payerGuardianId: string | null;
  sponsorName: string | null;
  sponsorTrn: string | null;
  billingAddress: string | null;
  billingEmail: string | null;
  planKey: string | null;
  remindersPaused: boolean;
  pausedReason: string | null;
};

export async function updateAccount(tx: Tx, orgId: string, accountId: string, input: AccountUpdate, actor: Actor) {
  const acc = await tx.feeAccount.findFirst({ where: { id: accountId, orgId }, include: { students: true } });
  if (!acc) throw new FeeError("NOT_FOUND");
  if (!input.nameEn.trim() || !input.nameAr.trim()) throw new FeeError("NAME_REQUIRED");
  if (input.payerType === "SPONSOR" && !input.sponsorName?.trim()) throw new FeeError("SPONSOR_REQUIRED");
  if (input.sponsorTrn?.trim() && !/^\d{15}$/.test(input.sponsorTrn.trim())) throw new FeeError("TRN_INVALID");
  if (input.billingEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.billingEmail.trim())) throw new FeeError("EMAIL_INVALID");
  if (input.remindersPaused && !input.pausedReason?.trim()) throw new FeeError("REASON_REQUIRED");
  if (input.payerType === "GUARDIAN" && input.payerGuardianId) {
    const linked = await tx.guardianLink.count({ where: { orgId, guardianId: input.payerGuardianId, studentId: { in: acc.students.map((s) => s.studentId) } } });
    if (!linked && acc.students.length) throw new FeeError("PAYER_NOT_LINKED");
  }
  await tx.feeAccount.update({
    where: { id: acc.id },
    data: {
      nameEn: input.nameEn.trim().slice(0, 120),
      nameAr: input.nameAr.trim().slice(0, 120),
      payerType: input.payerType,
      payerGuardianId: input.payerType === "GUARDIAN" ? input.payerGuardianId : acc.payerGuardianId,
      sponsorName: input.payerType === "SPONSOR" ? input.sponsorName!.trim().slice(0, 160) : null,
      sponsorTrn: input.payerType === "SPONSOR" ? input.sponsorTrn?.trim() || null : null,
      billingAddress: input.billingAddress?.trim().slice(0, 300) || null,
      billingEmail: input.billingEmail?.trim().slice(0, 200) || null,
      planKey: input.planKey || null,
      remindersPaused: input.remindersPaused,
      pausedReason: input.remindersPaused ? input.pausedReason!.trim().slice(0, 300) : null,
    },
  });
  await log(tx, orgId, actor, "fees.account.update", acc.id, { payerType: input.payerType, planKey: input.planKey, remindersPaused: input.remindersPaused });
}

/** Move a child to another family account (for example a sponsor pays for one child) and set the transport zone. */
export async function setStudentProfile(tx: Tx, orgId: string, input: { studentId: string; accountId: string; transportZone: string | null }, actor: Actor) {
  const [s, acc] = await Promise.all([tx.student.findFirst({ where: { id: input.studentId, orgId }, select: { id: true } }), tx.feeAccount.findFirst({ where: { id: input.accountId, orgId } })]);
  if (!s || !acc) throw new FeeError("NOT_FOUND");
  const zone = input.transportZone?.trim().toUpperCase() || null;
  await tx.studentFeeProfile.upsert({ where: { studentId: s.id }, create: { orgId, studentId: s.id, accountId: acc.id, transportZone: zone }, update: { accountId: acc.id, transportZone: zone } });
  await log(tx, orgId, actor, "fees.account.student", acc.id, { studentId: s.id, transportZone: zone });
}

// ---------------------------------------------------------------------------------------------
// Who may see an account
// ---------------------------------------------------------------------------------------------

type ParentCtx = { isParent: boolean; orgId: string; membership: { guardian: { id: string; links: Array<{ studentId: string; canApprove: boolean }> } | null } };

/**
 * Accounts a parent may see: the ones they pay, and the ones billing a child they are linked to with parental
 * responsibility (GuardianLink.canApprove). Students never see fees.
 */
export async function parentAccountIds(db: TenantDb, ctx: ParentCtx): Promise<string[]> {
  const g = ctx.membership.guardian;
  if (!ctx.isParent || !g) return [];
  const kids = g.links.filter((l) => l.canApprove).map((l) => l.studentId);
  const [paid, viaKids] = await Promise.all([
    db.feeAccount.findMany({ where: { orgId: ctx.orgId, payerGuardianId: g.id }, select: { id: true } }),
    kids.length ? db.studentFeeProfile.findMany({ where: { orgId: ctx.orgId, studentId: { in: kids } }, select: { accountId: true } }) : Promise.resolve([] as Array<{ accountId: string }>),
  ]);
  return [...new Set([...paid.map((a) => a.id), ...viaKids.map((p) => p.accountId)])];
}
