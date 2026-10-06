"use server";

// School settings for families: the fee payment link and which notifications go out on WhatsApp.
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { saveFeeSettings } from "@/server/fees/settings";
import { FAMILY_KINDS } from "@/server/settings/kinds";

export async function saveFeeSettingsAction(input: { url: string; contact: string }) {
  const ctx = await getCtx();
  if (!ctx.can("school.manage")) return { ok: false as const, error: "FORBIDDEN" };
  const res = await saveFeeSettings(ctx.db, ctx.orgId, { membershipId: ctx.membershipId, userId: ctx.user.id }, input);
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setWhatsAppKindsAction(input: { kinds: string[] }) {
  const ctx = await getCtx();
  if (!ctx.can("school.manage")) return { ok: false as const, error: "FORBIDDEN" };
  const kinds = FAMILY_KINDS.filter((k) => input.kinds.includes(k));
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data: { whatsappKinds: kinds } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.whatsapp_kinds", entityType: "Organization", entityId: ctx.orgId, meta: { from: ctx.org.whatsappKinds, to: kinds } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
