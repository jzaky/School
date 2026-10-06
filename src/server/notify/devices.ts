// Storage for device channels. Every query is scoped by orgId and runs on the tenant client (RLS).
import type { NotificationChannel } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";

export const WHATSAPP_CONSENT_VERSION = "whatsapp-v1";
const ALL_CHANNELS: NotificationChannel[] = ["IN_APP", "EMAIL", "PUSH", "WHATSAPP"];

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function validPushSubscription(input: { endpoint: string; p256dh: string; auth: string }) {
  let url: URL;
  try {
    url = new URL(input.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || input.endpoint.length > 1000) return false;
  if (!B64URL.test(input.p256dh) || !B64URL.test(input.auth)) return false;
  // 65-byte uncompressed P-256 point and 16-byte auth secret.
  return Buffer.from(input.p256dh, "base64url").length === 65 && Buffer.from(input.auth, "base64url").length === 16;
}

/** Adds a channel to the member's existing per-kind rows, so a first opt-in covers kinds they already tuned. */
async function addChannelToExisting(db: TenantDb, orgId: string, membershipId: string, channel: NotificationChannel) {
  const rows = await db.notificationPreference.findMany({ where: { orgId, membershipId } });
  for (const r of rows) {
    if (!r.channels.includes(channel)) await db.notificationPreference.update({ where: { id: r.id }, data: { channels: [...r.channels, channel] } });
  }
}

/** Store (or move to this member) one device. A device belongs to whoever subscribed it last in this school. */
export async function savePushSubscription(db: TenantDb, orgId: string, membershipId: string, input: { endpoint: string; p256dh: string; auth: string; deviceLabel?: string }) {
  if (!validPushSubscription(input)) return { ok: false as const, error: "INVALID" };
  const first = (await db.pushSubscription.count({ where: { orgId, membershipId } })) === 0;
  const label = input.deviceLabel?.slice(0, 80) || null;
  const row = await db.pushSubscription.upsert({
    where: { orgId_endpoint: { orgId, endpoint: input.endpoint } },
    create: { orgId, membershipId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, deviceLabel: label },
    update: { membershipId, p256dh: input.p256dh, auth: input.auth, deviceLabel: label },
  });
  if (first) await addChannelToExisting(db, orgId, membershipId, "PUSH");
  return { ok: true as const, id: row.id };
}

export async function removePushSubscription(db: TenantDb, orgId: string, membershipId: string, endpoint: string) {
  const res = await db.pushSubscription.deleteMany({ where: { orgId, membershipId, endpoint } });
  return res.count > 0;
}

export async function recordWhatsAppConsent(db: TenantDb, orgId: string, membershipId: string, phone: string, now: Date) {
  const before = await db.whatsAppOptIn.findUnique({ where: { membershipId } });
  const row = await db.whatsAppOptIn.upsert({
    where: { membershipId },
    create: { orgId, membershipId, phone, consentedAt: now, consentVersion: WHATSAPP_CONSENT_VERSION },
    update: { phone, consentedAt: now, consentVersion: WHATSAPP_CONSENT_VERSION, withdrawnAt: null },
  });
  if (!before || before.withdrawnAt) await addChannelToExisting(db, orgId, membershipId, "WHATSAPP");
  return row;
}

export async function withdrawWhatsAppConsent(db: TenantDb, orgId: string, membershipId: string, now: Date) {
  const row = await db.whatsAppOptIn.findFirst({ where: { orgId, membershipId, withdrawnAt: null } });
  if (!row) return null;
  return db.whatsAppOptIn.update({ where: { id: row.id }, data: { withdrawnAt: now } });
}

export async function setChannelPreference(db: TenantDb, orgId: string, membershipId: string, kind: string, channel: NotificationChannel, on: boolean) {
  const row = await db.notificationPreference.findUnique({ where: { membershipId_kind: { membershipId, kind } } });
  // No row means every channel is on.
  const current = row?.channels ?? ALL_CHANNELS;
  const next = on ? [...new Set([...current, channel])] : current.filter((c) => c !== channel);
  if (!next.includes("IN_APP")) next.unshift("IN_APP");
  await db.notificationPreference.upsert({
    where: { membershipId_kind: { membershipId, kind } },
    create: { orgId, membershipId, kind, channels: next },
    update: { channels: next },
  });
  return next;
}
