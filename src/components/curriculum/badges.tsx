import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Pill, type Tone } from "@/components/app/badges";

const PLAN_TONE: Record<string, Tone> = { DRAFT: "neutral", SUBMITTED: "info", CHANGES_REQUESTED: "warning", APPROVED: "success" };

export function PlanStatusBadge({ status }: { status: string }) {
  const t = useTranslations("curriculum.status");
  return (
    <Pill tone={PLAN_TONE[status] ?? "neutral"} dot>
      {t(status)}
    </Pill>
  );
}

export function AiDraftedBadge() {
  const t = useTranslations("curriculum");
  return (
    <Pill tone="violet">
      <Sparkles className="size-3" />
      {t("aiDrafted")}
    </Pill>
  );
}

const COVER_TONE: Record<string, Tone> = { missing: "danger", once: "warning", covered: "success" };

export function CoverageBadge({ status }: { status: "missing" | "once" | "covered" }) {
  const t = useTranslations("curriculum.coverage");
  return <Pill tone={COVER_TONE[status]}>{t(`state.${status}`)}</Pill>;
}
