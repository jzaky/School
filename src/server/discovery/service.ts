import "server-only";
// Programme search and comparison for the University planning module. Reads the shared catalog through
// the tenant client (global rows plus the school's own), and uses the pathway engine for match status.
import type { Ctx } from "@/server/context";
import { personName } from "@/lib/i18n-data";
import { catalogScope } from "@/server/pathways/scope";
import { evaluate, homeCurriculumFor } from "@/server/pathway-engine/evaluate";
import type { EngineFocus } from "@/server/pathway-engine/page-data";
import { computeMatches, getCurrentPlan, loadProgramMeta, loadPrograms, loadRequirements, loadStudentProfile, type ProgramMeta } from "@/server/pathway-engine/service";
import type { Curriculum, EvalResult, RequirementRow, StudentProfile } from "@/server/pathway-engine/types";
import { primaryDeadline, resolveDeadlines, type ResolvedDeadline } from "@/server/applications/deadlines";
import { intakeYearFor, routeFor, type AppRoute } from "@/server/applications/types";
import { alignRequirements, type CompareRow } from "./compare";
import { buildProgramWhere, filterAndSort, paginate, PAGE_SIZE, type DiscoveryQuery, type MatchInfo } from "./search";

export type SearchResultItem = { meta: ProgramMeta; match: (MatchInfo & { cached: boolean }) | null };

/** Students advising staff can pick on the search and compare pages (Grade 9 and up). Empty for others. */
export async function staffStudentOptions(ctx: Ctx, focus: EngineFocus) {
  if (!ctx.isStaff || focus.actor.visibleStudentIds !== null || !ctx.can("people.view")) return [];
  const rows = await ctx.db.student.findMany({ where: { orgId: ctx.orgId, gradeLevel: { gte: 9 }, status: "ACTIVE" }, orderBy: [{ gradeLevel: "desc" }, { lastNameEn: "asc" }], take: 400, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true } });
  return rows.map((s) => ({ value: s.id, label: `${personName(s, ctx.locale)} (${s.gradeLevel}${s.section ?? ""})` }));
}

/** Match status and missing count for many programmes, evaluated in memory (used to filter and sort). */
async function statusesFor(focus: EngineFocus, studentId: string, planId: string | null, ids: string[]): Promise<Map<string, MatchInfo>> {
  const { actor } = focus;
  const [loaded, reqs, countries] = await Promise.all([
    loadStudentProfile(actor, studentId, { planId }),
    loadRequirements(actor.db, actor.orgId, ids),
    actor.db.universityProgram.findMany({ where: { id: { in: ids } }, select: { id: true, universityId: true } }),
  ]);
  const unis = await actor.db.university.findMany({ where: { id: { in: [...new Set(countries.map((p) => p.universityId))] } }, select: { id: true, countryCode: true } });
  const countryOf = new Map(unis.map((u) => [u.id, u.countryCode]));
  const home = new Map(countries.map((p) => [p.id, homeCurriculumFor(countryOf.get(p.universityId))]));
  const out = new Map<string, MatchInfo>();
  for (const id of ids) {
    const r = evaluate(loaded.profile, { id, requirements: reqs.get(id) ?? [], homeCurriculum: home.get(id) ?? null });
    out.set(id, { status: r.status, missing: r.counts.requiredMissing });
  }
  return out;
}

export async function searchCatalog(ctx: Ctx, focus: EngineFocus, query: DiscoveryQuery) {
  const { db, orgId } = ctx;
  const [intakeRows, curriculumRows] = await Promise.all([
    query.intake ? db.programIntake.findMany({ where: { ...catalogScope(orgId), intakeYear: query.intake, isCurrent: true }, select: { programId: true } }) : null,
    query.curriculum ? db.programRequirement.findMany({ where: { ...catalogScope(orgId), isCurrent: true, curriculum: query.curriculum }, select: { programId: true }, distinct: ["programId"] }) : null,
  ]);
  const where = buildProgramWhere(query, orgId, { intake: intakeRows?.map((r) => r.programId) ?? null, curriculum: curriculumRows?.map((r) => r.programId) ?? null });
  const [idRows, metas] = await Promise.all([db.universityProgram.findMany({ where, select: { id: true } }), loadProgramMeta(db, orgId)]);
  const found = new Set(idRows.map((r) => r.id));
  const candidates = metas.filter((m) => found.has(m.id));

  const student = focus.student;
  const plan = student ? await getCurrentPlan(focus.actor, student.id) : null;
  const planId = plan?.id ?? null;
  // Match status for every candidate only when it decides the order or the filter.
  const needAll = !!student && (query.sort === "match" || !!query.status);
  const statuses = needAll ? await statusesFor(focus, student!.id, planId, candidates.map((c) => c.id)) : null;
  const sorted = filterAndSort(candidates, query, statuses, ctx.locale);
  const page = paginate(sorted, query.page, PAGE_SIZE);

  // Chips on the visible page come from the engine's cached results (computed and stored when missing).
  let items: SearchResultItem[] = page.items.map((meta) => ({ meta, match: null }));
  if (student && page.items.length) {
    const { matches } = await computeMatches(focus.actor, student.id, { planId, programIds: page.items.map((m) => m.id) });
    const byId = new Map(matches.map((m) => [m.meta.id, m]));
    items = page.items.map((meta) => {
      const m = byId.get(meta.id);
      return { meta, match: m ? { status: m.result.status, missing: m.result.counts.requiredMissing, cached: m.cached } : null };
    });
  }
  const countries = [...new Set(metas.map((m) => m.university.countryCode))].sort();
  return { ...page, items, countries, catalogTotal: metas.length, planId };
}

