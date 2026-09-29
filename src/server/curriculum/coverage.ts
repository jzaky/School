// Curriculum coverage and gap detection. Pure and deterministic, so it is unit tested directly.

export type CoverageStandard = { id: string; code: string; strandEn: string; strandAr: string; sortOrder?: number };
export type CoveragePlan = {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED";
  termId: string | null;
  plannedFor: Date | null;
  standardIds: string[];
};
export type CoverageTerm = { id: string; startsOn: Date; endsOn: Date };

export type StandardStatus = "missing" | "once" | "covered";

export type StandardCoverage = {
  standardId: string;
  count: number;
  approvedCount: number;
  status: StandardStatus;
  /** True when at least one covering lesson is approved. */
  approved: boolean;
  planIds: string[];
  termIds: string[];
};

export type StrandRow = {
  strandEn: string;
  strandAr: string;
  total: number;
  covered: number;
  /** termId -> number of this strand's standards taught in that term. */
  byTerm: Record<string, number>;
};

export type CoverageReport = {
  standards: StandardCoverage[];
  byId: Map<string, StandardCoverage>;
  strands: StrandRow[];
  summary: { total: number; missing: number; once: number; covered: number; approved: number; percent: number };
  missing: string[];
  once: string[];
};

/** The term a plan belongs to: its own termId, otherwise the term containing its date. */
export function termOf(plan: Pick<CoveragePlan, "termId" | "plannedFor">, terms: CoverageTerm[]): string | null {
  if (plan.termId && terms.some((t) => t.id === plan.termId)) return plan.termId;
  if (!plan.plannedFor) return plan.termId ?? null;
  const d = plan.plannedFor.getTime();
  return terms.find((t) => d >= t.startsOn.getTime() && d <= t.endsOn.getTime() + 86_399_999)?.id ?? null;
}

/**
 * For each standard, count the lesson plans that cover it. Missing means no plan at all, once means exactly
 * one plan, covered means two or more (taught and revisited). Every plan status counts as planned; approved
 * coverage is reported separately.
 */
export function computeCoverage(standards: CoverageStandard[], plans: CoveragePlan[], terms: CoverageTerm[] = []): CoverageReport {
  const ids = new Set(standards.map((s) => s.id));
  const acc = new Map<string, { plans: Set<string>; approved: Set<string>; terms: Set<string> }>();
  for (const s of standards) acc.set(s.id, { plans: new Set(), approved: new Set(), terms: new Set() });
  for (const p of plans) {
    const term = termOf(p, terms);
    for (const sid of new Set(p.standardIds)) {
      if (!ids.has(sid)) continue;
      const a = acc.get(sid)!;
      a.plans.add(p.id);
      if (p.status === "APPROVED") a.approved.add(p.id);
      if (term) a.terms.add(term);
    }
  }
  const ordered = [...standards].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code, "en", { numeric: true }));
  const rows: StandardCoverage[] = ordered.map((s) => {
    const a = acc.get(s.id)!;
    const count = a.plans.size;
    return {
      standardId: s.id,
      count,
      approvedCount: a.approved.size,
      status: count === 0 ? "missing" : count === 1 ? "once" : "covered",
      approved: a.approved.size > 0,
      planIds: [...a.plans],
      termIds: [...a.terms],
    };
  });
  const byId = new Map(rows.map((r) => [r.standardId, r]));

  const strandMap = new Map<string, StrandRow>();
  for (const s of ordered) {
    let row = strandMap.get(s.strandEn);
    if (!row) {
      row = { strandEn: s.strandEn, strandAr: s.strandAr, total: 0, covered: 0, byTerm: Object.fromEntries(terms.map((t) => [t.id, 0])) };
      strandMap.set(s.strandEn, row);
    }
    const c = byId.get(s.id)!;
    row.total++;
    if (c.count > 0) row.covered++;
    for (const t of c.termIds) row.byTerm[t] = (row.byTerm[t] ?? 0) + 1;
  }

  const missing = rows.filter((r) => r.status === "missing").map((r) => r.standardId);
  const once = rows.filter((r) => r.status === "once").map((r) => r.standardId);
  const covered = rows.filter((r) => r.status === "covered").length;
  const total = rows.length;
  return {
    standards: rows,
    byId,
    strands: [...strandMap.values()],
    summary: {
      total,
      missing: missing.length,
      once: once.length,
      covered,
      approved: rows.filter((r) => r.approved).length,
      percent: total ? Math.round(((total - missing.length) / total) * 100) : 0,
    },
    missing,
    once,
  };
}

/** Heatmap intensity 0..4 for a cell: share of a strand's standards taught in a term. */
export function heatLevel(count: number, total: number): 0 | 1 | 2 | 3 | 4 {
  if (!total || count <= 0) return 0;
  const r = count / total;
  if (r >= 0.75) return 4;
  if (r >= 0.5) return 3;
  if (r >= 0.25) return 2;
  return 1;
}
