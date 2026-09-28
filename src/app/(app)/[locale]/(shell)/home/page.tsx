import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
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
  if (r.includes("school_admin") || r.includes("principal")) return <AdminHome ctx={ctx} prefs={prefs} />;
  if (r.includes("dsl")) return <DslHome ctx={ctx} prefs={prefs} />;
  if (r.includes("career_advisor")) return <CareerAdvisorHome ctx={ctx} prefs={prefs} />;
  if (r.includes("counselor") || r.includes("wellbeing_lead")) return <CounselorHome ctx={ctx} prefs={prefs} />;
  if (r.includes("teacher") && !r.includes("registrar")) return <TeacherHome ctx={ctx} prefs={prefs} />;
  return <StaffHome ctx={ctx} prefs={prefs} />;
}
