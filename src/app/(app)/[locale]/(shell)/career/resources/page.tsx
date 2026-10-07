import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExternalLink, Handshake, Info, MousePointerClick } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { DeletePartnerButton, PartnerDialog } from "@/components/career-events/partner-forms";
import { viewerAudience } from "@/server/partners/service";

export async function generateMetadata() {
  const t = await getTranslations("partners");
  return { title: t("title") };
}

export default async function PartnerResourcesPage() {
  const ctx = await getCtx();
  const t = await getTranslations("partners");
  const audience = viewerAudience(ctx);
  const manager = ctx.isStaff && ctx.can("career.partners");
  if (!audience && !manager && !ctx.can("career.advise")) notFound();
  const rows = await ctx.db.partnerResource.findMany({
    where: audience ? { active: true, audience: { has: audience } } : {},
    orderBy: [{ active: "desc" }, { category: "asc" }, { nameEn: "asc" }],
  });
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  };

  return (
    <PageBody>
      <PageHeader title={t("title")} description={audience ? t("subtitleFamily") : t("subtitleManage")} actions={manager ? <PartnerDialog /> : null} />
      {audience && rows.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          {t("outsideNote")}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={<Handshake className="size-5" />} title={t("empty")} body={manager ? t("emptyManage") : t("emptyFamily")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {rows.map((r) => (
            <div key={r.id} data-testid="partner-card">
            <Panel className="flex h-full flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone="brand">{t(`category.${r.category}`)}</Pill>
                {r.isExample && (
                  <Pill tone="gold" className="cursor-help">
                    <span title={t("exampleHint")}>{t("example")}</span>
                  </Pill>
                )}
                {!audience && (r.active ? <Pill tone="success">{t("active")}</Pill> : <Pill tone="neutral">{t("inactive")}</Pill>)}
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold">{pick(ctx.locale, r.nameEn, r.nameAr)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{pick(ctx.locale, r.descEn, r.descAr)}</p>
              </div>
              {!audience && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{r.audience.map((a) => t(`audience.${a}`)).join(" · ")}</span>
                  <span className="flex items-center gap-1" data-testid="partner-clicks">
                    <MousePointerClick className="size-3.5" />
                    {t("clicks", { count: r.clickCount })}
                  </span>
                  <span dir="ltr" className="truncate">
                    {host(r.url)}
                  </span>
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                <Button variant={audience ? "default" : "outline"} size="sm" asChild>
                  <a href={`/api/career/resources/${r.id}/go`} target="_blank" rel="noopener noreferrer" data-testid="partner-open">
                    <ExternalLink className="size-4" />
                    {audience ? t("open") : t("preview")}
                  </a>
                </Button>
                {manager && (
                  <span className="ms-auto flex gap-1">
                    <PartnerDialog initial={{ id: r.id, nameEn: r.nameEn, nameAr: r.nameAr, descEn: r.descEn, descAr: r.descAr, category: r.category, url: r.url, audience: r.audience, active: r.active }} />
                    <DeletePartnerButton id={r.id} />
                  </span>
                )}
              </div>
            </Panel>
            </div>
          ))}
        </div>
      )}
    </PageBody>
  );
}
