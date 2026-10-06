// Notification fan-out: in-app rows now, email / SMS / WhatsApp / web push queued with idempotency keys.
// Push and WhatsApp follow the member's own opt-in (a subscribed device, a consented phone number) and
// never carry sensitive content: see deviceText() in channels.ts.
import type { NotificationChannel, Sensitivity } from "@prisma/client";
import type { ExecCtx } from "@/server/db";
import { deviceText, pushConfig, whatsappConfig } from "./channels";

export type NotifyInput = {
  recipients: string[]; // membership ids
  templateKey: string;
  vars?: Record<string, string | { en: string; ar: string }>;
  href?: string | null;
  kind?: string;
  sensitivity?: Sensitivity;
  urgent?: boolean;
  channels?: NotificationChannel[];
  idempotencyBase: string;
};

function fill(text: string, vars: NotifyInput["vars"], locale: "en" | "ar") {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars?.[k];
    if (v === undefined) return "";
    return typeof v === "string" ? v : v[locale] || v.en;
  });
}

const DEFAULT_CHANNELS: NotificationChannel[] = ["IN_APP", "EMAIL"];

export async function notify(ec: ExecCtx, input: NotifyInput) {
  const { tx, orgId } = ec;
  const recipients = [...new Set(input.recipients.filter(Boolean))];
  if (recipients.length === 0) return { inApp: 0, outbound: 0 };

  const templates = await tx.messageTemplate.findMany({ where: { orgId, key: input.templateKey } });
  const email = templates.find((t) => t.channel === "EMAIL");
  const sms = templates.find((t) => t.channel === "SMS");
  const subjectEn = fill(email?.subjectEn ?? input.templateKey, input.vars, "en");
  const subjectAr = fill(email?.subjectAr ?? email?.subjectEn ?? input.templateKey, input.vars, "ar");
  const bodyEn = email ? fill(email.bodyEn, input.vars, "en") : null;
  const bodyAr = email ? fill(email.bodyAr, input.vars, "ar") : null;
  const kind = input.kind ?? input.templateKey;
  const wanted = input.channels ?? DEFAULT_CHANNELS;

  const members = await tx.membership.findMany({
    where: { id: { in: recipients }, status: "ACTIVE" },
    select: { id: true, locale: true, user: { select: { email: true, locale: true } }, staffProfile: { select: { phone: true } }, guardian: { select: { phone: true } } },
  });
  const prefs = await tx.notificationPreference.findMany({ where: { orgId, membershipId: { in: recipients }, kind } });
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { defaultLocale: true, nameEn: true, nameAr: true, whatsappKinds: true } });
  // Device channels: only members who subscribed a device (push) or consented with a number (WhatsApp).
  const pushOn = Boolean(pushConfig());
  const waOn = Boolean(whatsappConfig()) && (wanted.includes("WHATSAPP") || (org?.whatsappKinds ?? []).includes(kind));
  const pushMembers = pushOn
    ? new Set((await tx.pushSubscription.findMany({ where: { orgId, membershipId: { in: recipients } }, select: { membershipId: true } })).map((p) => p.membershipId))
    : new Set<string>();
  const waOptIns = waOn ? await tx.whatsAppOptIn.findMany({ where: { orgId, membershipId: { in: recipients }, withdrawnAt: null } }) : [];

  let inApp = 0;
  let outbound = 0;
  for (const m of members) {
    const pref = prefs.find((p) => p.membershipId === m.id);
    // Urgent messages (for example immediate danger) ignore personal preferences.
    const allowed = (c: NotificationChannel) => Boolean(input.urgent) || !pref || pref.channels.includes(c);
    // Families get WhatsApp only at the number they opted in with, never a number on file. Staff alerts that
    // ask for WhatsApp explicitly (immediate danger) keep using the staff member's work phone.
    const channels = wanted.filter((c) => c !== "WHATSAPP" && c !== "PUSH" && (c === "IN_APP" || allowed(c)));
    const waNumber = waOptIns.find((o) => o.membershipId === m.id)?.phone ?? (wanted.includes("WHATSAPP") ? (m.staffProfile?.phone ?? null) : null);
    if (waNumber && allowed("WHATSAPP")) channels.push("WHATSAPP");
    if (pushMembers.has(m.id) && allowed("PUSH")) channels.push("PUSH");
    if (channels.includes("IN_APP")) {
      await tx.notification.create({
        data: {
          orgId,
          recipientId: m.id,
          kind,
          titleEn: subjectEn,
          titleAr: subjectAr,
          bodyEn,
          bodyAr,
          href: input.href ?? null,
          sensitivity: input.sensitivity ?? "STANDARD",
          urgent: input.urgent ?? false,
          createdAt: ec.now,
        },
      });
      inApp++;
    }
    const locale = (m.locale ?? m.user.locale ?? org?.defaultLocale ?? "en") as "en" | "ar";
    for (const channel of channels) {
      if (channel === "IN_APP") continue;
      const to = channel === "EMAIL" ? m.user.email : channel === "PUSH" ? m.id : channel === "WHATSAPP" ? waNumber : (m.staffProfile?.phone ?? m.guardian?.phone ?? null);
      if (!to) continue;
      const idempotencyKey = `${input.idempotencyBase}:${m.id}:${channel}`;
      const existing = await tx.outboundMessage.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey } } });
      if (existing) continue;
      const subject = locale === "ar" ? subjectAr : subjectEn;
      const device =
        channel === "PUSH" || channel === "WHATSAPP"
          ? deviceText({ kind, sensitivity: input.sensitivity, subject, body: locale === "ar" ? bodyAr : bodyEn, locale, school: (locale === "ar" ? org?.nameAr : org?.nameEn) ?? "" })
          : null;
      const row = await tx.outboundMessage.create({
        data: {
          orgId,
          channel,
          to,
          templateKey: input.templateKey,
          subject: device ? device.title : channel === "EMAIL" ? subject : sms ? fill(locale === "ar" ? sms.bodyAr : sms.bodyEn, input.vars, locale) : subject,
          idempotencyKey,
          status: ec.quiet ? "DELIVERED" : "QUEUED",
          sentAt: ec.quiet ? ec.now : null,
          createdAt: ec.now,
        },
      });
      outbound++;
      if (!ec.quiet) {
        ec.effects.push({
          kind: "job",
          queue: "notify",
          name: "deliver",
          data: device
            ? { orgId, outboundId: row.id, locale, body: device.body, href: input.href ?? null, generic: device.generic, urgent: input.urgent ?? false }
            : { orgId, outboundId: row.id, locale, body: locale === "ar" ? bodyAr : bodyEn, href: input.href ?? null },
          jobId: `deliver:${orgId}:${row.id}`,
        });
      }
    }
  }
  return { inApp, outbound };
}
