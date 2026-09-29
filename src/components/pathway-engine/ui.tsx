import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed, CircleHelp, XCircle } from "lucide-react";
import { Pill } from "@/components/app/badges";
import { cn } from "@/lib/utils";
import type { Confidence, LineStatus, MatchStatus } from "@/server/pathway-engine/types";
import { STATUS_TONE } from "./labels";

export function StatusChip({ status, className }: { status: MatchStatus; className?: string }) {
  const t = useTranslations("engine");
  return (
    <Pill tone={STATUS_TONE[status]} dot className={className}>
      <span data-testid={`status-${status}`}>{t(`status.${status}`)}</span>
    </Pill>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const t = useTranslations("engine");
  const tone = confidence === "VERIFIED" || confidence === "REVIEWED" ? "success" : confidence === "EXAMPLE" ? "warning" : "neutral";
  return (
    <Pill tone={tone} className="whitespace-normal">
      <span data-testid="confidence-badge">{t(`confidence.${confidence}`)}</span>
    </Pill>
  );
}

export function LineStatusIcon({ status, advisory, className }: { status: LineStatus; advisory?: boolean; className?: string }) {
  const t = useTranslations("engine");
  const label = t(`lineStatus.${status}`);
  if (status === "met") return <CheckCircle2 aria-label={label} className={cn("size-4 shrink-0 text-success", className)} />;
  if (status === "not_met") return advisory ? <CircleDashed aria-label={label} className={cn("size-4 shrink-0 text-muted-foreground", className)} /> : <XCircle aria-label={label} className={cn("size-4 shrink-0 text-danger", className)} />;
  return <CircleHelp aria-label={label} className={cn("size-4 shrink-0 text-info", className)} />;
}
