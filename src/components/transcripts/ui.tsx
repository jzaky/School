// Small display pieces shared by the transcript, course record, catalog and dashboard views.
// No "use client": they render on the server and inside client components.
import { useTranslations } from "next-intl";
import { Pill, type Tone } from "@/components/app/badges";
import { cn } from "@/lib/utils";

const MAPPING_TONE: Record<string, Tone> = { AUTO: "info", CONFIRMED: "success", NEEDS_REVIEW: "warning", LOCAL: "neutral" };

/** Mapping status of a course record row or an import row decision. */
export function MappingChip({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("transcripts.mapping");
  return (
    <Pill tone={MAPPING_TONE[status] ?? "neutral"} dot className={className}>
      <span data-testid={`mapping-${status}`}>{t(status)}</span>
    </Pill>
  );
}

/** Match confidence as a small bar and percentage. */
export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const t = useTranslations("transcripts");
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? "bg-success" : value >= 0.4 ? "bg-warning" : "bg-danger";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)} title={t("confidenceHint")}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums" data-testid="confidence">
        {t("confidence", { pct })}
      </span>
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = { COMPLETED: "success", IN_PROGRESS: "brand", PLANNED: "neutral" };

export function CourseStatusChip({ status }: { status: string }) {
  const t = useTranslations("transcripts.courseStatus");
  return <Pill tone={STATUS_TONE[status] ?? "neutral"}>{t(status)}</Pill>;
}

export function SourceChip({ source }: { source: string }) {
  const t = useTranslations("transcripts.source");
  return <Pill>{t.has(source) ? t(source) : source}</Pill>;
}
