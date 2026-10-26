// Emails to families who are applying (not school members yet). Bilingual text from the same message files as the
// UI (namespace admissionsEmail), queued through the outbound pipeline with an idempotency key. Message bodies never
// carry the text of a staff message or any health detail: the family opens the application page to read them.
import { createTranslator } from "next-intl";
import type { ExecCtx } from "@/server/db";
import { queueDirectEmail } from "@/server/notify/direct";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";

type Val = string | number | { en: string; ar: string };
type Vars = Record<string, Val>;
type T = (k: string, v?: Record<string, string | number>) => string;

function varsFor(vars: Vars, locale: "en" | "ar"): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = typeof v === "object" ? v[locale] || v.en : v;
  return out;
}

export function bothLanguages(key: string, vars: Vars = {}) {
  const tEn = createTranslator({ locale: "en", messages: en, namespace: "admissionsEmail" as never }) as unknown as T;
  const tAr = createTranslator({ locale: "ar", messages: ar, namespace: "admissionsEmail" as never }) as unknown as T;
  return { en: tEn(key, varsFor(vars, "en")), ar: tAr(key, varsFor(vars, "ar")) };
}

export type FamilyMail = "code" | "submitted" | "message" | "assessment" | "offer" | "update" | "enrolled" | "paid";

/** Queue one bilingual email to an applying family. The family's chosen language comes first. */
export async function mailFamily(ec: ExecCtx, input: { to: string; kind: FamilyMail; vars: Vars; locale: "en" | "ar"; href: string; idempotencyKey: string }) {
  const s = bothLanguages(`${input.kind}Subject`, input.vars);
  const b = bothLanguages(`${input.kind}Body`, input.vars);
  const first = input.locale;
  return queueDirectEmail(ec, {
    to: input.to,
    templateKey: `admission_${input.kind}`,
    subject: first === "ar" ? `${s.ar} | ${s.en}` : `${s.en} | ${s.ar}`,
    body: (first === "ar" ? [b.ar, b.en] : [b.en, b.ar]).join("\n\n"),
    href: input.href,
    locale: first,
    idempotencyKey: input.idempotencyKey,
  });
}
