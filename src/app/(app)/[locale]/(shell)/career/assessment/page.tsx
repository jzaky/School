import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { AssessmentClient } from "@/components/career/assessment-client";

export async function generateMetadata() {
  const t = await getTranslations("career");
  return { title: t("assessmentTitle") };
}

export default async function AssessmentPage() {
  const ctx = await getCtx();
  if (!ctx.isStudent || !ctx.membership.student) notFound();
  const t = await getTranslations("career");
  const [questions, open] = await Promise.all([
    ctx.db.aptitudeQuestion.findMany({ where: { orgId: ctx.orgId }, orderBy: { order: "asc" } }),
    ctx.db.aptitudeAssessment.findFirst({ where: { studentId: ctx.membership.student.id, completedAt: null } }),
  ]);
  return (
    <PageBody className="max-w-3xl">
      <PageHeader title={t("assessmentTitle")} description={t("assessmentIntro")} />
      <AssessmentClient questions={questions.map((q) => ({ id: q.id, text: pick(ctx.locale, q.textEn, q.textAr), dimension: q.dimension }))} initial={(open?.answers as Record<string, number>) ?? {}} />
    </PageBody>
  );
}
