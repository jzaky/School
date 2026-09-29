import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { getCtx } from "@/server/context";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { PlanEditor } from "@/components/curriculum/plan-editor";
import { editorOptions } from "@/server/curriculum/editor-data";
import { canEditPlan, canSeePlan } from "@/server/curriculum/access";
import { readActivities, readBilingualText, readMaterials } from "@/server/curriculum/types";
import type { PlanInput } from "@/server/curriculum/actions";

export async function generateMetadata() {
  const t = await getTranslations("curriculum");
  return { title: t("editor.editTitle") };
}

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("curriculum");
  const plan = await ctx.db.lessonPlan.findUnique({ where: { id }, include: { standards: true } });
  if (!plan || !canSeePlan(ctx, plan)) notFound();
  const Back = ctx.locale === "ar" ? ArrowRight : ArrowLeft;
  const back = (
    <Link href={`/curriculum/plans/${plan.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <Back className="size-4" />
      {t("editor.backToPlan")}
    </Link>
  );
  if (!canEditPlan(ctx, plan)) {
    return (
      <PageBody>
        {back}
        <EmptyState icon={<Lock className="size-5" />} title={t("editor.locked")} body={t("editor.lockedBody")} />
      </PageBody>
    );
  }
  const options = await editorOptions(ctx);
  const initial: PlanInput = {
    id: plan.id,
    subjectId: plan.subjectId,
    gradeLevel: plan.gradeLevel,
    classId: plan.classId,
    termId: plan.termId,
    weekNo: plan.weekNo,
    plannedFor: plan.plannedFor ? plan.plannedFor.toISOString().slice(0, 10) : null,
    titleEn: plan.titleEn,
    titleAr: plan.titleAr,
    objectivesEn: plan.objectivesEn ?? "",
    objectivesAr: plan.objectivesAr ?? "",
    activities: readActivities(plan.activities),
    materials: readMaterials(plan.materials),
    assessmentEn: plan.assessmentEn ?? "",
    assessmentAr: plan.assessmentAr ?? "",
    differentiation: readBilingualText(plan.differentiation),
    durationMin: plan.durationMin,
    standardIds: plan.standards.map((s) => s.standardId),
  };
  return (
    <PageBody className="max-w-5xl">
      {back}
      <PageHeader title={t("editor.editTitle")} description={plan.status === "CHANGES_REQUESTED" && plan.reviewComment ? t("editor.changesAsked", { comment: plan.reviewComment }) : t("editor.editBody")} />
      <PlanEditor initial={initial} options={options} />
    </PageBody>
  );
}
