import { useTranslations } from "next-intl";
import { GraduationCap } from "lucide-react";
import { Pill } from "@/components/app/badges";
import { cn } from "@/lib/utils";
import type { LevelGuide } from "@/server/pathway-engine/level-guide";
import { LEVEL_TONE, levelHint, levelLabel, type Tr } from "./labels";

/** The level a requirement line asks for, in the curriculum's own terms, with the reason on hover. */
export function LevelChip({ guide, advisory, className }: { guide: LevelGuide | undefined; advisory?: boolean; className?: string }) {
  const t = useTranslations("engine") as unknown as Tr;
  const label = levelLabel(t, guide, advisory);
  if (!guide || !label) return null;
  const hint = levelHint(t, guide);
  const strong = guide.cls === "AP_REQUIRED" || guide.cls === "A_LEVEL" || guide.cls === "IB_HL";
  return (
    <span title={hint ?? undefined} className={cn("inline-flex", className)} data-testid="level-chip" data-level={guide.cls}>
      <Pill tone={advisory ? "neutral" : LEVEL_TONE[guide.cls]}>
        {strong && <GraduationCap className="size-3" />}
        {label}
      </Pill>
    </span>
  );
}
