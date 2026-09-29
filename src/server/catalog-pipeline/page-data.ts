import "server-only";
import { pick } from "@/lib/i18n-data";
import type { Ctx } from "@/server/context";
import type { SubjectNames } from "@/components/catalog/describe";
import { DEFAULT_VOCAB } from "./vocab";

/** Subject display names for the current locale (CanonicalSubject, falling back to the built-in vocabulary). */
export async function subjectNames(ctx: Ctx): Promise<SubjectNames> {
  const rows = await ctx.db.canonicalSubject.findMany({ select: { key: true, nameEn: true, nameAr: true } });
  const out: SubjectNames = Object.fromEntries(DEFAULT_VOCAB.map((v) => [v.key, v.nameEn]));
  for (const r of rows) out[r.key] = pick(ctx.locale, r.nameEn, r.nameAr);
  return out;
}

export type ProgramLabel = { program: string; university: string; countryCode: string };

/** Program and university names for a set of program ids (global rows and this school's rows are readable). */
export async function programLabels(ctx: Ctx, programIds: string[]): Promise<Map<string, ProgramLabel>> {
  const ids = [...new Set(programIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const programs = await ctx.db.universityProgram.findMany({ where: { id: { in: ids } }, select: { id: true, nameEn: true, nameAr: true, universityId: true } });
  const unis = await ctx.db.university.findMany({ where: { id: { in: [...new Set(programs.map((p) => p.universityId))] } }, select: { id: true, nameEn: true, nameAr: true, countryCode: true } });
  const uni = new Map(unis.map((u) => [u.id, u]));
  return new Map(
    programs.map((p) => {
      const u = uni.get(p.universityId);
      return [p.id, { program: pick(ctx.locale, p.nameEn, p.nameAr), university: u ? pick(ctx.locale, u.nameEn, u.nameAr) : "", countryCode: u?.countryCode ?? "" }];
    }),
  );
}

export const shortHash = (h: string | null | undefined) => (h ? h.slice(0, 12) : "");
