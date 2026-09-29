import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getOptionalCtx } from "@/server/context";
import { canSeePlan } from "@/server/curriculum/access";
import { renderLessonPlanPdf } from "@/server/curriculum/pdf";
import { pickBi, readActivities, readBilingualText, readMaterials, sessionTimeline } from "@/server/curriculum/types";
import { userName } from "@/lib/i18n-data";

export const runtime = "nodejs";

/** Printable lesson plan in the viewer's language. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const plan = await ctx.db.lessonPlan.findUnique({ where: { id }, include: { standards: { include: { standard: true } } } });
  if (!plan || !canSeePlan(ctx, plan)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const q = new URL(req.url).searchParams.get("locale");
  const locale = q === "ar" || q === "en" ? q : ctx.locale;
  const t = await getTranslations({ locale, namespace: "curriculum" });
  const [subject, cls, term, author] = await Promise.all([
    ctx.db.subject.findUnique({ where: { id: plan.subjectId } }),
    plan.classId ? ctx.db.schoolClass.findUnique({ where: { id: plan.classId } }) : null,
    plan.termId ? ctx.db.term.findUnique({ where: { id: plan.termId } }) : null,
    ctx.db.membership.findUnique({ where: { id: plan.authorId }, include: { user: true } }),
  ]);
  const p = (en: string | null | undefined, ar: string | null | undefined) => pickBi(locale, en, ar);
  const date = plan.plannedFor ? new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(plan.plannedFor) : t("plan.notScheduled");
  const diff = readBilingualText(plan.differentiation);
  const pdf = await renderLessonPlanPdf({
    rtl: locale === "ar",
    school: p(ctx.org.nameEn, ctx.org.nameAr),
    title: p(plan.titleEn, plan.titleAr),
    subtitle: `${subject ? p(subject.nameEn, subject.nameAr) : ""} · ${t("gradeN", { grade: plan.gradeLevel })} · ${t(`status.${plan.status}`)}`,
    meta: [
      [t("plan.class"), cls ? p(cls.nameEn, cls.nameAr) : t("plan.noClass")],
      [t("plan.teacher"), userName(author?.user, locale)],
      [t("plan.when"), [term ? p(term.nameEn, term.nameAr) : null, plan.weekNo ? t("plan.weekN", { week: plan.weekNo }) : null].filter(Boolean).join(" · ") || t("plan.notScheduled")],
      [t("plan.date"), date],
      [t("plan.duration"), t("plan.minutesN", { count: plan.durationMin })],
      [t("plan.standards"), plan.standards.map((s) => s.standard.code).join(", ") || t("plan.none")],
    ],
    session: {
      heading: t("plan.session"),
      rows: sessionTimeline(readActivities(plan.activities)).map((r) => ({
        time: t("plan.range", { start: r.start, end: r.end }),
        phase: t(`phase.${r.phase}`),
        title: p(r.titleEn, r.titleAr) || t(`phase.${r.phase}`),
        detail: p(r.detailEn, r.detailAr),
      })),
    },
    sections: [
      { heading: t("plan.objectives"), lines: p(plan.objectivesEn, plan.objectivesAr).split("\n").filter((l) => l.trim()) },
      { heading: t("plan.standards"), lines: plan.standards.map((s) => `${s.standard.code}: ${p(s.standard.descEn, s.standard.descAr)}`) },
      { heading: t("plan.materials"), lines: readMaterials(plan.materials).map((m) => p(m.en, m.ar)) },
      { heading: t("plan.assessment"), lines: p(plan.assessmentEn, plan.assessmentAr).split("\n").filter((l) => l.trim()) },
      { heading: t("plan.differentiation"), lines: p(diff.en, diff.ar).split("\n").filter((l) => l.trim()) },
    ],
    footer: t("plan.pdfFooter"),
  });
  const name = `lesson-plan-${plan.id.slice(-6)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
