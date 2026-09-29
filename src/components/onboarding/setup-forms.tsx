"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, ImageUp, Loader2, Lock, Plus, Sparkles, Trash2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dayName } from "@/components/timetable/day-name";
import { CURRICULA, EMIRATES } from "@/lib/signup";
import { CORE_MODULES, MODULE_REQUIRES, OPTIONAL_MODULES, type OptionalModule } from "@/lib/modules";
import { HEX_COLOR, nextStep, prevStep, TIMEZONES, type SetupStep } from "@/lib/onboarding";
import { addUaeHolidaysAction, finishSetupAction, markStepAction, saveCurriculaStepAction, saveModulesStepAction, saveProfileStepAction, saveYearStepAction, setLogoAction } from "@/server/onboarding/actions";

function useSetupError() {
  const t = useTranslations("onboarding.setup.errors");
  return (code: string) => (t.has(code) ? t(code) : t("generic"));
}

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Back, Skip and the primary action, the same on every step. */
export function StepFooter({ step, pending, primaryLabel, onPrimary, primaryType = "button", canSkip = true }: { step: SetupStep; pending?: boolean; primaryLabel?: string; onPrimary?: () => void; primaryType?: "button" | "submit"; canSkip?: boolean }) {
  const t = useTranslations("onboarding.setup");
  const router = useRouter();
  const err = useSetupError();
  const [skipping, start] = useTransition();
  const back = prevStep(step);
  const locale = useLocale();
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const Next = locale === "ar" ? ArrowLeft : ArrowRight;
  return (
    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {back && (
          <Button variant="ghost" asChild>
            <Link href={`/setup?step=${back}`}>
              <Back className="size-4" />
              {t("back")}
            </Link>
          </Button>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {canSkip && (
          <Button
            type="button"
            variant="outline"
            disabled={pending || skipping}
            data-testid="step-skip"
            onClick={() =>
              start(async () => {
                const res = await markStepAction({ step, skipped: true });
                if (!res.ok) return void toast.error(err(res.error));
                router.push(`/setup?step=${nextStep(step)}`);
              })
            }
          >
            {t("skip")}
          </Button>
        )}
        <Button type={primaryType} onClick={onPrimary} disabled={pending || skipping} data-testid="step-continue">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {primaryLabel ?? t("saveContinue")}
          {!pending && <Next className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

/** For steps that only link elsewhere: "Continue" marks the step done. */
export function ContinueFooter({ step }: { step: SetupStep }) {
  const router = useRouter();
  const err = useSetupError();
  const t = useTranslations("onboarding.setup");
  const [pending, start] = useTransition();
  return (
    <StepFooter
      step={step}
      pending={pending}
      primaryLabel={t("continue")}
      onPrimary={() =>
        start(async () => {
          const res = await markStepAction({ step, skipped: false });
          if (!res.ok) return void toast.error(err(res.error));
          router.push(`/setup?step=${nextStep(step)}`);
        })
      }
    />
  );
}

// ---------------------------------------------------------------------------------------------
// a. School profile

export type ProfileInitial = {
  nameEn: string;
  nameAr: string;
  shortNameEn: string;
  shortNameAr: string;
  primaryColor: string;
  accentColor: string;
  defaultLocale: "en" | "ar";
  weekDays: number[];
  timezone: string;
  regulator: "KHDA" | "ADEK" | "SPEA" | "MOE" | "OTHER";
  emirate: string;
  hijriEnabled: boolean;
  numerals: "WESTERN" | "ARABIC_INDIC";
};

export function ProfileStepForm({ initial, hasLogo }: { initial: ProfileInitial; hasLogo: boolean }) {
  const t = useTranslations("onboarding.setup.profile");
  const te = useTranslations("onboarding.emirates");
  const locale = useLocale();
  const router = useRouter();
  const err = useSetupError();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof ProfileInitial>(k: K, value: ProfileInitial[K]) => setV((p) => ({ ...p, [k]: value }));
  const primary = HEX_COLOR.test(v.primaryColor) ? v.primaryColor : "#0F4C81";
  const accent = HEX_COLOR.test(v.accentColor) ? v.accentColor : "#C8A24A";
  const short = (locale === "ar" ? v.shortNameAr || v.nameAr : v.shortNameEn || v.nameEn) || t("previewSchool");
  const save = () =>
    start(async () => {
      const res = await saveProfileStepAction({ ...v, timezone: v.timezone as (typeof TIMEZONES)[number] });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      router.push("/setup?step=year");
    });
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      data-testid="profile-form"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="nameEn" label={t("nameEn")}>
          <Input id="nameEn" dir="ltr" className="text-start" value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} required minLength={3} maxLength={120} />
        </Field>
        <Field id="nameAr" label={t("nameAr")}>
          <Input id="nameAr" dir="rtl" className="text-start" value={v.nameAr} onChange={(e) => set("nameAr", e.target.value)} required minLength={3} maxLength={120} />
        </Field>
        <Field id="shortNameEn" label={t("shortNameEn")} hint={t("shortHint")}>
          <Input id="shortNameEn" dir="ltr" className="text-start" value={v.shortNameEn} onChange={(e) => set("shortNameEn", e.target.value)} maxLength={40} />
        </Field>
        <Field id="shortNameAr" label={t("shortNameAr")} hint={t("shortHint")}>
          <Input id="shortNameAr" dir="rtl" className="text-start" value={v.shortNameAr} onChange={(e) => set("shortNameAr", e.target.value)} maxLength={40} />
        </Field>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,260px)]">
        <div className="space-y-4">
          <LogoUploader hasLogo={hasLogo} />
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField id="primaryColor" label={t("primaryColor")} value={v.primaryColor} onChange={(c) => set("primaryColor", c)} />
            <ColorField id="accentColor" label={t("accentColor")} value={v.accentColor} onChange={(c) => set("accentColor", c)} />
          </div>
        </div>
        <div aria-label={t("preview")} className="overflow-hidden rounded-xl border shadow-xs" data-testid="brand-preview">
          <div className="flex h-full min-h-40">
            <div className="flex w-20 flex-col gap-2 p-3" style={{ background: `color-mix(in oklch, ${primary} 55%, black)` }}>
              <span className="grid size-8 place-items-center rounded-lg text-xs font-bold" style={{ background: accent, color: `color-mix(in oklch, ${primary} 55%, black)` }}>
                {short.slice(0, 1)}
              </span>
              <span className="h-2 rounded bg-white/30" />
              <span className="h-2 rounded bg-white/15" />
              <span className="h-2 rounded bg-white/15" />
            </div>
            <div className="min-w-0 flex-1 space-y-3 bg-background p-3">
              <p className="truncate text-xs font-semibold">{short}</p>
              <span className="inline-block rounded-md px-2.5 py-1 text-xs font-medium text-white" style={{ background: primary }}>
                {t("previewButton")}
              </span>
              <span className="ms-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `color-mix(in oklch, ${accent} 20%, white)`, color: `color-mix(in oklch, ${accent} 70%, black)` }}>
                {t("previewBadge")}
              </span>
              <p className="text-[11px] text-muted-foreground">{t("previewHint")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="defaultLocale" label={t("defaultLocale")}>
          <select id="defaultLocale" className={selectClass} value={v.defaultLocale} onChange={(e) => set("defaultLocale", e.target.value as "en" | "ar")}>
            <option value="en">{t("english")}</option>
            <option value="ar">{t("arabic")}</option>
          </select>
        </Field>
        <Field id="timezone" label={t("timezone")}>
          <select id="timezone" className={selectClass} value={v.timezone} onChange={(e) => set("timezone", e.target.value)} dir="ltr">
            {TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field id="numerals" label={t("numerals")}>
          <select id="numerals" className={selectClass} value={v.numerals} onChange={(e) => set("numerals", e.target.value as ProfileInitial["numerals"])}>
            <option value="WESTERN">{t("western")}</option>
            <option value="ARABIC_INDIC">{t("arabicIndic")}</option>
          </select>
        </Field>
        <Field id="emirate" label={t("emirate")}>
          <select id="emirate" className={selectClass} value={v.emirate} onChange={(e) => set("emirate", e.target.value)}>
            {EMIRATES.map((e) => (
              <option key={e} value={e}>
                {te(e.replace(/\s+/g, ""))}
              </option>
            ))}
          </select>
        </Field>
        <Field id="regulator" label={t("regulator")}>
          <select id="regulator" className={selectClass} value={v.regulator} onChange={(e) => set("regulator", e.target.value as ProfileInitial["regulator"])}>
            {(["KHDA", "ADEK", "SPEA", "MOE", "OTHER"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`regulators.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={v.hijriEnabled} onCheckedChange={(c) => set("hijriEnabled", c)} aria-label={t("hijri")} />
            <span>
              <span className="font-medium">{t("hijri")}</span>
              <span className="block text-xs text-muted-foreground">{t("hijriHint")}</span>
            </span>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t("weekDays")}</p>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const on = v.weekDays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => set("weekDays", on ? v.weekDays.filter((x) => x !== d) : [...v.weekDays, d].sort())}
                className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", on ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted")}
              >
                {dayName(locale, d, "short")}
              </button>
            );
          })}
        </div>
      </div>

      <StepFooter step="profile" pending={pending} primaryType="submit" />
    </form>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const valid = HEX_COLOR.test(value);
  return (
    <Field id={id} label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1" />
        <Input id={id} dir="ltr" className="text-start font-mono uppercase" value={value} maxLength={7} onChange={(e) => onChange(e.target.value.trim())} aria-invalid={!valid} />
      </div>
    </Field>
  );
}

function LogoUploader({ hasLogo }: { hasLogo: boolean }) {
  const t = useTranslations("onboarding.setup.profile");
  const err = useSetupError();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [pending, start] = useTransition();
  const upload = (file: File) =>
    start(async () => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return void toast.error(err("TYPE"));
      if (file.size > 2 * 1024 * 1024) return void toast.error(err("TOO_LARGE"));
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body });
      if (!res.ok) return void toast.error(err(res.status === 413 ? "TOO_LARGE" : res.status === 415 ? "TYPE" : "generic"));
      const { key } = (await res.json()) as { key: string };
      const saved = await setLogoAction({ key });
      if (!saved.ok) return void toast.error(err(saved.error));
      toast.success(t("logoSaved"));
      setVersion(Date.now());
      router.refresh();
    });
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{t("logo")}</p>
      <div className="flex items-center gap-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {hasLogo ? <img src={`/api/org/logo?v=${version}`} alt={t("logoAlt")} className="size-full object-contain" /> : <ImageUp className="size-5 text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-testid="logo-input" />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {hasLogo ? t("logoReplace") : t("logoUpload")}
          </Button>
          {hasLogo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await setLogoAction({ key: null });
                  if (!res.ok) return void toast.error(err(res.error));
                  router.refresh();
                })
              }
            >
              {t("logoRemove")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// b. Academic year

type TermRow = { id?: string; nameEn: string; nameAr: string; startsOn: string; endsOn: string };

export function YearStepForm({ year }: { year: { id: string; nameEn: string; nameAr: string; startsOn: string; endsOn: string; terms: TermRow[] } }) {
  const t = useTranslations("onboarding.setup.year");
  const router = useRouter();
  const err = useSetupError();
  const [v, setV] = useState(year);
  const [pending, start] = useTransition();
  const setTerm = (i: number, patch: Partial<TermRow>) => setV((p) => ({ ...p, terms: p.terms.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveYearStepAction({ yearId: v.id, nameEn: v.nameEn, nameAr: v.nameAr, startsOn: v.startsOn, endsOn: v.endsOn, terms: v.terms });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("saved"));
          router.push("/setup?step=curricula");
        });
      }}
      data-testid="year-form"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="yearNameEn" label={t("nameEn")}>
          <Input id="yearNameEn" dir="ltr" className="text-start" value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} required />
        </Field>
        <Field id="yearNameAr" label={t("nameAr")}>
          <Input id="yearNameAr" dir="rtl" className="text-start" value={v.nameAr} onChange={(e) => setV({ ...v, nameAr: e.target.value })} required />
        </Field>
        <Field id="yearStart" label={t("startsOn")}>
          <Input id="yearStart" type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} required />
        </Field>
        <Field id="yearEnd" label={t("endsOn")}>
          <Input id="yearEnd" type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} required />
        </Field>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium">{t("terms")}</p>
        {v.terms.map((term, i) => (
          <div key={term.id ?? `new-${i}`} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end" data-testid="term-row">
            <Field id={`tEn${i}`} label={t("termNameEn")}>
              <Input id={`tEn${i}`} dir="ltr" className="text-start" value={term.nameEn} onChange={(e) => setTerm(i, { nameEn: e.target.value })} required />
            </Field>
            <Field id={`tAr${i}`} label={t("termNameAr")}>
              <Input id={`tAr${i}`} dir="rtl" className="text-start" value={term.nameAr} onChange={(e) => setTerm(i, { nameAr: e.target.value })} required />
            </Field>
            <Field id={`tS${i}`} label={t("startsOn")}>
              <Input id={`tS${i}`} type="date" value={term.startsOn} onChange={(e) => setTerm(i, { startsOn: e.target.value })} required />
            </Field>
            <Field id={`tE${i}`} label={t("endsOn")}>
              <Input id={`tE${i}`} type="date" value={term.endsOn} onChange={(e) => setTerm(i, { endsOn: e.target.value })} required />
            </Field>
            <Button type="button" variant="ghost" size="icon" aria-label={t("removeTerm")} disabled={v.terms.length <= 1} onClick={() => setV({ ...v, terms: v.terms.filter((_, j) => j !== i) })}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={v.terms.length >= 6}
          onClick={() => setV({ ...v, terms: [...v.terms, { nameEn: "", nameAr: "", startsOn: v.terms.at(-1)?.endsOn ?? v.startsOn, endsOn: v.endsOn }] })}
        >
          <Plus className="size-4" />
          {t("addTerm")}
        </Button>
      </div>
      <StepFooter step="year" pending={pending} primaryType="submit" />
    </form>
  );
}

export function AddHolidaysButton() {
  const t = useTranslations("onboarding.setup.year");
  const router = useRouter();
  const err = useSetupError();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      data-testid="add-uae-holidays"
      onClick={() =>
        start(async () => {
          const res = await addUaeHolidaysAction();
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("holidaysAdded", { n: res.added ?? 0 }));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {t("addHolidays")}
    </Button>
  );
}

// ---------------------------------------------------------------------------------------------
// c. Curricula

export function CurriculaStepForm({ initial }: { initial: string[] }) {
  const t = useTranslations("onboarding.setup.curricula");
  const tc = useTranslations("onboarding.curricula");
  const router = useRouter();
  const err = useSetupError();
  const [chosen, setChosen] = useState<string[]>(initial);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveCurriculaStepAction({ curricula: chosen as never });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("saved", { n: res.courses ?? 0 }));
          router.push("/setup?step=modules");
        });
      }}
      data-testid="curricula-form"
    >
      <div className="flex flex-wrap gap-2">
        {CURRICULA.map((c) => {
          const on = chosen.includes(c);
          return (
            <button key={c} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== c) : [...chosen, c])} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors", on ? "border-brand bg-brand-soft text-brand" : "hover:bg-muted")} data-testid={`curriculum-${c}`}>
              {on && <Check className="size-3.5" />}
              {tc(c)}
            </button>
          );
        })}
      </div>
      {chosen.length === 0 && <p className="text-sm text-danger">{t("pickOne")}</p>}
      <StepFooter step="curricula" pending={pending || chosen.length === 0} primaryType="submit" />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// d. Modules

export function ModulesStepForm({ initial }: { initial: OptionalModule[] }) {
  const t = useTranslations("onboarding.modules");
  const ts = useTranslations("onboarding.setup.modules");
  const router = useRouter();
  const err = useSetupError();
  const [on, setOn] = useState<OptionalModule[]>(initial);
  const [pending, start] = useTransition();
  const toggle = (k: OptionalModule, value: boolean) =>
    setOn((prev) => {
      let next = value ? [...new Set([...prev, k])] : prev.filter((x) => x !== k);
      // A module that needs another is switched off with it, and switching it on switches its parent on.
      if (!value) next = next.filter((x) => MODULE_REQUIRES[x] !== k);
      const parent = MODULE_REQUIRES[k];
      if (value && parent) next = [...new Set([...next, parent])];
      return next;
    });
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveModulesStepAction({ enabled: on });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(ts("saved"));
          router.push("/setup?step=people");
        });
      }}
      data-testid="modules-form"
    >
      <ul className="divide-y rounded-lg border">
        {OPTIONAL_MODULES.map((k) => (
          <li key={k} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t(`${k}.name`)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(`${k}.desc`)}</p>
            </div>
            <Switch checked={on.includes(k)} onCheckedChange={(c) => toggle(k, c)} aria-label={t(`${k}.name`)} data-testid={`module-${k}`} />
          </li>
        ))}
      </ul>
      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Lock className="size-4 text-muted-foreground" />
          {ts("coreTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{ts("coreBody")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CORE_MODULES.map((k) => (
            <span key={k} className="rounded-md bg-card px-2 py-1 text-xs">
              {t(`core.${k}`)}
            </span>
          ))}
        </div>
      </div>
      <StepFooter step="modules" pending={pending} primaryType="submit" />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// g. Done

export function FinishButton() {
  const t = useTranslations("onboarding.setup.done");
  const router = useRouter();
  const err = useSetupError();
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      disabled={pending}
      data-testid="finish-setup"
      onClick={() =>
        start(async () => {
          const res = await finishSetupAction();
          if (!res.ok) return void toast.error(err(res.error));
          router.push("/home");
        })
      }
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {t("goToSchool")}
    </Button>
  );
}
