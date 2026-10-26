// Application history and staff notifications.
import type { Prisma } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { ensureAdmissionSetup } from "./templates";

export type EventInput = {
  applicationId: string;
  kind: "created" | "stage" | "document" | "offer" | "payment" | "assessment" | "priority" | "enrolled" | "message" | "edit";
  fromStage?: string | null;
  toStage?: string | null;
  actorMembershipId?: string | null;
  actorUserId?: string | null;
  data?: Record<string, unknown>;
  at?: Date;
};

export async function recordEvent(tx: Tx, orgId: string, e: EventInput) {
  await tx.admissionEvent.create({
    data: {
      orgId,
      applicationId: e.applicationId,
      kind: e.kind,
      fromStage: e.fromStage ?? null,
      toStage: e.toStage ?? null,
      actorMembershipId: e.actorMembershipId ?? null,
      actorUserId: e.actorUserId ?? null,
      data: (e.data ?? undefined) as Prisma.InputJsonValue | undefined,
      createdAt: e.at ?? new Date(),
    },
  });
}

/** Staff who manage admissions (active members whose roles include admissions.manage). */
export async function admissionsTeam(tx: Tx, orgId: string): Promise<string[]> {
  const rows = await tx.membership.findMany({
    where: { orgId, status: "ACTIVE", roles: { some: { role: { permissions: { has: "admissions.manage" } } } } },
    select: { id: true },
    take: 50,
  });
  return rows.map((r) => r.id);
}

/** In-app and email notice to the admissions team. Never carries health details or message text. */
export async function notifyTeam(ec: ExecCtx, input: { templateKey: string; vars: Record<string, string | { en: string; ar: string }>; href: string; idempotencyBase: string }) {
  const team = await admissionsTeam(ec.tx, ec.orgId);
  if (!team.length) return;
  await ensureAdmissionSetup(ec.tx, ec.orgId);
  await notify(ec, { recipients: team, templateKey: input.templateKey, kind: input.templateKey, vars: input.vars, href: input.href, channels: ["IN_APP", "EMAIL"], idempotencyBase: input.idempotencyBase });
}
