import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { getCtx } from "@/server/context";
import { Link } from "@/i18n/navigation";
import { RequirementHistory } from "@/components/catalog/requirement-history";
import { programLabels } from "@/server/catalog-pipeline/page-data";

export default async function CatalogProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("catalog");
  const labels = await programLabels(ctx, [id]);
  const l = labels.get(id);
  if (!l) notFound();
  return (
    <div className="space-y-4">
      <Link href="/career/catalog/changes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("history.back")}
      </Link>
      <div>
        <h2 className="text-lg font-semibold" data-testid="program-title">
          {l.program}
        </h2>
        <p className="text-sm text-muted-foreground">{l.university}</p>
      </div>
      <RequirementHistory programId={id} showActions />
    </div>
  );
}
