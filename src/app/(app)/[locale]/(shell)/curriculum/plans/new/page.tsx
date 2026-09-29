import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, NotebookPen } from "lucide-react";
import { getCtx } from "@/server/context";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { PlanEditor } from "@/components/curriculum/plan-editor";
import { editorOptions } from "@/server/curriculum/editor-data";
import type { PlanInput } from "@/server/curriculum/actions";

export async function generateMetadata() {
  const t = await getTranslations("curriculum");
  return { title: t("editor.newTitle") };
}

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ standard?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("curriculum");
  const Back = ctx.locale === "ar" ? ArrowRight : ArrowLeft;
  if (!ctx.isStaff || !ctx.can("curriculum.plan")) {
    return (
      <PageBody>
        <EmptyState icon={<NotebookPen className="size-5" />} title={t("noAccess")} body={t("noPlanBody")} />
      </PageBody>
    );
  }
  const options = await editorOptions(ctx);
  const pre = sp.standard ? options.standards.find((s) => s.id === sp.standard) : undefined;
  const combo = pre ? { subjectId: pre.subjectId, grade: pre.grade } : options.combos[0];
  const cls = combo ? options.classes.filter((c) => c.subjectId === combo.subjectId && c.grade === combo.grade) : [];
  const initial: PlanInput = {
    subjectId: combo?.subjectId ?? "",
    gradeLevel: combo?.grade ?? 0,
    classId: cls.length === 1 ? cls[0].id : null,
    termId: null,
    weekNo: null,
    plannedFor: null,
    titleEn: "",
    titleAr: "",
    objectivesEn: "",
    objectivesAr: "",
    activities: [
      { phase: "starter", minutes: 10, titleEn: "", titleAr: "", detailEn: "", detailAr: "" },
      { phase: "main", minutes: 30, titleEn: "", titleAr: "", detailEn: "", detailAr: "" },
      { phase: "plenary", minutes: 10, titleEn: "", titleAr: "", detailEn: "", detailAr: "" },
    ],
    materials: [],
    assessmentEn: "",
    assessmentAr: "",
    differentiation: { en: "", ar: "" },
    durationMin: 50,
    standardIds: pre ? [pre.id] : [],
  };
  return (
    <PageBody className="max-w-5xl">
      <Link href="/curriculum/plans" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Back className="size-4" />
        {t("plans.title")}
      </Link>
      <PageHeader title={t("editor.newTitle")} description={t("editor.newBody")} />
      {options.combos.length === 0 ? <EmptyState icon={<NotebookPen className="size-5" />} title={t("editor.noSubjects")} body={t("editor.noSubjectsBody")} /> : <PlanEditor initial={initial} options={options} />}
    </PageBody>
  );
}
