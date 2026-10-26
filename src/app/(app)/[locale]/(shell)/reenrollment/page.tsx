import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Repeat } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues, MAX_GRADE_LEVEL } from "@/lib/grade-levels";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ChildAnswer } from "@/components/admissions/reenrollment";

export async function generateMetadata() {
  const t = await getTranslations("admissions.family");
  return { title: t("title") };
}

/** Parents confirm, per child, whether they return next year while the school's re-enrollment window is open. */
export default async function FamilyReenrollmentPage() {
  const ctx = await getCtx();
  if (!ctx.isParent || !ctx.can("family.portal")) notFound();
  const t = await getTranslations("admissions.family");
  const tg = await getTranslations("gradeLevel");
  const now = new Date();
  const windows = await ctx.db.reenrollmentWindow.findMany({ where: { orgId: ctx.orgId, closedAt: null, opensAt: { lte: now }, closesAt: { gt: now } }, orderBy: { opensAt: "desc" }, take: 2 });
  const childIds = ctx.membership.guardian?.links.map((l) => l.studentId) ?? [];
  const children = childIds.length ? await ctx.db.student.findMany({ where: { orgId: ctx.orgId, id: { in: childIds }, status: "ACTIVE", gradeLevel: { lt: MAX_GRADE_LEVEL } }, orderBy: { gradeLevel: "desc" } }) : [];
  const fmt = (d: Date) => new Intl.DateTimeFormat(ctx.locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  if (!windows.length) {
    return (
      <PageBody className="max-w-3xl">
        <PageHeader title={t("title")} />
        <EmptyState icon={<Repeat className="size-5" />} title={t("closedTitle")} body={t("closedBody")} />
      </PageBody>
    );
  }
  const years = await ctx.db.academicYear.findMany({ where: { orgId: ctx.orgId, id: { in: windows.map((w) => w.academicYearId) } } });
  const responses = await ctx.db.reenrollmentResponse.findMany({ where: { orgId: ctx.orgId, windowId: { in: windows.map((w) => w.id) }, studentId: { in: children.map((c) => c.id) } } });
  return (
    <PageBody className="max-w-3xl">
      {windows.map((w) => {
        const y = years.find((x) => x.id === w.academicYearId);
        const msg = pick(ctx.locale, w.messageEn, w.messageAr);
        return (
          <div key={w.id} className="space-y-4">
            <PageHeader title={t("heading", { year: y ? pick(ctx.locale, y.nameEn, y.nameAr) : "" })} description={t("deadline", { date: fmt(w.closesAt) })} />
            {msg && <p className="rounded-xl border bg-card p-4 text-sm shadow-xs">{msg}</p>}
            {children.length === 0 ? (
              <EmptyState icon={<Repeat className="size-5" />} title={t("noChildren")} />
            ) : (
              <div className="space-y-3">
                {children.map((c) => {
                  const r = responses.find((x) => x.windowId === w.id && x.studentId === c.id);
                  return <ChildAnswer key={c.id} windowId={w.id} studentId={c.id} name={pick(ctx.locale, `${c.firstNameEn} ${c.lastNameEn}`, `${c.firstNameAr} ${c.lastNameAr}`)} grade={t("goingInto", { now: tg("label", gradeLevelValues(c.gradeLevel)), next: tg("label", gradeLevelValues(c.gradeLevel + 1)) })} current={r?.intent ?? null} reason={r?.reasonKey ?? null} />;
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("privacy")}</p>
          </div>
        );
      })}
    </PageBody>
  );
}
