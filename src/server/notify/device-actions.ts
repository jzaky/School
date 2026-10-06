"use server";

// Per-device push subscriptions, WhatsApp consent and per-kind channel preferences for the signed-in member.
import { revalidatePath } from "next/cache";
import type { NotificationChannel } from "@prisma/client";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { LOCKED_KINDS } from "@/server/settings/kinds";
import { normalizePhone, pushConfig, whatsappConfig } from "./channels";
import { savePushSubscription, removePushSubscription, recordWhatsAppConsent, withdrawWhatsAppConsent, setChannelPreference, WHATSAPP_CONSENT_VERSION } from "./devices";

type Result = { ok: true } | { ok: false; error: string };

export async function subscribePushAction(input: { endpoint: string; p256dh: string; auth: string; deviceLabel?: string }): Promise<Result> {
  const ctx = await getCtx();
  if (!pushConfig()) return { ok: false, error: "UNAVAILABLE" };
  const res = await savePushSubscription(ctx.db, ctx.orgId, ctx.membershipId, input);
  if (!res.ok) return res;
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "notify.push_subscribe", entityType: "PushSubscription", entityId: res.id });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function unsubscribePushAction(input: { endpoint: string }): Promise<Result> {
  const ctx = await getCtx();
  const removed = await removePushSubscription(ctx.db, ctx.orgId, ctx.membershipId, input.endpoint);
  if (removed) await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "notify.push_unsubscribe", entityType: "PushSubscription" });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Parents opt in to WhatsApp with their own number; the consent is stored with a timestamp and audited. */
export async function optInWhatsAppAction(input: { phone: string; consent: boolean }): Promise<Result> {
  const ctx = await getCtx();
  if (!ctx.isParent || !whatsappConfig()) return { ok: false, error: "UNAVAILABLE" };
  if (!input.consent) return { ok: false, error: "CONSENT_REQUIRED" };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "PHONE_INVALID" };
  const row = await recordWhatsAppConsent(ctx.db, ctx.orgId, ctx.membershipId, phone, new Date());
  // The number itself is personal data and stays out of the audit trail.
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "notify.whatsapp_opt_in", entityType: "WhatsAppOptIn", entityId: row.id, meta: { consentVersion: WHATSAPP_CONSENT_VERSION } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function optOutWhatsAppAction(): Promise<Result> {
  const ctx = await getCtx();
  const row = await withdrawWhatsAppConsent(ctx.db, ctx.orgId, ctx.membershipId, new Date());
  if (row) await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "notify.whatsapp_opt_out", entityType: "WhatsAppOptIn", entityId: row.id });
  revalidatePath("/", "layout");
  return { ok: true };
}

const TUNABLE: NotificationChannel[] = ["EMAIL", "PUSH", "WHATSAPP"];

/** One channel on or off for one kind of notification. In-app always stays on; safeguarding alerts are locked. */
export async function setChannelPreferenceAction(input: { kind: string; channel: NotificationChannel; on: boolean }): Promise<Result> {
  const ctx = await getCtx();
  if (LOCKED_KINDS.includes(input.kind)) return { ok: false, error: "LOCKED" };
  if (!/^[a-z_]{3,40}$/.test(input.kind) || !TUNABLE.includes(input.channel)) return { ok: false, error: "BAD_KIND" };
  await setChannelPreference(ctx.db, ctx.orgId, ctx.membershipId, input.kind, input.channel, input.on);
  return { ok: true };
}
