// WhatsApp Business Cloud API provider (Meta). Business-initiated messages must use approved templates,
// so every message is a template message:
//   - the per-kind template (WHATSAPP_TEMPLATE_<KIND>, for example WHATSAPP_TEMPLATE_REQUEST_COMPLETED)
//     with body parameters {{1}} school name and {{2}} notification title;
//   - otherwise, and always for sensitive content, the generic template (WHATSAPP_TEMPLATE_GENERIC)
//     with body parameter {{1}} school name only.
// Both templates carry one dynamic URL button whose suffix is the portal path (for example en/requests/abc),
// so the base URL is fixed in the template approved by Meta.
import type { WhatsAppConfig } from "./channels";

export type WhatsAppMessage = {
  to: string; // E.164
  kind: string;
  locale: "en" | "ar";
  school: string;
  /** Notification title; null when the content is sensitive (generic template only). */
  title: string | null;
  /** App path without the locale, for example /requests/abc. */
  href: string | null;
};

type MetaConfig = Extract<WhatsAppConfig, { provider: "meta" }>;

export function whatsappTemplateFor(cfg: MetaConfig, kind: string, sensitive: boolean) {
  if (sensitive) return { name: cfg.genericTemplate, generic: true };
  const named = cfg.templates[kind.toLowerCase()];
  return named ? { name: named, generic: false } : { name: cfg.genericTemplate, generic: true };
}

const param = (text: string) => ({ type: "text", text: text.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1000) });

/** The JSON body for POST /{phone-number-id}/messages. Pure, so it can be tested without Meta. */
export function buildWhatsAppPayload(cfg: MetaConfig, msg: WhatsAppMessage) {
  const tpl = whatsappTemplateFor(cfg, msg.kind, msg.title === null);
  const body = tpl.generic ? [param(msg.school)] : [param(msg.school), param(msg.title ?? "")];
  const components: Array<Record<string, unknown>> = [{ type: "body", parameters: body }];
  if (msg.href) {
    const path = `${msg.locale}${msg.href.startsWith("/") ? msg.href : `/${msg.href}`}`;
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: path.replace(/^\/+/, "") }] });
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: msg.to.replace(/^\+/, ""),
    type: "template",
    template: { name: tpl.name, language: { code: msg.locale === "ar" ? "ar" : "en" }, components },
  };
}

export async function sendWhatsApp(cfg: MetaConfig, msg: WhatsAppMessage, fetchImpl: typeof fetch = fetch): Promise<{ providerId: string }> {
  const res = await fetchImpl(`https://graph.facebook.com/${cfg.apiVersion}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildWhatsAppPayload(cfg, msg)),
  });
  // The error body can echo the recipient number, so only the status is surfaced.
  if (!res.ok) throw new Error(`whatsapp_http_${res.status}`);
  const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
  return { providerId: json.messages?.[0]?.id ?? "whatsapp" };
}
