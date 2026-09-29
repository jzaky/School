// Page bodies shared by the static (/career/pathways, for students and parents) and the per-student
// (/career/pathways/[studentId], for staff) routes.
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { engineFocus } from "@/server/pathway-engine/page-data";
import { EngineHeader, HubView, PlanPageView, WhatIfView } from "./views";
import { StaffStudentList } from "./staff-list";

type Tab = "overview" | "plan" | "whatIf";

export async function engineMetadata() {
  const t = await getTranslations("engine");
  return { title: t("title") };
}

/** Static routes: students see themselves, parents their child (?student=), staff get the student list. */
export async function StaticPathwayPage({ tab, sp }: { tab: Tab; sp: { student?: string; q?: string; tab?: string } }) {
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  if (ctx.isStaff) {
    if (sp.student) return <StudentPathwayPage tab={tab} studentId={sp.student} />;
    return <StaffStudentList ctx={ctx} q={sp.q ?? ""} tab={sp.tab ?? "all"} />;
  }
  const focus = await engineFocus(ctx, sp.student);
  if (!focus.student) {
    const t = await getTranslations("engine");
    return (
      <PageBody>
        <EmptyState icon={<Users className="size-5" />} title={t("noStudent")} />
      </PageBody>
    );
  }
  return <Body tab={tab} />;

  async function Body({ tab: which }: { tab: Tab }) {
    return (
      <PageBody>
        <EngineHeader ctx={ctx} focus={focus} tab={which} />
        {which === "overview" ? <HubView ctx={ctx} focus={focus} /> : which === "plan" ? <PlanPageView ctx={ctx} focus={focus} /> : <WhatIfView ctx={ctx} focus={focus} />}
      </PageBody>
    );
  }
}

/** Per-student routes for staff. Students and parents may only open their own or their child's. */
export async function StudentPathwayPage({ tab, studentId }: { tab: Tab; studentId: string }) {
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const focus = await engineFocus(ctx, studentId);
  if (!focus.student || focus.student.id !== studentId) notFound();
  return (
    <PageBody>
      <EngineHeader ctx={ctx} focus={focus} tab={tab} />
      {tab === "overview" ? <HubView ctx={ctx} focus={focus} /> : tab === "plan" ? <PlanPageView ctx={ctx} focus={focus} /> : <WhatIfView ctx={ctx} focus={focus} />}
    </PageBody>
  );
}
