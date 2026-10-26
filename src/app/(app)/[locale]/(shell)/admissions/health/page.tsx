import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HeartPulse } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { canSeeHealth } from "@/server/admissions/access";
import { HealthPanel } from "@/components/admissions/detail-panels";
import { Pager } from "@/components/admissions/filters";

const PER_PAGE = 30;

export async function generateMetadata() {
  const t = await getTranslations("admissions.health");
  return { title: t("title") };
}

/**
 * Health and learning support on open applications, for the school nurse and staff with sensitive-document access.
 * Shows only what they need (child, grade, reference) and opens details one application at a time, each view audited.
 */
export default async function AdmissionsHealthPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canSeeHealth(ctx)) notFound();
  const t = await getTranslations("admissions.health");
  const tg = await getTranslations("gradeLevel");
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { orgId: ctx.orgId, stage: { notIn: ["DRAFT", "DECLINED", "WITHDRAWN"] }, OR: [{ hasMedical: true }, { hasSupport: true }] };
  const [total, rows] = await Promise.all([
    ctx.db.admissionApplication.count({ where }),
    ctx.db.admissionApplication.findMany({ where, orderBy: [{ gradeLevel: "asc" }, { submittedAt: "asc" }], skip: (page - 1) * PER_PAGE, take: PER_PAGE, select: { id: true, number: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, hasMedical: true, hasSupport: true } }),
  ]);
  return (
    <PageBody className="max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {rows.length === 0 ? (
        <EmptyState icon={<HeartPulse className="size-5" />} title={t("empty")} />
      ) : (
        <ul className="space-y-3" data-testid="health-list">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{pick(ctx.locale, `${r.firstNameEn} ${r.lastNameEn}`, r.firstNameAr ? `${r.firstNameAr} ${r.lastNameAr ?? ""}` : null)}</span>
                <span className="text-xs text-muted-foreground">
                  {tg("label", gradeLevelValues(r.gradeLevel))} · <span dir="ltr">{r.number}</span>
                </span>
              </div>
              <HealthPanel applicationId={r.id} canSee hasMedical={r.hasMedical} hasSupport={r.hasSupport} />
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={total} perPage={PER_PAGE} />
    </PageBody>
  );
}
