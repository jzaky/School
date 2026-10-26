"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { formatAed, parseAedToFils } from "@/server/fees/money";

/** Error text for an action error code (finance.error.*). */
export function useFeeError() {
  const t = useTranslations("finance.error");
  return (code?: string) => (code && t.has(code) ? t(code) : t("generic"));
}

export function Field({ label, htmlFor, children, className, hint }: { label: string; htmlFor?: string; children: React.ReactNode; className?: string; hint?: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Amount in AED typed as text ("18,500.00"); the form converts it to fils with parseAed. */
export function AmountInput({ id, value, onChange, testId }: { id: string; value: string; onChange: (v: string) => void; testId?: string }) {
  const t = useTranslations("finance");
  const invalid = value.trim() !== "" && parseAedToFils(value) === null;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-xs font-medium text-muted-foreground">{t("aed")}</span>
      <Input id={id} dir="ltr" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} className="ps-12 tabular-nums" data-testid={testId} />
    </div>
  );
}

export const filsToInput = (fils: number | null | undefined) => (fils === null || fils === undefined ? "" : formatAed(fils, "en", { currency: false }));
export const parseAed = (s: string) => parseAedToFils(s);

/** Percent typed as text ("5" or "2.5"), stored as basis points. */
export const bpToInput = (bp: number | null | undefined) => (bp === null || bp === undefined ? "" : String(bp / 100));
export function parsePercent(s: string): number | null {
  const t = s.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp <= 10_000 ? bp : null;
}

export function ToggleRow({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** Grade chips from KG1 to Grade 12. */
export function GradeChips({ value, onChange, single, testId }: { value: number[]; onChange: (v: number[]) => void; single?: boolean; testId?: string }) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {ALL_GRADE_LEVELS.map((g) => {
        const on = value.includes(g);
        return (
          <button
            key={g}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(single ? [g] : on ? value.filter((x) => x !== g) : [...value, g].sort((a, b) => a - b))}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", on ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}
            data-testid={`grade-${g}`}
          >
            {t("gradeLevel.label", gradeLevelValues(g))}
          </button>
        );
      })}
    </div>
  );
}

export { dayInput, todayInput } from "@/server/fees/money";

/** A stable random key for one form submission (idempotent recording of a payment). */
export function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
