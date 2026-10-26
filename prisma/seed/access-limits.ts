// Demo data for limited admin access: Hannah Morrison (Wellbeing Lead) covers as Deputy Safeguarding Lead
// for ten more days while Richard Evans is on leave, an earlier wellbeing cover that ended on its own, the
// DSL's export of the access report, and the alert the safeguarding team received. Dates are relative to
// now. Safe to re-run: skipped when the school already has a time-limited role assignment.
// All people are fictional.
import type { Prisma } from "@prisma/client";
import { execCtx } from "@/server/db";
import { withMemberRoles, type AccessSnapshot } from "@/server/access/guardrails";
import { alertSafeguardingAccess, ensureAccessAlertTemplate, memberName } from "@/server/access/access-alerts";
import { endOfDubaiDay, dubaiDayKey } from "@/server/access/until";
import type { SeedWorld } from "./demo";

const DAY = 86_400_000;

export async function seedAccessLimits(w: SeedWorld) {
  const { db, orgId, now } = w;
  if ((await db.membershipRole.count({ where: { orgId, expiresAt: { not: null } } })) > 0) return;
  const admin = w.personas.admin;
  const dsl = w.personas.dsl;
  const hannah = w.staff.get("wellbeing_lead_main");
  const dalia = w.staff.get("counselor_second");
  const roles = await db.role.findMany({ where: { orgId, key: { in: ["deputy_dsl", "wellbeing_lead", "counselor"] } }, select: { id: true, key: true, permissions: true } });
  const role = (k: string) => roles.find((r) => r.key === k);
  const deputy = role("deputy_dsl");
  const wellbeing = role("wellbeing_lead");
  const counselor = role("counselor");
  if (!admin || !dsl || !hannah || !dalia || !deputy || !wellbeing || !counselor) return;
  const ago = (days: number, hour = 9) => new Date(now.getTime() - days * DAY + (hour - 9) * 3_600_000);
  const until = (days: number) => endOfDubaiDay(dubaiDayKey(new Date(now.getTime() + days * DAY)))!;
  const tx = db as unknown as Prisma.TransactionClient;
  await ensureAccessAlertTemplate(tx, orgId);

  // Six weeks ago: Dalia covered the wellbeing lead for ten days; the daily job ended it.
  const daliaStart = ago(40, 10);
  const daliaEnd = endOfDubaiDay(dubaiDayKey(ago(30)))!;
  await db.auditEvent.create({
    data: {
      orgId,
      actorId: admin,
      action: "people.roles_change",
      entityType: "Membership",
      entityId: dalia.membershipId,
      sensitivity: "CONFIDENTIAL",
      meta: { before: ["counselor"], after: ["counselor", "wellbeing_lead"], until: { wellbeing_lead: daliaEnd.toISOString() }, changeId: `seed-dalia-cover` },
      createdAt: daliaStart,
    },
  });
  await db.auditEvent.create({
    data: {
      orgId,
      actorId: null,
      action: "people.role_expired",
      entityType: "Membership",
      entityId: dalia.membershipId,
      meta: { roles: ["wellbeing_lead"], endedAt: [daliaEnd.toISOString()], changeId: `seed-dalia-expiry` },
      createdAt: new Date(daliaEnd.getTime() + 25 * 60_000),
    },
  });

  // Two and a half weeks ago: the DSL exported the access report for the inspection file.
  await db.auditEvent.create({
    data: { orgId, actorId: dsl, action: "access.report_export", entityType: "Organization", entityId: orgId, sensitivity: "CONFIDENTIAL", meta: { rows: 64, people: 14 }, createdAt: ago(18, 14) },
  });

  // Four days ago: Aisha gave Hannah the Deputy Safeguarding Lead role until ten days from now.
  const granted = ago(4, 8);
  const expiresAt = until(10);
  await db.membershipRole.upsert({
    where: { membershipId_roleId: { membershipId: hannah.membershipId, roleId: deputy.id } },
    create: { orgId, membershipId: hannah.membershipId, roleId: deputy.id, expiresAt },
    update: { expiresAt },
  });
  await db.auditEvent.create({
    data: {
      orgId,
      actorId: admin,
      action: "people.roles_change",
      entityType: "Membership",
      entityId: hannah.membershipId,
      sensitivity: "CONFIDENTIAL",
      meta: { before: ["wellbeing_lead"], after: ["deputy_dsl", "wellbeing_lead"], until: { deputy_dsl: expiresAt.toISOString() }, changeId: "seed-hannah-cover" },
      createdAt: granted,
    },
  });
  // The alert the safeguarding team received, through the real alert code (in the app; email recorded as delivered).
  const before: AccessSnapshot = {
    roles: roles.map((r) => ({ id: r.id, permissions: r.permissions })),
    members: [{ id: hannah.membershipId, status: "ACTIVE", roleIds: [wellbeing.id] }],
  };
  await alertSafeguardingAccess(execCtx(tx, orgId, { now: granted, quiet: true }), {
    actorId: admin,
    who: await memberName(tx, orgId, admin),
    before,
    after: withMemberRoles(before, hannah.membershipId, [wellbeing.id, deputy.id], { [deputy.id]: expiresAt }),
    memberIds: [hannah.membershipId],
    changeId: "seed-hannah-cover",
  });
  w.log("access limits: Deputy DSL cover until " + dubaiDayKey(expiresAt));
}
