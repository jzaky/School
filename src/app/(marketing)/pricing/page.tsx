import { getLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { PricingEstimator } from "@/components/marketing/pricing-estimator";
import { catalogDb } from "@/server/platform/catalog-db";
import { getPricingSafe } from "@/server/marketing/pricing-store";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("growth.pricing");
  return { title: t("metaTitle"), description: t("body") };
}

export default async function PricingPage() {
  const t = await getTranslations("growth.pricing");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const pricing = await getPricingSafe(catalogDb());
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader active="pricing" />
      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,var(--brand-soft),transparent_65%)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
          <p className="text-sm font-medium text-brand">{t("eyebrow")}</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{t("body")}</p>
          <div className="mt-10">
            <PricingEstimator pricing={pricing} locale={locale} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
