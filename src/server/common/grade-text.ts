// Grade names in English and Arabic for things made outside a page request: PDFs, letters, exports, emails.
// Read from the same "gradeLevel" messages as the pages. No "server-only": the worker renders letters with it.
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";
import { gradeLabel, type GradeTranslator } from "@/lib/grade-levels";

type Loc = "en" | "ar";

const tg: Record<Loc, GradeTranslator> = {
  en: createTranslator({ locale: "en", messages: en, namespace: "gradeLevel" }) as unknown as GradeTranslator,
  ar: createTranslator({ locale: "ar", messages: ar, namespace: "gradeLevel" }) as unknown as GradeTranslator,
};

/** "Grade 9A" / "KG1 A" / "الصف 9A" / "الروضة الأولى A". */
export const gradeTextIn = (loc: Loc, level: number, section?: string | null, opts: { short?: boolean } = {}) => gradeLabel(tg[loc], level, section, opts);

export const gradeBiText = (level: number, section?: string | null, opts: { short?: boolean } = {}) => ({ en: gradeTextIn("en", level, section, opts), ar: gradeTextIn("ar", level, section, opts) });

/**
 * Letter templates written before kindergarten support say "Grade {{student.grade}}" (or "الصف {{student.grade}}").
 * Read that phrase as the full grade name, so a KG1 child's letter says "KG1" and never "Grade -1" or "Grade KG1".
 */
export function upgradeGradeMergeFields(body: string): string {
  return body.replace(/\bGrade \{\{student\.grade\}\}/g, "{{student.gradeName}}").replace(/الصف \{\{student\.grade\}\}/g, "{{student.gradeName}}");
}
