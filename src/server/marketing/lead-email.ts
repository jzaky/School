// Email for marketing leads: the career taster result, or the confirmation of an offer request.
// Goes through the same email provider as school mail (Resend when configured, console provider otherwise).
// Delivery is idempotent: the lead row is claimed (QUEUED to SENT) before the provider is called, and the
// provider gets the idempotency key lead:<id>. Never log the address, the name or the content.
import type { MarketingLead, PrismaClient } from "@prisma/client";
import { defaultSender, type Sender } from "@/worker/handlers";
import { areaExplanation, scoreTaster } from "./taster";
import { resultToken, type TasterPayload } from "./leads";

type Db = Pick<PrismaClient, "marketingLead">;

export const LEAD_EMAIL_JOB = "lead-email";

function baseUrl() {
  return (process.env.APP_URL ?? process.env.AUTH_URL ?? "").replace(/\/+$/, "");
}

const COPY = {
  en: {
    tasterSubject: "Your Horizon career taster result",
    tasterIntro: (name: string) => `Hello ${name},\n\nThank you for trying the Horizon career taster. These are the three career areas that fit your answers best:`,
    tasterOutro: "Open your full result for the strengths behind it, example careers in each area and a PDF in English and Arabic. This short taster is a starting point for a conversation, not a final answer.",
    tasterLink: "See your full result",
    offerSubject: "We received your request for an offer",
    offerBody: (name: string, students: number, campuses: number) =>
      `Hello ${name},\n\nThank you for your interest in Horizon. We received your request for an offer for ${students} students (${campuses === 1 ? "one campus" : `${campuses} campuses`}). Our team will reply to this address.`,
    offerLink: "Open the estimator again",
  },
  ar: {
    tasterSubject: "نتيجة مستكشف المهن من هورايزن",
    tasterIntro: (name: string) => `مرحبًا ${name}،\n\nشكرًا لتجربتك مستكشف المهن من هورايزن. هذه أكثر ثلاثة مجالات مهنية تتوافق مع إجاباتك:`,
    tasterOutro: "افتح نتيجتك الكاملة لتتعرّف على نقاط القوة التي بُنيت عليها، وأمثلة على المهن في كل مجال، وملف PDF بالعربية والإنجليزية. هذا المستكشف القصير بداية للحوار وليس إجابة نهائية.",
    tasterLink: "عرض النتيجة الكاملة",
    offerSubject: "استلمنا طلبك للحصول على عرض سعر",
    offerBody: (name: string, students: number, campuses: number) =>
      `مرحبًا ${name}،\n\nشكرًا لاهتمامك بهورايزن. استلمنا طلبك للحصول على عرض سعر لعدد ${students} طالبًا (عدد الفروع: ${campuses}). سيرد فريقنا على هذا العنوان.`,
    offerLink: "فتح أداة التقدير مرة أخرى",
  },
} as const;

/** Subject, body and link for a lead's email, in the lead's language. */
export function composeLeadEmail(lead: Pick<MarketingLead, "id" | "type" | "name" | "locale" | "payload">) {
  const locale = lead.locale === "ar" ? "ar" : "en";
  const c = COPY[locale];
  const base = baseUrl();
  if (lead.type === "TASTER") {
    const { answers } = lead.payload as TasterPayload;
    const areas = scoreTaster(answers).areas.slice(0, 3);
    const lines = areas.map((a, i) => `${i + 1}. ${a.name[locale]} (${a.matchScore}%)\n${areaExplanation(a, locale)}`);
    return {
      subject: c.tasterSubject,
      body: [c.tasterIntro(lead.name), ...lines, c.tasterOutro].join("\n\n"),
      linkUrl: base ? `${base}/try/result/${resultToken(lead.id)}` : null,
      linkLabel: c.tasterLink,
      locale,
    };
  }
  const p = lead.payload as { students?: number; campuses?: number };
  return {
    subject: c.offerSubject,
    body: c.offerBody(lead.name, p.students ?? 0, p.campuses ?? 1),
    linkUrl: base ? `${base}/pricing` : null,
    linkLabel: c.offerLink,
    locale,
  };
}

export type LeadDeliverResult = "sent" | "skipped" | "failed";

/** Send a lead's email once. Safe to call from the job, the sweeper and the web fallback at the same time. */
export async function deliverLeadEmail(db: Db, leadId: string, opts: { now?: Date; send?: Sender } = {}): Promise<LeadDeliverResult> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? defaultSender;
  const claimed = await db.marketingLead.updateMany({ where: { id: leadId, emailStatus: "QUEUED" }, data: { emailStatus: "SENT" } });
  if (claimed.count !== 1) return "skipped";
  const lead = await db.marketingLead.findUnique({ where: { id: leadId } });
  if (!lead) return "skipped";
  const mail = composeLeadEmail(lead);
  try {
    await send({
      id: lead.id,
      orgId: "platform",
      channel: "EMAIL",
      to: lead.email,
      subject: mail.subject,
      body: mail.body,
      href: null,
      linkUrl: mail.linkUrl,
      linkLabel: mail.linkLabel,
      locale: mail.locale as "en" | "ar",
      idempotencyKey: `lead:${lead.id}`,
    });
    await db.marketingLead.update({ where: { id: lead.id }, data: { emailSentAt: now } });
    return "sent";
  } catch {
    await db.marketingLead.update({ where: { id: lead.id }, data: { emailStatus: "FAILED" } });
    console.error(`[lead-email] lead ${lead.id} failed`);
    return "failed";
  }
}

/** Deliver lead emails the queue missed (Redis down when the lead was created). Run by the worker sweeper. */
export async function sweepLeadEmails(db: Db, opts: { now?: Date; send?: Sender } = {}) {
  const now = opts.now ?? new Date();
  const stale = await db.marketingLead.findMany({
    where: { emailStatus: "QUEUED", createdAt: { lt: new Date(now.getTime() - 2 * 60_000), gt: new Date(now.getTime() - 2 * 86_400_000) } },
    select: { id: true },
    take: 50,
  });
  let sent = 0;
  for (const l of stale) if ((await deliverLeadEmail(db, l.id, opts)) === "sent") sent++;
  return { sent };
}
