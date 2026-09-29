import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { fmtDate, type FormatPrefs } from "@/lib/format";
import { Pill, type Tone } from "@/components/app/badges";

const TONE: Record<string, Tone> = { VERIFIED: "success", OFFICIAL: "info", REVIEWED: "info", EXTRACTED: "warning", EXAMPLE: "warning", UNKNOWN: "neutral" };

/**
 * Data freshness badge: when the requirement data was checked, its confidence label and a link to the
 * official source page. EXAMPLE data is labeled "Example data, confirm on the official page".
 * Works in server and client components.
 */
export function DataFreshnessBadge({
  checkedAt,
  confidence,
  sourceUrl,
  prefs,
  className,
}: {
  checkedAt: Date | string | null | undefined;
  confidence: string;
  sourceUrl?: string | null;
  prefs?: FormatPrefs;
  className?: string;
}) {
  const t = useTranslations("catalog");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const p = prefs ?? { locale };
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 text-xs ${className ?? ""}`} data-testid="data-freshness">
      <Pill tone={TONE[confidence] ?? "neutral"}>
        <ShieldCheck className="size-3" />
        {confidence === "EXAMPLE" ? t("exampleData") : t(`confidence.${confidence}`)}
      </Pill>
      <span className="text-muted-foreground">{checkedAt ? t("freshness.checked", { date: fmtDate(p, checkedAt) }) : t("freshness.notChecked")}</span>
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
          {t("freshness.source")}
          <ExternalLink className="size-3" />
        </a>
      )}
    </span>
  );
}
