// Shared bits for the admissions pages: filters from the URL, year and grade options, and the authority's name.
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { pick } from "@/lib/i18n-data";
import type { BoardFilters } from "./queries";
import { FLAGS } from "./queries";
import { awaitingApproval, schoolAuthority } from "./registration";
import { admissionYears, asTx, loadSettings, type Settings, type YearOption } from "./settings";

export type SP = { year?: string; grade?: string; q?: string; flag?: string; stage?: string; page?: string };

/** The year shown by default: next year when the school has set it up (admissions season), otherwise this year. */
export function defaultYear(years: YearOption[]): YearOption | undefined {
  return years.find((y) => !y.isCurrent) ?? years[0];
}

export async function filtersFrom(ctx: Ctx, sp: SP): Promise<{ filters: BoardFilters; years: YearOption[]; page: number }> {
  const years = await admissionYears(asTx(ctx.db), ctx.orgId);
  const year = years.find((y) => y.id === sp.year) ?? defaultYear(years);
  const g = sp.grade !== undefined && sp.grade !== "" ? Number(sp.grade) : null;
  return {
    years,
    page: Math.max(1, Math.min(10_000, Number(sp.page) || 1)),
    filters: {
      yearId: year?.id ?? "",
      grade: g !== null && ALL_GRADE_LEVELS.includes(g) ? g : null,
      q: sp.q?.trim().slice(0, 80) || null,
      flag: (FLAGS as readonly string[]).includes(sp.flag ?? "") ? sp.flag! : null,
    },
  };
}

export async function filterOptions(ctx: Ctx, years: YearOption[]) {
  const tg = await getTranslations("gradeLevel");
  const t = await getTranslations("admissions.flags");
  return {
    years: years.map((y) => ({ value: y.id, label: pick(ctx.locale, y.nameEn, y.nameAr) })),
    grades: ALL_GRADE_LEVELS.map((g) => ({ value: String(g), label: tg("label", gradeLevelValues(g)) })),
    flags: FLAGS.map((f) => ({ value: f, label: t(f) })),
  };
}

/** The education authority's name for this school, full and short ("SPEA (DALEEL)" and "SPEA"). */
export async function authorityNames(ctx: Ctx, s: Settings) {
  const t = await getTranslations("admissions.authority");
  const a = schoolAuthority(s.row, ctx.org.regulator);
  const own = pick(ctx.locale, a.labelEn, a.labelAr);
  return { key: a.key, full: own || t(`full.${a.key}`), short: own || t(`short.${a.key}`) };
}

/**
 * For class lists and student pages: which of these students are still waiting for the education authority to
 * approve their registration (for example "Awaiting SPEA approval"), and the label to show.
 */
export async function awaitingAuthority(ctx: Ctx, studentIds: string[]): Promise<{ ids: Set<string>; label: string }> {
  const ids = await awaitingApproval(asTx(ctx.db), ctx.orgId, studentIds);
  if (!ids.size) return { ids, label: "" };
  const s = await loadSettings(asTx(ctx.db), ctx.orgId);
  const names = await authorityNames(ctx, s);
  const t = await getTranslations("admissions.registration");
  return { ids, label: t("badge.NOT_SUBMITTED", { authority: names.short }) };
}
