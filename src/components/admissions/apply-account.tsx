"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Info, Loader2, LogOut, MailCheck, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { gradeLevelValues } from "@/lib/grade-levels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applicantAccountAction, applicantSignOutAction, resendCodeAction, startApplicationAction, verifyCodeAction } from "@/server/admissions/apply-actions";
import { birthRangeFor } from "@/server/admissions/rules";
import { Field, selectClass } from "./ui";

/** Create an account or sign in, then confirm the email address with a six-digit code. */
export function ApplyAccount({ slug, mode, demo, email }: { slug: string; mode: "account" | "verify"; demo: boolean; email?: string }) {
  const t = useTranslations("admissions.account");
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "signin">("create");
  const [step, setStep] = useState<"account" | "verify">(mode);
  const [v, setV] = useState({ name: "", email: email ?? "", password: "" });
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const err = (c: string) => (t.has(`errors.${c}`) ? t(`errors.${c}`) : t("errors.generic"));

  const submitAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await applicantAccountAction({ slug, locale, account: { mode: tab, name: v.name, email: v.email, password: v.password } });
      if (!r.ok) return setError(err(r.error));
      if (r.verified) return router.refresh();
      setDemoCode(r.demoCode);
      setStep("verify");
    });
  };
  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await verifyCodeAction({ slug, code });
      if (!r.ok) return setError(err(r.error));
      toast.success(t("verified"));
      router.refresh();
    });
  };
  const resend = () =>
    start(async () => {
      const r = await resendCodeAction({ slug, locale });
      if (!r.ok) return setError(err(r.error));
      setDemoCode(r.demoCode);
      toast.success(t("codeSent"));
    });

  if (step === "verify") {
    return (
      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="apply-verify">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
            <MailCheck className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">{t("verifyTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("verifyBody", { email: v.email || email || "" })}</p>
          </div>
        </div>
        {demo && (
          <div className="mt-4 rounded-lg border border-gold/40 bg-gold-soft px-3 py-2 text-sm" data-testid="demo-code-note">
            {demoCode ? t.rich("demoCode", { code: demoCode, b: (c) => <b className="font-mono tracking-widest" data-testid="demo-code">{c}</b> }) : t("demoCodeResend")}
          </div>
        )}
        <form onSubmit={submitCode} className="mt-4 space-y-3">
          <Field id="code" label={t("code")} error={error}>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} className="h-11 text-center font-mono text-lg tracking-[0.4em]" dir="ltr" data-testid="code-input" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || code.length !== 6} className="flex-1 sm:flex-none" data-testid="verify-submit">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("verify")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={resend}>
              {t("resend")}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="apply-account">
      <h2 className="text-base font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("body")}</p>
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
        {(["create", "signin"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", tab === k ? "bg-card shadow-xs" : "text-muted-foreground")} data-testid={`account-tab-${k}`}>
            {t(k === "create" ? "tabCreate" : "tabSignIn")}
          </button>
        ))}
      </div>
      <form onSubmit={submitAccount} className="mt-4 space-y-3">
        {tab === "create" && (
          <Field id="acc-name" label={t("name")}>
            <Input id="acc-name" autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required minLength={2} maxLength={120} data-testid="acc-name" />
          </Field>
        )}
        <Field id="acc-email" label={t("email")}>
          <Input id="acc-email" type="email" autoComplete="email" dir="ltr" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required data-testid="acc-email" />
        </Field>
        <Field id="acc-password" label={t("password")} hint={tab === "create" ? t("passwordHint") : undefined} error={error}>
          <Input id="acc-password" type="password" autoComplete={tab === "create" ? "new-password" : "current-password"} dir="ltr" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} required minLength={tab === "create" ? 8 : 1} data-testid="acc-password" />
        </Field>
        <Button type="submit" className="w-full" disabled={pending} data-testid="account-submit">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t(tab === "create" ? "create" : "signIn")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t("samePortal")}</p>
      </form>
    </section>
  );
}

export function ApplySignOut({ slug }: { slug: string }) {
  const t = useTranslations("admissions.account");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await applicantSignOutAction();
          router.replace(`/apply/${slug}`);
          router.refresh();
        })
      }
      data-testid="apply-signout"
    >
      <LogOut className="size-4" />
      <span className="hidden sm:inline">{t("signOut")}</span>
    </Button>
  );
}

type YearOpt = { id: string; name: string; grades: number[]; entryYear: number };

/** Choose the year of entry and the grade, then start a draft. */
export function StartApplication({ slug, years, cutoff }: { slug: string; years: YearOpt[]; cutoff: { month: number; day: number } }) {
  const t = useTranslations("admissions.apply");
  const tg = useTranslations("gradeLevel");
  const locale = useLocale();
  const router = useRouter();
  const [yearId, setYearId] = useState(years[years.length > 1 ? 1 : 0]?.id ?? "");
  const year = years.find((y) => y.id === yearId);
  const [grade, setGrade] = useState<string>("");
  const [pending, start] = useTransition();
  const range = useMemo(() => (year && grade !== "" ? birthRangeFor(Number(grade), year.entryYear, cutoff) : null), [year, grade, cutoff]);
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const go = () =>
    start(async () => {
      const r = await startApplicationAction({ slug, locale, academicYearId: yearId, gradeLevel: Number(grade) });
      if (!r.ok) return void toast.error(t(`startErrors.${["CLOSED", "YEAR", "GRADE", "TOO_MANY_DRAFTS"].includes(r.error) ? r.error : "generic"}`));
      router.push(`/apply/${slug}/${r.id}`);
    });
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="start-application">
      <h2 className="text-base font-semibold">{t("startTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("startBody")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field id="start-year" label={t("yearOfEntry")}>
          <select id="start-year" className={selectClass} value={yearId} onChange={(e) => { setYearId(e.target.value); setGrade(""); }} data-testid="start-year">
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="start-grade" label={t("gradeApplying")}>
          <select id="start-grade" className={selectClass} value={grade} onChange={(e) => setGrade(e.target.value)} data-testid="start-grade">
            <option value="" disabled>
              {t("chooseGrade")}
            </option>
            {(year?.grades ?? []).map((g) => (
              <option key={g} value={g}>
                {tg("label", gradeLevelValues(g))}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {range && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t("usualBirth", { from: fmt(new Date(range.from.getTime() + 86_400_000)), to: fmt(range.to) })}
        </p>
      )}
      <Button className="mt-4 w-full sm:w-auto" disabled={pending || !yearId || grade === ""} onClick={go} data-testid="start-submit">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {t("start")}
      </Button>
    </section>
  );
}
