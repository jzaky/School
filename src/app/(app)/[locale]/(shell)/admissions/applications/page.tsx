import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, Inbox } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { canManageAdmissions, canViewAdmissions } from "@/server/admissions/access";
import { LIST_PAGE, listApplications } from "@/server/admissions/queries";
import { filterOptions, filtersFrom, type SP } from "@/server/admissions/page-data";
import { AdmissionFilters, Pager } from "@/components/admissions/filters";
import { StagePill } from "@/components/admissions/ui";

export async function generateMetadata() {
  const t = await getTranslations("admissions.list");
  return { title: t("title") };
}

export default async function ApplicationsListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.list");
  const tf = await getTranslations("admissions.flags");
  const tg = await getTranslations("gradeLevel");
  const { filters, years, page } = await filtersFrom(ctx, sp);
  const opts = await filterOptions(ctx, years);
  const stage = sp.stage && /^[A-Z_]{2,40}$/.test(sp.stage) ? sp.stage : null;
  const data = filters.yearId ? await listApplications(ctx, { ...filters, stage }, page) : { total: 0, cards: [], settings: null };
  const stages = data.settings?.stages ?? [];
  const label = (k: string) => {
    const s = stages.find((x) => x.key === k);
    return s ? pick(ctx.locale, s.labelEn, s.labelAr) : null;
  };
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(ctx.locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "");
  const exportQs = new URLSearchParams({ kind: "applications", year: filters.yearId, ...(filters.grade !== null ? { grade: String(filters.grade) } : {}), ...(stage ? { stage } : {}) });
  const ts = await getTranslations("admissions.stage");
  return (
    <PageBody className="max-w-[1600px]">
      <PageHeader
        title={t("title")}
        description={t("subtitle", { n: data.total })}
        actions={
          canManageAdmissions(ctx) && data.total > 0 ? (
            <>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/admissions/export?${exportQs}&format=csv`} data-testid="export-csv">
                  <Download className="size-4" />
                  {t("exportCsv")}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/admissions/export?${exportQs}&format=xlsx`} data-testid="export-xlsx">
                  <Download className="size-4" />
                  {t("exportXlsx")}
                </a>
              </Button>
            </>
          ) : undefined
        }
      />
      <AdmissionFilters year={filters.yearId} years={opts.years} grades={opts.grades} flags={opts.flags} stages={stages.map((s) => ({ value: s.key, label: pick(ctx.locale, s.labelEn, s.labelAr) || (ts.has(s.key) ? ts(s.key) : s.key) }))} />
      {data.cards.length === 0 ? (
        <EmptyState icon={<Inbox className="size-5" />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="applications-table">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("colChild")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colGrade")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colStage")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colSubmitted")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colFlags")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.cards.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`/admissions/applications/${c.id}`} className="font-medium hover:text-brand">
                        {ctx.locale === "ar" ? c.nameAr : c.nameEn}
                      </Link>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {c.number}
                      </div>
                    </td>
                    <td className="px-3 py-2">{tg("label", gradeLevelValues(c.grade))}</td>
                    <td className="px-3 py-2">
                      <StagePill stage={c.stage} label={label(c.stage)} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmt(c.submittedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.ageFlag && <Pill tone="warning">{tf(c.ageFlag === "UNDER" ? "under" : "over")}</Pill>}
                        {c.duplicate && <Pill tone="danger">{tf("duplicate")}</Pill>}
                        {c.sibling && <Pill tone="info">{tf("sibling")}</Pill>}
                        {c.staffChild && <Pill tone="info">{tf("staffChild")}</Pill>}
                        {c.missing > 0 && c.stage !== "ENROLLED" && <Pill tone="warning">{tf("missing", { n: c.missing })}</Pill>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pager page={page} total={data.total} perPage={LIST_PAGE} />
    </PageBody>
  );
}
