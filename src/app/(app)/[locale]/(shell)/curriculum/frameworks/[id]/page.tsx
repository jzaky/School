import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Layers } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { DeleteFrameworkButton, DeleteStandardButton, FrameworkDialog, ImportStandardsDialog, StandardDialog } from "@/components/curriculum/framework-forms";
import { codePrefix } from "@/server/curriculum/parse";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const fw = await ctx.db.curriculumFramework.findUnique({ where: { id } });
  const t = await getTranslations("curriculum");
  return { title: fw ? pick(ctx.locale, fw.nameEn, fw.nameAr) : t("frameworks.title") };
}

export default async function FrameworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("curriculum");
  if (!ctx.isStaff || !ctx.can("curriculum.manage")) {
    return (
      <PageBody>
        <EmptyState icon={<BookOpen className="size-5" />} title={t("noAccess")} body={t("frameworks.noAccessBody")} />
      </PageBody>
    );
  }
  const { db, locale } = ctx;
  const fw = await db.curriculumFramework.findUnique({ where: { id }, include: { standards: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }], include: { _count: { select: { lessons: true } } } } } });
  if (!fw) notFound();
  const subjects = await db.subject.findMany({ orderBy: { nameEn: "asc" } });
  const subject = subjects.find((s) => s.id === fw.subjectId);
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const prefix = codePrefix(subject?.code, fw.gradeLevel);
  const inUse = fw.standards.some((s) => s._count.lessons > 0);
  const strands = [...new Set(fw.standards.map((s) => s.strandEn))];

  return (
    <PageBody>
      <Link href="/curriculum/frameworks" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Back className="size-4" />
        {t("frameworks.title")}
      </Link>
      <PageHeader
        eyebrow={`${subject ? pick(locale, subject.nameEn, subject.nameAr) : t("frameworks.noSubject")} · ${t("gradeN", { grade: fw.gradeLevel ?? 0 })}`}
        title={pick(locale, fw.nameEn, fw.nameAr)}
        description={fw.sourceEn ?? t("frameworks.detailBody")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/curriculum?fw=${fw.id}`}>
                <BarChart3 className="size-4" />
                {t("frameworks.viewCoverage")}
              </Link>
            </Button>
            <DeleteFrameworkButton id={fw.id} inUse={inUse} />
            <FrameworkDialog framework={{ id: fw.id, nameEn: fw.nameEn, nameAr: fw.nameAr, subjectId: fw.subjectId ?? "", gradeLevel: fw.gradeLevel ?? 9, sourceEn: fw.sourceEn ?? "" }} subjects={subjects.map((s) => ({ id: s.id, label: pick(locale, s.nameEn, s.nameAr) }))} />
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("frameworks.summary", { count: fw.standards.length, strands: strands.length })}</p>
        <div className="flex flex-wrap gap-2">
          <StandardDialog frameworkId={fw.id} prefix={prefix} />
          <ImportStandardsDialog frameworkId={fw.id} existingCodes={fw.standards.map((s) => s.code)} />
        </div>
      </div>
      {fw.standards.length === 0 ? (
        <EmptyState icon={<Layers className="size-5" />} title={t("frameworks.noStandards")} body={t("frameworks.noStandardsBody")} />
      ) : (
        <div className="space-y-4" data-testid="standards-list">
          {strands.map((strand) => {
            const list = fw.standards.filter((s) => s.strandEn === strand);
            return (
              <section key={strand} className="overflow-hidden rounded-xl border bg-card shadow-xs">
                <div className="border-b bg-muted/30 px-5 py-2.5 text-sm font-semibold">{pick(locale, list[0].strandEn, list[0].strandAr)}</div>
                <ul className="divide-y">
                  {list.map((s) => (
                    <li key={s.id} className="flex items-start gap-3 px-4 py-3 sm:px-5" data-testid="standard-row">
                      <span className="mt-0.5 w-24 shrink-0 font-mono text-xs text-muted-foreground" dir="ltr">
                        {s.code}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">{pick(locale, s.descEn, s.descAr)}</div>
                        <div className="text-xs text-muted-foreground" dir={locale === "ar" ? "ltr" : "rtl"}>
                          {locale === "ar" ? s.descEn : s.descAr}
                        </div>
                      </div>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{t("frameworks.lessonsN", { count: s._count.lessons })}</span>
                      <div className="flex shrink-0 items-center">
                        <StandardDialog frameworkId={fw.id} prefix={prefix} standard={{ id: s.id, code: s.code, strandEn: s.strandEn, strandAr: s.strandAr, descEn: s.descEn, descAr: s.descAr }} />
                        {s._count.lessons === 0 && <DeleteStandardButton id={s.id} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
