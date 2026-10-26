import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, LogOut } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { canEnroll, canManageAdmissions, canViewAdmissions } from "@/server/admissions/access";
import { asTx, loadSettings } from "@/server/admissions/settings";
import { authorityNames } from "@/server/admissions/page-data";
import { Pager } from "@/components/admissions/filters";
import { PlanWithdrawal, WithdrawalActions } from "@/components/admissions/withdrawals";
import { RegistrationBadge } from "@/components/admissions/registration";

const PER_PAGE = 50;

export async function generateMetadata() {
  const t = await getTranslations("admissions.leavers");
  return { title: t("title") };
}

export default async function WithdrawalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.leavers");
  const tg = await getTranslations("gradeLevel");
  const tr = await getTranslations("admissions.leavingReason");
  const status = sp.tab === "COMPLETED" ? "COMPLETED" : sp.tab === "CANCELLED" ? "CANCELLED" : "PLANNED";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { orgId: ctx.orgId, status };
  const [total, rows, counts, settings] = await Promise.all([
    ctx.db.studentWithdrawal.count({ where }),
    ctx.db.studentWithdrawal.findMany({ where, orderBy: status === "PLANNED" ? { leavingDate: "asc" } : { completedAt: "desc" }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    ctx.db.studentWithdrawal.groupBy({ by: ["status"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
    loadSettings(asTx(ctx.db), ctx.orgId),
  ]);
  const authority = await authorityNames(ctx, settings);
  const [students, regs] = await Promise.all([
    ctx.db.student.findMany({ where: { orgId: ctx.orgId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true } }),
    ctx.db.govRegistration.findMany({ where: { orgId: ctx.orgId, kind: "WITHDRAWAL", withdrawalId: { in: rows.map((r) => r.id) } } }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat(ctx.locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(d) : "");
  const now = Date.now();
  return (
    <PageBody className="max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {canManageAdmissions(ctx) && <PlanWithdrawal />}
      <FilterBar
        tabs={[
          { value: "PLANNED", label: t("planned"), count: n("PLANNED") },
          { value: "COMPLETED", label: t("completed"), count: n("COMPLETED") },
          { value: "CANCELLED", label: t("cancelled"), count: n("CANCELLED") },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<LogOut className="size-5" />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <ul className="divide-y" data-testid="withdrawals">
            {rows.map((w) => {
              const s = students.find((x) => x.id === w.studentId);
              const reg = regs.find((r) => r.withdrawalId === w.id);
              const overdue = w.status === "PLANNED" && w.leavingDate.getTime() < now;
              return (
                <li key={w.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid="withdrawal-row">
                  <div className="min-w-0 flex-1">
                    <Link href={`/students/${w.studentId}`} className="block truncate text-sm font-medium hover:text-brand">
                      {s ? pick(ctx.locale, `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`) : ""}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {s ? `${tg("label", gradeLevelValues(s.gradeLevel))}${s.section ?? ""} · ${s.studentNo} · ` : ""}
                      {tr(w.reasonKey)}
                      {w.destination ? ` · ${w.destination}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={overdue ? "danger" : "neutral"}>{t("leavingOn", { date: fmt(w.leavingDate) })}</Pill>
                    {w.source === "REENROLLMENT" && <Pill tone="info">{t("fromReenrollment")}</Pill>}
                    {w.tcNumber && <Pill tone="success">{w.tcNumber}</Pill>}
                    {reg && <RegistrationBadge status={reg.status} authority={authority.short} />}
                    {w.tcDocumentId && (
                      <Button asChild size="sm" variant="ghost" className="h-8">
                        <a href={`/api/documents/${w.tcDocumentId}/download?inline=1`} target="_blank" rel="noopener" data-testid="tc-download">
                          <Download className="size-4" />
                          {t("tc")}
                        </a>
                      </Button>
                    )}
                    {w.status === "PLANNED" && <WithdrawalActions id={w.id} canComplete={canEnroll(ctx)} canCancel={canManageAdmissions(ctx)} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Pager page={page} total={total} perPage={PER_PAGE} />
    </PageBody>
  );
}
