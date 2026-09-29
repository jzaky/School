// Tells the reader where requirement data comes from. While any example rows remain in the catalog
// it warns about them; once everything comes from official pages it says so, with the usual advice
// to confirm on the university's page before applying.
import { getTranslations } from "next-intl/server";
import { Info } from "lucide-react";
import type { Ctx } from "@/server/context";
import { catalogScope } from "@/server/pathways/scope";
import { cn } from "@/lib/utils";

export async function CatalogNotice({ ctx, className }: { ctx: Ctx; className?: string }) {
  const t = await getTranslations("engine");
  const examples = await ctx.db.programRequirement.count({ where: { isCurrent: true, confidence: "EXAMPLE", ...catalogScope(ctx.orgId) } });
  const example = examples > 0;
  return (
    <div
      className={cn("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm", example ? "border-warning/40 bg-warning-soft/40" : "border-info/30 bg-info-soft/40", className)}
      data-testid={example ? "example-banner" : "official-banner"}
    >
      <Info className="mt-0.5 size-4 shrink-0" />
      <span>{example ? t("exampleBanner") : t("officialBanner")}</span>
    </div>
  );
}