/** Shortlist state for a page of programmes: an entry for the programme id, or the same university and name. */
export async function shortlistedIds(ctx: Ctx, studentId: string, metas: ProgramMeta[]): Promise<Set<string>> {
  if (!metas.length) return new Set();
  const entries = await ctx.db.shortlistEntry.findMany({ where: { orgId: ctx.orgId, studentId }, select: { programId: true, universityId: true, programEn: true } });
  const out = new Set<string>();
  for (const m of metas) if (entries.some((e) => e.programId === m.id || (e.universityId === m.university.id && e.programEn === m.nameEn))) out.add(m.id);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Compare

const OXBRIDGE = ["oxford", "cambridge"];
const emptyProfile = (curriculum: Curriculum): StudentProfile => ({ curriculum, gradeLevel: 12, courses: [], overall: {}, tests: [] });

export type CompareColumn = {
  meta: ProgramMeta;
  result: EvalResult;
  rows: RequirementRow[];
  intakes: number[];
  confidence: RequirementRow["confidence"];
  sourceUrl: string | null;
  checkedAt: string | null;
  route: AppRoute;
  deadlines: ResolvedDeadline[];
  primary: ResolvedDeadline | null;
};

export async function loadComparison(ctx: Ctx, focus: EngineFocus, ids: string[], curriculum: Curriculum, now = new Date()) {
  const { db, orgId } = ctx;
  const programs = await loadPrograms(db, orgId, ids);
  const byId = new Map(programs.map((p) => [p.meta.id, p]));
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const student = focus.student;
  let profile: StudentProfile = emptyProfile(curriculum);
  if (student) {
    const plan = await getCurrentPlan(focus.actor, student.id);
    profile = (await loadStudentProfile(focus.actor, student.id, { planId: plan?.id ?? null })).profile;
  }
  const intakeYear = intakeYearFor(student?.gradeLevel ?? 12, now);
  const programIds = ordered.map((p) => p.meta.id);
  const uniIds = [...new Set(ordered.map((p) => p.meta.university.id))];
  const [intakes, deadlineRows, unis, fields] = await Promise.all([
    programIds.length ? db.programIntake.findMany({ where: { programId: { in: programIds }, isCurrent: true, ...catalogScope(orgId) }, select: { programId: true, intakeYear: true }, orderBy: { intakeYear: "asc" } }) : [],
    programIds.length ? db.applicationDeadline.findMany({ where: { AND: [catalogScope(orgId), { OR: [{ programId: { in: programIds } }, { universityId: { in: uniIds }, programId: null }] }] } }) : [],
    uniIds.length ? db.university.findMany({ where: { id: { in: uniIds } }, select: { id: true, key: true, applyVia: true } }) : [],
    programIds.length ? db.universityProgram.findMany({ where: { id: { in: programIds } }, select: { id: true, field: true } }) : [],
  ]);
  const columns: CompareColumn[] = ordered.map(({ meta, program }) => {
    const result = evaluate(profile, program);
    const rows = result.rowIds.map((id) => program.requirements.find((r) => r.id === id)!).filter(Boolean);
    const uni = unis.find((u) => u.id === meta.university.id);
    const route = routeFor(uni?.applyVia, meta.university.countryCode);
    const medicine = fields.find((f) => f.id === meta.id)?.field === "medicine" || meta.fieldKeys.includes("medicine");
    const deadlines = resolveDeadlines({ programId: meta.id, universityId: meta.university.id, intakeYear, route, oxbridgeOrMedicine: OXBRIDGE.includes(uni?.key ?? "") || medicine, rows: deadlineRows });
    const own = rows.length ? rows : program.requirements;
    return {
      meta,
      result,
      rows,
      intakes: intakes.filter((i) => i.programId === meta.id).map((i) => i.intakeYear),
      confidence: own[0]?.confidence ?? "UNKNOWN",
      sourceUrl: own.map((r) => r.sourceUrl).find(Boolean) ?? meta.sourceUrl,
      checkedAt: own.map((r) => r.checkedAt).find(Boolean) ?? null,
      route,
      deadlines,
      primary: primaryDeadline(deadlines, null, now),
    };
  });
  const aligned: CompareRow[] = alignRequirements(columns.map((c) => c.result));
  return { columns, aligned, intakeYear, curriculum: profile.curriculum as Curriculum, missing: ids.filter((id) => !byId.has(id)) };
}

