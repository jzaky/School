"use server";

import { getCtx } from "@/server/context";
import { decryptField } from "@/lib/crypto";
import { audit } from "@/server/audit/audit";

/** Reveal an encrypted identifier. Permission-checked and written to the audit log every time. */
export async function revealIdentifierAction(input: { studentId: string; field: "emiratesId" | "passport" }) {
  const ctx = await getCtx();
  if (!ctx.can("people.reveal_ids")) return { ok: false as const, error: "FORBIDDEN" };
  const s = await ctx.db.student.findUnique({ where: { id: input.studentId } });
  const enc = input.field === "emiratesId" ? s?.emiratesIdEnc : s?.passportEnc;
  if (!s || !enc) return { ok: false as const, error: "NOT_FOUND" };
  await audit(ctx.db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: `student.reveal_${input.field}`,
    entityType: "Student",
    entityId: s.id,
    sensitivity: "CONFIDENTIAL",
  });
  return { ok: true as const, value: decryptField(enc) };
}
