import { getTranslations } from "next-intl/server";
import { BookOpen, Layers } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { CurriculumNav } from "@/components/curriculum/curriculum-nav";
import { FrameworkDialog } from "@/components/curriculum/framework-forms";
import { curriculumShell } from "@/server/curriculum/shell";

export async function generateMetadata() {
  const t = await getTranslations("curriculum");
  return { title: t("frameworks.title") };
}

export default async function FrameworksPage() {
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
  const [shell, frameworks, subjects] = await Promise.all([
    curriculumShell(ctx),
    db.curriculumFramework.findMany({ orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }], include: { standards: { select: { strandEn: true, _count: { select: { lessons: true } } } } } }),
    db.subject.findMany({ orderBy: { nameEn: "asc" } }),
  ]);
  const subjectOptions = subjects.map((s) => ({ id: s.id, label: pick(locale, s.nameEn, s.nameAr) }));

  return (
    <PageBody>
      <PageHeader
        title={t("frameworks.title")}
        description={t("frameworks.subtitle")}
        actions={
          <>
            <CurriculumNav tabs={shell.tabs} reviewCount={shell.reviewCount} />
            <FrameworkDialog subjects={subjectOptions} />
          </>
        }
      />
      {frameworks.length === 0 ? (
        <EmptyState icon={<Layers className="size-5" />} title={t("frameworks.empty")} body={t("frameworks.emptyBody")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="framework-list">
          {frameworks.map((f) => {
            const subject = subjects.find((s) => s.id === f.subjectId);
            const strands = new Set(f.standards.map((s) => s.strandEn)).size;
            const covered = f.standards.filter((s) => s._count.lessons > 0).length;
            return (
              <Link key={f.id} href={`/curriculum/frameworks/${f.id}`} className="block rounded-xl border bg-card p-5 shadow-xs transition hover:border-brand/25 hover:shadow-sm">
                <div className="text-xs text-muted-foreground">
                  {subject ? pick(locale, subject.nameEn, subject.nameAr) : t("frameworks.noSubject")} · {t("gradeN", { grade: f.gradeLevel ?? 0 })}
                </div>
                <div className="mt-1 font-semibold">{pick(locale, f.nameEn, f.nameAr)}</div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{t("frameworks.standardsN", { count: f.standards.length })}</span>
                  <span>{t("frameworks.strandsN", { count: strands })}</span>
                  <span>{t("frameworks.coveredN", { covered, total: f.standards.length })}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
