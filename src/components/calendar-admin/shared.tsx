"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Error text for an action error code, from the calendarAdmin.error namespace. */
export function useActionError() {
  const t = useTranslations("calendarAdmin");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export function Field({ label, htmlFor, children, className, hint }: { label: string; htmlFor?: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Toggle chips for grade levels. */
export function GradePicker({ grades, value, onChange, testId }: { grades: number[]; value: number[]; onChange: (v: number[]) => void; testId?: string }) {
  const t = useTranslations("calendarAdmin");
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {grades.map((g) => {
        const on = value.includes(g);
        return (
          <button
            key={g}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== g) : [...value, g].sort((a, b) => a - b))}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", on ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}
            data-testid={`grade-${g}`}
          >
            {t("gradeN", { grade: g })}
          </button>
        );
      })}
    </div>
  );
}

/** Toggle chips for a small set of string options. */
export function ChipPicker({ options, value, onChange }: { options: Array<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", on ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}
            data-testid={`chip-${o.value}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
