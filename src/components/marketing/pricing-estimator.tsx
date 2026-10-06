"use client";

import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, CheckCircle2, Clock, FileText, Loader2, MessageSquare, RotateCcw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ASSUMPTION_LIMITS,
  CAMPUS_LIMITS,
  computeRoi,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_STAFF_COST_PER_HOUR,
  MODULES,
  priceQuote,
  STUDENT_LIMITS,
  withCore,
  type PricingConfig,
  type PricingModule,
  type RoiAssumptions,
  type RoiCategory,
} from "@/lib/roi";
import { requestOfferAction, type LeadState } from "@/server/marketing/actions";
import { LeadContactFields } from "./lead-fields";

const CATEGORIES: Array<{ key: RoiCategory; icon: typeof FileText; fields: Array<keyof RoiAssumptions> }> = [
  { key: "letters", icon: FileText, fields: ["lettersPerStudentYear", "minutesPerLetter"] },
  { key: "absence", icon: UserX, fields: ["absencesPerStudentMonth", "minutesPerAbsence"] },
  { key: "meetings", icon: CalendarClock, fields: ["meetingsPerStudentYear", "minutesPerMeeting"] },
  { key: "communication", icon: MessageSquare, fields: ["messagesPerStudentMonth", "minutesPerMessage"] },
];

