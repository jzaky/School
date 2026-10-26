// Stored bilingual text for course selection (the calendar deadline of a window), from the same message
// files as the UI so grade names read the same everywhere (KG1, KG2, Grade 1 to Grade 12).
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";
import { gradeLevelValues } from "@/lib/grade-levels";
import { gradeRuns } from "@/lib/selection-window";
import type { WindowLabels } from "./selection";
import { dateText } from "./selection";

type T = (k: string, v?: Record<string, string | number>) => string;
const translators = {
  en: createTranslator({ locale: "en", messages: en }) as unknown as T,
  ar: createTranslator({ locale: "ar", messages: ar }) as unknown as T,
};

/** Grade levels as text, for example "Grade 9 to Grade 11" or "KG1 to Grade 2, Grade 6". */
export function gradesText(levels: number[], locale: "en" | "ar"): string {
  const t = translators[locale];
  const label = (g: number) => t("gradeLevel.label", gradeLevelValues(g));
  return gradeRuns(levels)
    .map(([a, b]) => (a === b ? label(a) : t("selection.gradeSpan", { from: label(a), to: label(b) })))
    .join(locale === "ar" ? "، " : ", ");
}

export const windowLabels: WindowLabels = (w) => {
  const out = { titleEn: "", titleAr: "", descEn: "", descAr: "" };
  for (const locale of ["en", "ar"] as const) {
    const t = translators[locale];
    const grades = gradesText(w.gradeLevels, locale);
    const round = locale === "ar" ? w.roundAr : w.roundEn;
    const title = round ? t("selection.calendarTitleRound", { grades, round }) : t("selection.calendarTitle", { grades });
    const desc = t("selection.calendarDesc", { grades, year: locale === "ar" ? w.yearAr : w.yearEn, opens: dateText(w.opensAt)[locale] });
    if (locale === "en") Object.assign(out, { titleEn: title, descEn: desc });
    else Object.assign(out, { titleAr: title, descAr: desc });
  }
  return out;
};
