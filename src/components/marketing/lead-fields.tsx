"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_ROLES } from "@/lib/leads";
import type { LeadState } from "@/server/marketing/actions";

/** Name, email, role, school, consent and the honeypot, shared by the taster and the offer request. */
export function LeadContactFields({
  locale,
  state,
  schoolRequired,
  consentText,
  defaultRole = "STUDENT",
}: {
  locale: "en" | "ar";
  state: LeadState;
  schoolRequired: boolean;
  consentText: string;
  defaultRole?: (typeof LEAD_ROLES)[number];
}) {
  const t = useTranslations("growth.lead");
  const invalid = (f: string) => state.error === "invalid" && state.field === f;
  return (
    <div className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot: hidden from people and assistive technology. */}
      <div aria-hidden="true" className="pointer-events-none absolute -z-10 size-px overflow-hidden opacity-0">
        <label htmlFor="lead-website">{t("honeypot")}</label>
        <input id="lead-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="lead-name">{t("name")}</Label>
          <Input id="lead-name" name="name" required minLength={2} maxLength={120} autoComplete="name" aria-invalid={invalid("name")} data-testid="lead-name" />
          {invalid("name") && <p className="text-xs text-danger">{t("errName")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-email">{t("email")}</Label>
          <Input id="lead-email" name="email" type="email" required maxLength={200} autoComplete="email" dir="ltr" aria-invalid={invalid("email")} data-testid="lead-email" />
          {invalid("email") && <p className="text-xs text-danger">{t("errEmail")}</p>}
        </div>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t("role")}</legend>
        <div className="flex flex-wrap gap-2">
          {LEAD_ROLES.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/50">
              <input type="radio" name="role" value={r} defaultChecked={r === defaultRole} className="accent-[var(--brand)]" data-testid={`lead-role-${r}`} />
              {t(`role${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="lead-school">
          {t("school")}
          {!schoolRequired && <span className="ms-1 text-xs font-normal text-muted-foreground">{t("optional")}</span>}
        </Label>
        <Input id="lead-school" name="schoolName" required={schoolRequired} maxLength={160} autoComplete="organization" aria-invalid={invalid("schoolName")} data-testid="lead-school" />
        {invalid("schoolName") && <p className="text-xs text-danger">{t("errSchool")}</p>}
      </div>
      <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" data-testid="lead-consent" />
        <span className="text-muted-foreground">{consentText}</span>
      </label>
      {invalid("consent") && <p className="text-xs text-danger">{t("errConsent")}</p>}
      {state.error && state.error !== "invalid" && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert" data-testid="lead-error">
          {t(`err.${state.error}`)}
        </p>
      )}
      {state.error === "invalid" && !state.field && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {t("err.invalid")}
        </p>
      )}
    </div>
  );
}
