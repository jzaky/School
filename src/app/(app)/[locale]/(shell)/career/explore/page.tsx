import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { ExplorerGrid } from "@/components/career/explorer-grid";

export async function generateMetadata() {
  const t = await getTranslations("career");
  return { title: t("explorer") };
}

export default async function ExplorePage() {
  const ctx = await getCtx();
  const t = await getTranslations("career");
  const prefs = await formatPrefs(ctx);
  const careers = await ctx.db.career.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ clusterEn: "asc" }, { titleEn: "asc" }] });
  return (
    <PageBody>
      <PageHeader title={t("explorer")} description={t("explorerSubtitle", { count: careers.length })} />
      <ExplorerGrid
        careers={careers.map((c) => ({
          key: c.key,
          title: pick(ctx.locale, c.titleEn, c.titleAr),
          cluster: pick(ctx.locale, c.clusterEn, c.clusterAr),
          summary: pick(ctx.locale, c.summaryEn, c.summaryAr),
          salary: c.salaryMinAed ? t("salary", { min: fmtNumber(prefs, c.salaryMinAed), max: fmtNumber(prefs, c.salaryMaxAed ?? c.salaryMinAed) }) : "",
          demand: c.uaeDemand,
          keywords: `${c.titleEn} ${c.titleAr} ${c.clusterEn} ${c.clusterAr} ${c.skillsEn.join(" ")}`,
        }))}
      />
    </PageBody>
  );
}
