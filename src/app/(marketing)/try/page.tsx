import { getLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { CareerTaster } from "@/components/marketing/taster";
import { TASTER_QUESTIONS } from "@/server/marketing/taster";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("growth.taster");
  return { title: t("metaTitle"), description: t("body") };
}

export default async function TryPage() {
  const t = await getTranslations("growth.taster");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const questions = TASTER_QUESTIONS.map((q) => ({ id: q.id, text: q.text[locale] }));
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader active="try" />
      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,var(--brand-soft),transparent_65%)]" />
        <div className="relative mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
          <p className="text-sm font-medium text-brand">{t("eyebrow")}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{t("body")}</p>
          <div className="mt-8">
            <CareerTaster questions={questions} locale={locale} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