function NumberField({ id, label, value, onChange, min, max, step, suffix, testId }: { id: string; label: React.ReactNode; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string; testId?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            const v = e.target.value === "" ? NaN : Number(e.target.value);
            onChange(v);
          }}
          onBlur={() => onChange(Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min)}
          className="w-28 tabular-nums"
          dir="ltr"
          data-testid={testId}
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function PricingEstimator({ pricing, locale }: { pricing: PricingConfig; locale: "en" | "ar" }) {
  const t = useTranslations("growth.pricing");
  const [students, setStudents] = useState(600);
  const [campuses, setCampuses] = useState(1);
  const [modules, setModules] = useState<PricingModule[]>(["core", "safeguarding"]);
  const [plan, setPlan] = useState<"pilot" | "year">("pilot");
  const [cost, setCost] = useState(DEFAULT_STAFF_COST_PER_HOUR);
  const [a, setA] = useState<RoiAssumptions>(DEFAULT_ASSUMPTIONS);
  const [state, action, pending] = useActionState<LeadState, FormData>(requestOfferAction, { error: null });

  const safeStudents = Number.isFinite(students) ? Math.round(Math.min(STUDENT_LIMITS.max, Math.max(STUDENT_LIMITS.min, students))) : STUDENT_LIMITS.min;
  const safeCampuses = Number.isFinite(campuses) ? Math.round(Math.min(CAMPUS_LIMITS.max, Math.max(CAMPUS_LIMITS.min, campuses))) : CAMPUS_LIMITS.min;
  const safeCost = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  const safeA = useMemo(() => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Number.isFinite(v) ? v : 0])) as RoiAssumptions, [a]);
  const roi = computeRoi({ students: safeStudents, staffCostPerHour: safeCost, assumptions: safeA });
  const chosen = withCore(modules);
  const quote = priceQuote(pricing, { students: safeStudents, campuses: safeCampuses, modules: chosen, plan });
  const num = (n: number, opts?: Intl.NumberFormatOptions) => fmtNumber({ locale }, n, opts);
  const money = (n: number) => num(n, { style: "currency", currency: pricing.currency, maximumFractionDigits: 0 });
  const inputs = { students: safeStudents, campuses: safeCampuses, modules: chosen, plan, staffCostPerHour: safeCost, assumptions: safeA };
  const changed = JSON.stringify(a) !== JSON.stringify(DEFAULT_ASSUMPTIONS) || cost !== DEFAULT_STAFF_COST_PER_HOUR;

  const toggle = (m: PricingModule) => setModules((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-start">
      <div className="space-y-6">
        {/* School */}
        <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
          <h2 className="font-semibold">{t("schoolTitle")}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <NumberField id="students" label={t("students")} value={students} onChange={setStudents} min={STUDENT_LIMITS.min} max={STUDENT_LIMITS.max} step={10} testId="pricing-students" />
            <NumberField id="campuses" label={t("campuses")} value={campuses} onChange={setCampuses} min={CAMPUS_LIMITS.min} max={CAMPUS_LIMITS.max} step={1} testId="pricing-campuses" />
          </div>
          <fieldset className="mt-6">
            <legend className="text-sm font-medium">{t("modulesTitle")}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {MODULES.map((m) => {
                const on = chosen.includes(m);
                const box = (
                  <label
                    key={m}
                    className={cn("flex items-start gap-3 rounded-xl border p-3 text-sm transition", on && "border-brand/50 bg-brand-soft/40", m === "core" ? "cursor-default" : "cursor-pointer hover:border-brand/40")}
                  >
                    <input type="checkbox" checked={on} disabled={m === "core"} onChange={() => toggle(m)} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" data-testid={`pricing-module-${m}`} />
                    <span>
                      <span className="block font-medium">{t(`module.${m}`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`moduleDesc.${m}`)}</span>
                    </span>
                  </label>
                );
                return m === "core" ? (
                  <Tooltip key={m}>
                    <TooltipTrigger asChild>{box}</TooltipTrigger>
                    <TooltipContent>{t("coreAlways")}</TooltipContent>
                  </Tooltip>
                ) : (
                  box
                );
              })}
            </div>
          </fieldset>
          <fieldset className="mt-6">
            <legend className="text-sm font-medium">{t("plan")}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(["pilot", "year"] as const).map((p) => (
                <label key={p} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", plan === p && "border-brand/50 bg-brand-soft/40")}>
                  <input type="radio" name="plan-choice" checked={plan === p} onChange={() => setPlan(p)} className="mt-0.5 accent-[var(--brand)]" data-testid={`pricing-plan-${p}`} />
                  <span>
                    <span className="block font-medium">{t(`planName.${p}`)}</span>
                    <span className="block text-xs text-muted-foreground">{p === "pilot" ? t("planDesc.pilot", { months: pricing.pilotMonths }) : t("planDesc.year")}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        {/* Assumptions */}
        <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6" data-testid="pricing-assumptions">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">{t("assumptionsTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("assumptionsBody")}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!changed}
              onClick={() => {
                setA(DEFAULT_ASSUMPTIONS);
                setCost(DEFAULT_STAFF_COST_PER_HOUR);
              }}
            >
              <RotateCcw className="size-4" />
              {t("reset")}
            </Button>
          </div>
          <div className="mt-5 space-y-5">
            <div className="rounded-xl border border-dashed p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                {t("costTitle")}
                <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-[oklch(0.5_0.1_80)]">{t("assumptionTag")}</span>
              </p>
              <NumberField id="cost" label={t("staffCost", { currency: pricing.currency })} value={cost} onChange={setCost} min={0} max={10000} step={5} testId="pricing-cost" />
            </div>
            {CATEGORIES.map(({ key, icon: I, fields }) => (
              <div key={key} className="rounded-xl border border-dashed p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <I className="size-4 text-brand" />
                  {t(`category.${key}`)}
                  <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-[oklch(0.5_0.1_80)]">{t("assumptionTag")}</span>
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((f) => (
                    <NumberField key={f} id={f} label={t(`assumption.${f}`)} value={a[f]} onChange={(v) => setA((cur) => ({ ...cur, [f]: v }))} {...ASSUMPTION_LIMITS[f]} testId={`assumption-${f}`} />
                  ))}
                </div>
              </div>
            ))}
            <div className="rounded-xl border border-dashed p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                {t("yearTitle")}
                <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-[oklch(0.5_0.1_80)]">{t("assumptionTag")}</span>
              </p>
              <NumberField id="schoolMonthsPerYear" label={t("assumption.schoolMonthsPerYear")} value={a.schoolMonthsPerYear} onChange={(v) => setA((cur) => ({ ...cur, schoolMonthsPerYear: v }))} {...ASSUMPTION_LIMITS.schoolMonthsPerYear} testId="assumption-schoolMonthsPerYear" />
            </div>
          </div>
        </section>
      </div>

      <div className="space-y-6 lg:sticky lg:top-24">
        {/* Savings */}
        <section className="rounded-2xl border bg-[#0f2742] p-5 text-white shadow-sm sm:p-6" data-testid="pricing-roi">
          <p className="flex items-center gap-2 text-sm font-medium text-[#E9C46A]">
            <Clock className="size-4" />
            {t("savingsTitle")}
          </p>
          <p className="mt-3 text-4xl font-semibold tabular-nums tracking-tight" data-testid="roi-hours">
            {t("hoursMonth", { hours: num(roi.totalHoursMonth, { maximumFractionDigits: 1 }) })}
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {CATEGORIES.map(({ key, icon: I }) => (
              <li key={key} className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                <span className="flex items-center gap-2 text-white/80">
                  <I className="size-4" />
                  {t(`category.${key}`)}
                </span>
                <span className="tabular-nums">{t("hoursShort", { hours: num(roi.hours[key], { maximumFractionDigits: 1 }) })}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/[0.06] p-3">
              <p className="text-xs text-white/70">{t("valueMonth")}</p>
              <p className="mt-1 font-semibold tabular-nums" data-testid="roi-value-month">
                {money(roi.valueMonth)}
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.06] p-3">
              <p className="text-xs text-white/70">{t("valueYear", { months: safeA.schoolMonthsPerYear })}</p>
              <p className="mt-1 font-semibold tabular-nums">{money(roi.valueYear)}</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/60">{t("estimateNote")}</p>
        </section>

        {/* Price */}
        <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6" data-testid="pricing-price">
          <h2 className="font-semibold">{t("priceTitle")}</h2>
          {quote ? (
            <div className="mt-4 space-y-2 text-sm" data-testid="pricing-quote">
              {quote.lines.map((l) => (
                <div key={l.module} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t(`module.${l.module}`)} <span className="text-xs">({t("perStudentYear", { amount: money(l.perStudent) })})</span>
                  </span>
                  <span className="tabular-nums">{money(l.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t pt-2">
                <span className="text-muted-foreground">{t("annualList")}</span>
                <span className="tabular-nums">{money(quote.annualList)}</span>
              </div>
              {plan === "pilot" && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t("pilotPeriod", { months: quote.months })}</span>
                  <span className="tabular-nums">{money((quote.annualList * quote.months) / 12)}</span>
                </div>
              )}
              {quote.discount > 0 && (
                <div className="flex items-center justify-between gap-3 text-success">
                  <span>{t("pilotDiscount", { pct: pricing.pilotDiscountPct })}</span>
                  <span className="tabular-nums">-{money(quote.discount)}</span>
                </div>
              )}
              {quote.minimumApplied && <p className="text-xs text-muted-foreground">{t("minimumApplied", { amount: money(quote.minimum) })}</p>}
              <div className="flex items-center justify-between gap-3 border-t pt-3 text-base font-semibold">
                <span>{plan === "pilot" ? t("totalPilot") : t("totalYear")}</span>
                <span className="tabular-nums" data-testid="pricing-total">
                  {money(quote.total)}
                </span>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">{t("priceNote")}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="pricing-no-price">
              {t("noPrice")}
            </p>
          )}
        </section>

        {/* Offer */}
        <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6" id="offer">
          <h2 className="font-semibold">{t("requestTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("requestBody")}</p>
          {state.ok ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success" role="status" data-testid="offer-sent">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {t("sent")}
            </p>
          ) : (
            <form action={action} className="mt-4 space-y-4" data-testid="offer-form">
              <input type="hidden" name="inputs" value={JSON.stringify(inputs)} />
              <LeadContactFields locale={locale} state={state} schoolRequired consentText={t("consent")} defaultRole="STAFF" />
              <Button type="submit" className="w-full sm:w-auto" disabled={pending} data-testid="offer-submit">
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? t("sending") : t("requestCta")}
              </Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
