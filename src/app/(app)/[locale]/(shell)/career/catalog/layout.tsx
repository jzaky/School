import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";
import { getCtx } from "@/server/context";
import { moduleEnabled } from "@/lib/modules";
import { catalogUiState } from "@/server/catalog-pipeline/access";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { CatalogTabs } from "@/components/catalog/catalog-client";

export async function generateMetadata() {
  const t = await getTranslations("catalog");
  return { title: t("title") };
}

export default async function CatalogLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx.can("catalog.review") || !moduleEnabled(ctx.org, "pathways")) notFound();
  const t = await getTranslations("catalog");
  const { writeDenial } = catalogUiState(ctx);
  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitle")} />
      {writeDenial && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm" data-testid="catalog-readonly">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t("readOnly")}</div>
            <div className="text-muted-foreground">{t(`error.${writeDenial}`)}</div>
          </div>
        </div>
      )}
      <CatalogTabs />
      {children}
    </PageBody>
  );
}
