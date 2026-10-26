"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Label } from "@/components/ui/label";
import { Pill, type Tone } from "@/components/app/badges";

export const selectClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 aria-invalid:border-destructive";

/** A labelled form field with an optional hint and error. */
export function Field({ id, label, hint, error, children, className, optional }: { id: string; label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; className?: string; optional?: boolean }) {
  const t = useTranslations("admissions.form");
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="flex items-baseline gap-1.5 text-sm">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">{t("optional")}</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function useGrade() {
  const t = useTranslations("gradeLevel");
  return (g: number) => t("label", gradeLevelValues(g));
}

const STAGE_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  NEW: "info",
  DOCUMENTS_PENDING: "warning",
  ASSESSMENT_BOOKED: "brand",
  ASSESSED: "brand",
  OFFER_MADE: "gold",
  OFFER_ACCEPTED: "success",
  SEAT_PAID: "success",
  ENROLLED: "success",
  WAITLISTED: "violet",
  DECLINED: "neutral",
  WITHDRAWN: "neutral",
};

/** A stage with the school's own label when it renamed it. */
export function StagePill({ stage, label }: { stage: string; label?: string | null }) {
  const t = useTranslations("admissions.stage");
  return (
    <Pill tone={STAGE_TONE[stage] ?? "brand"} dot>
      {label || (t.has(stage) ? t(stage) : stage)}
    </Pill>
  );
}

export function stageLabel(t: (k: string) => string, has: (k: string) => boolean, s: { key: string; labelEn: string | null; labelAr: string | null }, locale: string) {
  const own = locale === "ar" ? s.labelAr || s.labelEn : s.labelEn || s.labelAr;
  return own || (has(s.key) ? t(s.key) : s.key);
}

export function formatBytes(n: number, locale: string) {
  const f = (x: number, unit: string) => `${new Intl.NumberFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en", { maximumFractionDigits: 1 }).format(x)} ${unit}`;
  if (n < 1024 * 1024) return f(Math.max(1, Math.round(n / 1024)), "KB");
  return f(n / (1024 * 1024), "MB");
}
