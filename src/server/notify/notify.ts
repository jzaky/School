// Notification fan-out: in-app rows now, email / SMS / WhatsApp queued with idempotency keys.
import type { NotificationChannel, Sensitivity } from "@prisma/client";
import type { ExecCtx } from "@/server/db";

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
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { defaultLocale: true } });

  let inApp = 0;
  let outbound = 0;
  for (const m of members) {
    const pref = prefs.find((p) => p.membershipId === m.id);
    // Urgent messages (for example immediate danger) ignore personal preferences.
    const channels = input.urgent ? wanted : wanted.filter((c) => c === "IN_APP" || !pref || pref.channels.includes(c));
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
      const to = channel === "EMAIL" ? m.user.email : (m.staffProfile?.phone ?? m.guardian?.phone ?? null);
      if (!to) continue;
      const idempotencyKey = `${input.idempotencyBase}:${m.id}:${channel}`;
      const existing = await tx.outboundMessage.findUnique({ where: { orgId_idempotencyKey: { orgId, idempotencyKey } } });
      if (existing) continue;
      const subject = locale === "ar" ? subjectAr : subjectEn;
      const row = await tx.outboundMessage.create({
        data: {
          orgId,
          channel,
          to,
          templateKey: input.templateKey,
          subject: channel === "EMAIL" ? subject : sms ? fill(locale === "ar" ? sms.bodyAr : sms.bodyEn, input.vars, locale) : subject,
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
          data: { orgId, outboundId: row.id, locale, body: locale === "ar" ? bodyAr : bodyEn, href: input.href ?? null },
          jobId: `deliver:${orgId}:${row.id}`,
        });
      }
    }
  }
  return { inApp, outbound };
}
