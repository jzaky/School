// Programme comparison: lines up the requirement lines of 2 to 4 programmes so the same requirement sits
// on the same row. Subject lines align by canonical subject (a line naming several subjects aligns with
// lines naming exactly the same set), language lines form one row, tests align by accepted tests,
// overall figures by kind and application steps by kind. Pure.
import type { EvalResult, LineResult } from "@/server/pathway-engine/types";

export type CompareSection = "overall" | "subject" | "language" | "test" | "additional";
export const SECTION_ORDER: CompareSection[] = ["overall", "subject", "language", "test", "additional"];
const OVERALL_ORDER = ["stream", "gpa", "percent", "points", "gradeProfile"];

export type CompareRow = {
  key: string;
  section: CompareSection;
  /** Canonical subject keys for subject rows (for the row label). */
  keys: string[];
  /** One entry per programme, in the order given; null when that programme does not list it. */
  cells: Array<LineResult | null>;
  /** True when every programme that lists the line treats it as advice only. */
  advisory: boolean;
};

export function sectionOf(l: LineResult): CompareSection {
  if (l.kind === "subject") return "subject";
  if (l.kind === "language") return "language";
  if (l.kind === "test") return "test";
  if (l.kind === "additional") return "additional";
  return "overall";
}

/** The key two lines must share to sit on the same row. */
export function alignmentKey(l: LineResult): string {
  switch (sectionOf(l)) {
    case "subject":
      return `subject:${[...new Set([...(l.keys ?? []), ...(l.alternatives ?? [])])].sort().join("+")}`;
    case "language":
      return "language";
    case "test":
      return `test:${[...new Set((l.alternatives?.length ? l.alternatives : l.keys) ?? [])].sort().join("+")}`;
    case "additional":
      return `additional:${l.type}`;
    default:
      return `overall:${l.kind}`;
  }
}

/** Rows for the comparison table, grouped by section in a fixed order. */
export function alignRequirements(results: Array<Pick<EvalResult, "lines"> | null>): CompareRow[] {
  const rows = new Map<string, CompareRow>();
  const order: string[] = [];
  results.forEach((r, col) => {
    if (!r) return;
    const seen = new Map<string, number>();
    for (const l of r.lines) {
      const base = alignmentKey(l);
      // A programme listing the same thing twice (rare) gets a second row rather than hiding a line.
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const key = n === 1 ? base : `${base}#${n}`;
      let row = rows.get(key);
      if (!row) {
        row = { key, section: sectionOf(l), keys: l.kind === "subject" ? [...new Set([...(l.keys ?? []), ...(l.alternatives ?? [])])] : [], cells: results.map(() => null), advisory: true };
        rows.set(key, row);
        order.push(key);
      }
      row.cells[col] = l;
      if (!l.advisory) row.advisory = false;
    }
  });
  const listed = (r: CompareRow) => r.cells.filter(Boolean).length;
  const within = (a: CompareRow, b: CompareRow) => {
    if (a.section === "overall") return OVERALL_ORDER.indexOf(a.key.slice(8).split("#")[0]) - OVERALL_ORDER.indexOf(b.key.slice(8).split("#")[0]);
    // Binding lines first, then lines most programmes share, then first seen.
    return Number(a.advisory) - Number(b.advisory) || listed(b) - listed(a) || order.indexOf(a.key) - order.indexOf(b.key);
  };
  return [...rows.values()].sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || within(a, b));
}

/** Per row, whether the programmes disagree (different requirement or a different outcome for the student). */
export function rowDiffers(row: CompareRow): boolean {
  const sig = row.cells.map((c) => (c ? `${c.type}|${c.minimumLevel ?? ""}|${c.required ?? ""}|${c.status}` : "-"));
  return new Set(sig).size > 1;
}
