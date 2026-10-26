import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { Download, FileSpreadsheet, Landmark, Printer } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Button } from "@/components/ui/button";
import { canEnroll, canViewAdmissions } from "@/server/admissions/access";
import { asTx, loadSettings } from "@/server/admissions/settings";
import { authorityNames } from "@/server/admissions/page-data";
import { REG_STATUSES } from "@/server/admissions/registration";
import { Pager } from "@/components/admissions/filters";
import { RegistrationBadge, RegistrationUpdate } from "@/components/admissions/registration";

const PER_PAGE = 50;

export async function generateMetadata() {
  const t = await getTranslations("admissions.registration");
  return { title: t("title") };
}

export default async function RegistrationPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.registration");
  const tg = await getTranslations("gradeLevel");
  const settings = await loadSettings(asTx(ctx.db), ctx.orgId);
  const authority = await authorityNames(ctx, settings);
  const kind = sp.kind === "WITHDRAWAL" ? "WITHDRAWAL" : "ENROLLMENT";
  const status = (REG_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "OPEN";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.GovRegistrationWhereInput = { orgId: ctx.orgId, kind, ...(status === "OPEN" ? { status: { not: "APPROVED" } } : { status }) };
  const [total, rows, counts] = await Promise.all([
    ctx.db.govRegistration.count({ where }),
    ctx.db.govRegistration.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "asc" }], skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    ctx.db.govRegistration.groupBy({ by: ["kind", "status"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
  ]);
  const students = await ctx.db.student.findMany({ where: { orgId: ctx.orgId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true, status: true, enrolledOn: true } });
  const n = (k: string, s?: string) => counts.filter((c) => c.kind === k && (s ? c.status === s : c.status !== "APPROVED")).reduce((a, c) => a + c._count._all, 0);
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat(ctx.locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(d) : "");
  const editable = canEnroll(ctx);
  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle", { authority: authority.full })}
        actions={
          editable && n(kind, "NOT_SUBMITTED") > 0 ? (
            <>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/admissions/export?kind=registration&regKind=${kind}&format=csv`} data-testid="reg-export">
                  <Download className="size-4" />
                  {t("exportCsv")}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/admissions/export?kind=registration&regKind=${kind}&format=xlsx`}>
                  <FileSpreadsheet className="size-4" />
                  {t("exportXlsx")}
                </a>
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="rounded-xl border bg-info-soft/40 px-4 py-3 text-sm text-muted-foreground">{t(`explain.${authority.key}`, { authority: authority.full })}</div>
      <FilterBar
        tabParam="kind"
        tabs={[
          { value: "ENROLLMENT", label: t("kindEnrollment"), count: n("ENROLLMENT") },
          { value: "WITHDRAWAL", label: t("kindWithdrawal"), count: n("WITHDRAWAL") },
        ]}
        chipParam="status"
        chips={[{ value: "", label: t("open") }, ...REG_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Landmark className="size-5" />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <ul className="divide-y" data-testid="registration-list">
            {rows.map((r) => {
              const s = students.find((x) => x.id === r.studentId);
              const name = s ? pick(ctx.locale, `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`) : "";
              return (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid="registration-row">
                  <div className="min-w-0 flex-1">
                    <Link href={`/students/${r.studentId}`} className="block truncate text-sm font-medium hover:text-brand">
                      {name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {s ? `${tg("label", gradeLevelValues(s.gradeLevel))}${s.section ? ` ${s.section}` : ""} · ${s.studentNo}` : ""}
                      {r.reference ? ` · ${t("refShort", { ref: r.reference })}` : ""}
                      {r.submittedAt ? ` · ${t("submittedShort", { date: fmt(r.submittedAt) })}` : ""}
                      {r.decidedAt ? ` · ${t("decidedShort", { date: fmt(r.decidedAt) })}` : ""}
                    </div>
                    {r.note && r.status === "REJECTED" && <div className="text-xs text-danger">{r.note}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RegistrationBadge status={r.status} authority={authority.short} />
                    <Button asChild size="sm" variant="ghost" className="h-8">
                      <Link href={`/print/registration/${r.id}`} target="_blank" data-testid="reg-sheet">
                        <Printer className="size-4" />
                        {t("sheet")}
                      </Link>
                    </Button>
                    {editable && <RegistrationUpdate id={r.id} status={r.status} reference={r.reference} authority={authority.short} studentName={name} />}
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
