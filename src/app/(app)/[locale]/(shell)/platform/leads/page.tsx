import { getTranslations } from "next-intl/server";
import { Calculator, Compass, Download, Inbox, Users } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { platformAdminPage, platformDb } from "@/server/platform/admin";
import { listLeads, type TasterPayload } from "@/server/marketing/leads";
import { areaName } from "@/server/marketing/taster";
import type { OfferInputs } from "@/lib/roi";

export async function generateMetadata() {
  const t = await getTranslations("growth.platform");
  return { title: t("leadsTitle") };
}

type Filter = "all" | "TASTER" | "OFFER";

export default async function PlatformLeadsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const ctx = await platformAdminPage();
  const t = await getTranslations("growth.platform");
  const tp = await getTranslations("growth.pricing");
  const { locale } = ctx;
  const sp = await searchParams;
  const filter: Filter = sp.type === "TASTER" || sp.type === "OFFER" ? sp.type : "all";
  const db = platformDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [leads, counts, recent] = await Promise.all([
    listLeads(db, { type: filter === "all" ? null : filter, take: 300 }),
    db.marketingLead.groupBy({ by: ["type"], _count: { _all: true } }),
    db.marketingLead.count({ where: { createdAt: { gte: since } } }),
  ]);
  const count = (type: "TASTER" | "OFFER") => counts.find((c) => c.type === type)?._count._all ?? 0;
  const total = count("TASTER") + count("OFFER");
  const n = (v: number) => fmtNumber({ locale }, v);

  const summary = (l: (typeof leads)[number]) => {
    if (l.type === "TASTER") return ((l.payload as TasterPayload).top ?? []).map((a) => `${areaName(a.key, locale)} ${a.matchScore}%`).join(" · ");
    const p = l.payload as OfferInputs;
    return [t("offerStudents", { n: p.students, campuses: p.campuses }), (p.modules ?? []).map((m) => tp(`module.${m}`)).join(", "), tp(`planName.${p.plan}`)].join(" · ");
  };

  return (
    <PageBody>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("leadsTitle")}
        description={t("leadsBody")}
        actions={
          <Button asChild variant="outline">
            <a href={`/api/platform/leads/export${filter === "all" ? "" : `?type=${filter}`}`} data-testid="leads-export">
              <Download className="size-4" />
              {t("export")}
            </a>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statTotal")} value={n(total)} icon={<Users className="size-5" />} />
        <StatCard label={t("statTaster")} value={n(count("TASTER"))} icon={<Compass className="size-5" />} tone="info" />
        <StatCard label={t("statOffer")} value={n(count("OFFER"))} icon={<Calculator className="size-5" />} tone="gold" />
        <StatCard label={t("statRecent")} value={n(recent)} icon={<Inbox className="size-5" />} tone="success" />
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {(["all", "TASTER", "OFFER"] as const).map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/platform/leads" : `/platform/leads?type=${f}`}
            role="tab"
            aria-selected={filter === f}
            className={cn("rounded-full border px-3 py-1 text-sm", filter === f ? "border-brand bg-brand-soft font-medium text-brand" : "text-muted-foreground hover:text-foreground")}
          >
            {t(`filter.${f}`)}
          </Link>
        ))}
      </div>
      {leads.length === 0 ? (
        <EmptyState icon={<Inbox className="size-5" />} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <Panel padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm" data-testid="leads-table">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.created")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.type")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.contact")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.role")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.school")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.summary")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.consent")}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t("col.email")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDateTime({ locale }, l.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Pill tone={l.type === "TASTER" ? "info" : "gold"}>{t(`type.${l.type}`)}</Pill>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {l.email}
                      </p>
                    </td>
                    <td className="px-4 py-3">{t(`role.${l.role}`)}</td>
                    <td className="min-w-32 px-4 py-3">{l.schoolName ?? <span className="text-muted-foreground">-</span>}</td>
                    <td className="min-w-56 max-w-xs px-4 py-3 text-xs text-muted-foreground">{summary(l)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {fmtDateTime({ locale }, l.consentAt)}
                      <span className="block">{t("consentVersion", { v: l.consentVersion, lang: l.locale === "ar" ? t("langAr") : t("langEn") })}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={l.emailStatus === "SENT" ? "success" : l.emailStatus === "FAILED" ? "danger" : "neutral"}>{t(`emailStatus.${l.emailStatus}`)}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <p className="text-xs text-muted-foreground">{t("leadsFootnote")}</p>
    </PageBody>
  );
}
