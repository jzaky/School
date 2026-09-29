import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { canSetup } from "@/server/onboarding/access";
import { SetupCard } from "@/components/onboarding/setup-card";
import { AdminHome, CareerAdvisorHome, CounselorHome, DslHome, ParentHome, StaffHome, StudentHome, TeacherHome } from "@/components/dashboard/homes";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("home") };
}

export default async function HomePage() {
  const ctx = await getCtx();
  const prefs = await formatPrefs(ctx);
  const r = ctx.roles;
  if (ctx.isStudent) return <StudentHome ctx={ctx} prefs={prefs} />;
  if (ctx.isParent) return <ParentHome ctx={ctx} prefs={prefs} />;
  if (r.includes("school_admin") || r.includes("principal")) {
    const setup = canSetup(ctx) && !ctx.org.onboardingCompletedAt && !ctx.org.isDemo;
    return (
      <>
        {setup && <SetupCard ctx={ctx} />}
        <AdminHome ctx={ctx} prefs={prefs} />
      </>
    );
  }
  if (r.includes("dsl")) return <DslHome ctx={ctx} prefs={prefs} />;
  if (r.includes("career_advisor")) return <CareerAdvisorHome ctx={ctx} prefs={prefs} />;
  if (r.includes("counselor") || r.includes("wellbeing_lead")) return <CounselorHome ctx={ctx} prefs={prefs} />;
  if (r.includes("teacher") && !r.includes("registrar")) return <TeacherHome ctx={ctx} prefs={prefs} />;
  return <StaffHome ctx={ctx} prefs={prefs} />;
}
