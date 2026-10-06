import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, Download, MailCheck, SearchX } from "lucide-react";
import { isLocale } from "@/i18n/routing";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { Button } from "@/components/ui/button";
import { catalogDb } from "@/server/platform/catalog-db";
import { tasterByToken } from "@/server/marketing/leads";
import { areaExplanation, dimensionLabel } from "@/server/marketing/taster";
import { DIMENSIONS } from "@/server/career/dimensions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("growth.result");
  // Private link: keep it out of search engines.
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

async function load(token: string) {
  const db = catalogDb();
  if (!db) return null;
  try {
    return await tasterByToken(db, token);
  } catch {
    return null;
  }
}

export default async function TasterResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("growth.result");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;
  const data = await load(decodeURIComponent(token));

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader active="try" />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        {!data ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-dashed bg-card/50 p-10 text-center" data-testid="result-missing">
            <SearchX className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-4 text-xl font-semibold">{t("missingTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("missingBody")}</p>
            <Button asChild className="mt-6">
              <Link href="/try">{t("takeTaster")}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-8" data-testid="taster-result">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand">{t("eyebrow")}</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("title")}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{t("preparedFor", { name: data.lead.name })}</p>
              </div>
              <Button asChild variant="outline">
                <a href={`/try/result/${encodeURIComponent(token)}/pdf`} data-testid="result-pdf">
                  <Download className="size-4" />
                  {t("pdf")}
                </a>
              </Button>
            </div>
            {data.lead.emailStatus !== "FAILED" && (
              <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
                <MailCheck className="size-4 shrink-0" />
                {t("emailed")}
              </p>
            )}

            <section>
              <h2 className="text-lg font-semibold">{t("areasTitle")}</h2>
              <div className="mt-4 grid gap-4">
                {data.result.areas.slice(0, 3).map((a, i) => (
                  <article key={a.key} className="rounded-2xl border bg-card p-5 shadow-xs" data-testid="result-area">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2.5 font-semibold">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs text-white tabular-nums">{i + 1}</span>
                        {a.name[locale]}
                      </h3>
                      <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand tabular-nums">{t("match", { score: a.matchScore })}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{areaExplanation(a, locale)}</p>
                    <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("examples")}</p>
                    <ul className="mt-2 grid gap-3 md:grid-cols-3">
                      {a.careers.map((c) => (
                        <li key={c.key} className="rounded-xl bg-muted/50 p-3">
                          <p className="text-sm font-medium">{c.title[locale]}</p>
                          <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-muted-foreground">{c.summary[locale]}</p>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5 shadow-xs">
              <h2 className="text-lg font-semibold">{t("profileTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("profileBody")}</p>
              <ul className="mt-5 space-y-3">
                {[...DIMENSIONS]
                  .sort((x, y) => data.result.scores[y] - data.result.scores[x])
                  .map((d) => (
                    <li key={d} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr_3rem]">
                      <span className="truncate">{dimensionLabel(d, locale)}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${data.result.scores[d]}%` }} />
                      </span>
                      <span className="text-end tabular-nums text-muted-foreground">{data.result.scores[d]}</span>
                    </li>
                  ))}
              </ul>
            </section>

            <section className="rounded-2xl border bg-brand-soft/40 p-5">
              <h2 className="text-lg font-semibold">{t("nextTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("nextBody")}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/demo">
                    {t("nextDemo")}
                    <Arrow className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/pricing">{t("nextSchool")}</Link>
                </Button>
              </div>
            </section>
            <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
