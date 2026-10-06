import { getTranslations } from "next-intl/server";
import { Gift, Info, School, Share2 } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { platformAdminPage, platformDb } from "@/server/platform/admin";
import { referralOverview } from "@/server/platform/referrals";

export async function generateMetadata() {
  const t = await getTranslations("growth.platform");
  return { title: t("referralsTitle") };
}

export default async function PlatformReferralsPage() {
  const ctx = await platformAdminPage();
  const t = await getTranslations("growth.platform");
  const { locale } = ctx;
  const data = await referralOverview(platformDb());
  const n = (v: number) => fmtNumber({ locale }, v);
  return (
    <PageBody>
      <PageHeader eyebrow={t("eyebrow")} title={t("referralsTitle")} description={t("referralsBody")} />
      <p className="flex items-start gap-2 rounded-xl border border-gold/40 bg-gold-soft/50 px-4 py-3 text-sm" data-testid="referrals-terms">
        <Info className="mt-0.5 size-4 shrink-0 text-[oklch(0.5_0.1_80)]" />
        {t("referralsTerms")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("statReferrers")} value={n(data.rows.length)} icon={<Share2 className="size-5" />} />
        <StatCard label={t("statReferred")} value={n(data.totalReferred)} icon={<School className="size-5" />} tone="success" />
        <StatCard label={t("statCodes")} value={n(data.withCodes)} icon={<Gift className="size-5" />} tone="gold" />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState icon={<Share2 className="size-5" />} title={t("referralsEmptyTitle")} body={t("referralsEmptyBody")} />
      ) : (
        <div className="space-y-4" data-testid="referrals-list">
          {data.rows.map((r) => (
            <Panel key={r.id}>
              <PanelHeader
                title={pick(locale, r.nameEn, r.nameAr)}
                description={t("referrerCode", { code: r.referralCode ?? "-" })}
                action={<span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand tabular-nums">{t("referredCount", { n: r.schools.length })}</span>}
              />
              <ul className="divide-y text-sm">
                {r.schools.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{pick(locale, s.nameEn, s.nameAr)}</span>
                    <span className="text-xs text-muted-foreground">{t("signedUpOn", { date: fmtDate({ locale }, s.createdAt) })}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </PageBody>
  );
}
