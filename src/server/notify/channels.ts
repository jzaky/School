// Push and WhatsApp: what may leave the platform, and whether each channel is configured.
// Both channels show text on a lock screen or in a chat app the school does not control, so they are
// stricter than email: anything sensitive is replaced by a generic line and a link into the portal.
import type { Sensitivity } from "@prisma/client";

/** Sensitivities whose content never goes into a push or WhatsApp text. */
export const SENSITIVE_FOR_DEVICE: Sensitivity[] = ["CONFIDENTIAL", "MEDICAL", "WELLBEING", "SAFEGUARDING"];

/**
 * Notification kinds that can carry case details even when the caller did not pass a sensitivity
 * (for example a staff message to a family about a case). Their text is always generic on devices.
 */
export const SENSITIVE_KINDS = [
  "safeguarding_new",
  "safeguarding_immediate",
  "break_glass",
  "case_assigned",
  "case_escalated",
  "referral_accepted",
  "wellbeing_referral",
  "parent_update",
];

export type DeviceText = { title: string; body: string | null; generic: boolean };

const GENERIC = {
  en: (school: string) => ({ title: `New message from ${school}`, body: "Open the school portal to read it." }),
  ar: (school: string) => ({ title: `رسالة جديدة من ${school}`, body: "افتح بوابة المدرسة لقراءتها." }),
};

export function isSensitiveForDevice(kind: string, sensitivity: Sensitivity | null | undefined) {
  return SENSITIVE_FOR_DEVICE.includes(sensitivity ?? "STANDARD") || SENSITIVE_KINDS.includes(kind);
}

/** Text for a push notification or WhatsApp message. Sensitive content becomes a generic line. */
export function deviceText(input: { kind: string; sensitivity?: Sensitivity | null; subject: string; body?: string | null; locale: "en" | "ar"; school: string }): DeviceText {
  if (isSensitiveForDevice(input.kind, input.sensitivity)) {
    const g = GENERIC[input.locale](input.school);
    return { title: g.title, body: g.body, generic: true };
  }
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const body = input.body?.replace(/\s+/g, " ").trim() || null;
  return { title: clip(input.subject.trim() || GENERIC[input.locale](input.school).title, 120), body: body ? clip(body, 180) : null, generic: false };
}

// ---------------------------------------------------------------------------
// Configuration (environment)
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

/** Web push needs a VAPID key pair and a subject (mailto: or https:). Without them the option is hidden. */
export function pushConfig(env: Env = process.env) {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = env.WEB_PUSH_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export type WhatsAppConfig =
  | { provider: "console" }
  | { provider: "meta"; token: string; phoneNumberId: string; apiVersion: string; templates: Record<string, string>; genericTemplate: string };

/**
 * WhatsApp is offered only when WHATSAPP_PROVIDER is set: "meta" (Business Cloud API, needs the token,
 * phone number id and at least the generic template) or "console" (development and demo: nothing leaves).
 * Unset means the channel is not offered at all, so parents never opt in to something that cannot send.
 */
export function whatsappConfig(env: Env = process.env): WhatsAppConfig | null {
  const provider = env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (provider === "console") return { provider: "console" };
  if (provider !== "meta") return null;
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const genericTemplate = env.WHATSAPP_TEMPLATE_GENERIC?.trim();
  if (!token || !phoneNumberId || !genericTemplate) return null;
  const templates: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = /^WHATSAPP_TEMPLATE_([A-Z0-9_]+)$/.exec(k);
    if (m && m[1] !== "GENERIC" && v?.trim()) templates[m[1].toLowerCase()] = v.trim();
  }
  return { provider: "meta", token, phoneNumberId, apiVersion: env.WHATSAPP_API_VERSION?.trim() || "v21.0", templates, genericTemplate };
}

/** E.164 phone number from what a parent typed (spaces, dashes, a leading 00 or a UAE 05 number). */
export function normalizePhone(raw: string): string | null {
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^05\d{8}$/.test(s)) s = `+971${s.slice(1)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}

/** The last digits of a number, for showing which number is on file without printing it in full. */
export const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;
