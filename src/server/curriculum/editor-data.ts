import "server-only";
import type { Ctx } from "@/server/context";
import { getTranslations } from "next-intl/server";
import { pick } from "@/lib/i18n-data";
import type { EditorOptions } from "@/components/curriculum/plan-editor";
import { currentTerms } from "./access";

/** Everything the plan editor needs: subject and grade choices, classes, terms and standards with coverage counts. */
export async function editorOptions(ctx: Ctx): Promise<EditorOptions> {
  const { db, locale } = ctx;
  const [frameworks, subjects, classes, terms] = await Promise.all([
    db.curriculumFramework.findMany({ where: { subjectId: { not: null }, gradeLevel: { not: null } }, include: { standards: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }], include: { _count: { select: { lessons: true } } } } } }),
    db.subject.findMany({ orderBy: { nameEn: "asc" } }),
    db.schoolClass.findMany({ where: { isHomeroom: false, subjectId: { not: null }, academicYear: { isCurrent: true } }, orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }] }),
    currentTerms(ctx),
  ]);
  const t = await getTranslations("curriculum");
  const gradeLabel = (g: number) => t("gradeN", { grade: g });
  const combos = new Map<string, { subjectId: string; grade: number; label: string; mine: boolean }>();
  const add = (subjectId: string, grade: number, mine: boolean) => {
    const s = subjects.find((x) => x.id === subjectId);
    if (!s) return;
    const key = `${subjectId}:${grade}`;
    const cur = combos.get(key);
    if (cur) cur.mine ||= mine;
    else combos.set(key, { subjectId, grade, label: `${pick(locale, s.nameEn, s.nameAr)} · ${gradeLabel(grade)}`, mine });
  };
  for (const f of frameworks) add(f.subjectId!, f.gradeLevel!, false);
  for (const c of classes) if (c.teacherMembershipId === ctx.membershipId) add(c.subjectId!, c.gradeLevel, true);
  const sorted = [...combos.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || a.grade - b.grade || a.label.localeCompare(b.label));
  return {
    combos: sorted.map(({ subjectId, grade, label }) => ({ subjectId, grade, label })),
    classes: classes.filter((c) => combos.has(`${c.subjectId}:${c.gradeLevel}`)).map((c) => ({ id: c.id, subjectId: c.subjectId!, grade: c.gradeLevel, label: pick(locale, c.nameEn, c.nameAr) })),
    terms: terms.map((t) => ({ id: t.id, label: pick(locale, t.nameEn, t.nameAr) })),
    standards: frameworks.flatMap((f) =>
      f.standards.map((s) => ({ id: s.id, subjectId: f.subjectId!, grade: f.gradeLevel!, framework: pick(locale, f.nameEn, f.nameAr), code: s.code, strand: pick(locale, s.strandEn, s.strandAr), text: pick(locale, s.descEn, s.descAr), count: s._count.lessons })),
    ),
  };
}
