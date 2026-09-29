// Automatic teacher assignment. Pure and deterministic: inputs in, assignments out.
// Every section without a teacher gets a qualified teacher (TeacherSubject for that subject and grade),
// balancing load against each teacher's maximum periods per week.

export type AssignSection = {
  id: string;
  subjectId: string | null;
  gradeLevel: number;
  teacherId: string | null;
  periods: number; // periods per week this section needs
  optionBlock?: string | null;
};

export type TeacherQualification = {
  teacherId: string;
  subjectId: string;
  gradeLevels: number[];
  maxPeriodsPerWeek: number;
};

export type UnassignedReason = "NO_SUBJECT" | "NO_QUALIFIED" | "AT_CAPACITY" | "BLOCK_CLASH";

export type AssignResult = {
  assignments: Array<{ sectionId: string; teacherId: string; previousTeacherId: string | null }>;
  unassigned: Array<{ sectionId: string; reason: UnassignedReason }>;
  load: Record<string, number>;
  capacity: Record<string, number>;
};

/**
 * Assign teachers to sections that have none. With overwrite, every section is (re)assigned.
 * Most constrained sections go first (fewest qualified teachers, then most periods), and each goes to the
 * qualified teacher with the lowest load relative to their maximum. Sections that run in parallel
 * (same grade and option block) never share a teacher.
 */
export function assignTeachers(input: { sections: AssignSection[]; qualifications: TeacherQualification[]; overwrite?: boolean }): AssignResult {
  const { sections, qualifications, overwrite = false } = input;
  const capacity: Record<string, number> = {};
  for (const q of qualifications) capacity[q.teacherId] = Math.max(capacity[q.teacherId] ?? 0, q.maxPeriodsPerWeek);
  const load: Record<string, number> = {};
  for (const t of Object.keys(capacity)) load[t] = 0;

  const blockKey = (s: AssignSection) => (s.optionBlock ? `${s.gradeLevel}|${s.optionBlock}` : null);
  const blockTeachers = new Map<string, Set<string>>();
  const noteBlock = (s: AssignSection, teacherId: string) => {
    const k = blockKey(s);
    if (!k) return;
    if (!blockTeachers.has(k)) blockTeachers.set(k, new Set());
    blockTeachers.get(k)!.add(teacherId);
  };

  // Sections that keep their teacher count toward that teacher's load.
  const todo: AssignSection[] = [];
  for (const s of sections) {
    if (s.teacherId && !overwrite) {
      load[s.teacherId] = (load[s.teacherId] ?? 0) + s.periods;
      noteBlock(s, s.teacherId);
    } else todo.push(s);
  }

  const qualified = (s: AssignSection) =>
    s.subjectId ? qualifications.filter((q) => q.subjectId === s.subjectId && q.gradeLevels.includes(s.gradeLevel)).map((q) => q.teacherId) : [];
  const uniq = (xs: string[]) => [...new Set(xs)].sort();

  const ordered = [...todo].sort((a, b) => {
    const qa = uniq(qualified(a)).length;
    const qb = uniq(qualified(b)).length;
    if (qa !== qb) return qa - qb;
    if (a.periods !== b.periods) return b.periods - a.periods;
    if (a.gradeLevel !== b.gradeLevel) return a.gradeLevel - b.gradeLevel;
    return a.id.localeCompare(b.id);
  });

  const result: AssignResult = { assignments: [], unassigned: [], load, capacity };
  for (const s of ordered) {
    if (!s.subjectId) {
      result.unassigned.push({ sectionId: s.id, reason: "NO_SUBJECT" });
      continue;
    }
    const pool = uniq(qualified(s));
    if (pool.length === 0) {
      result.unassigned.push({ sectionId: s.id, reason: "NO_QUALIFIED" });
      continue;
    }
    const k = blockKey(s);
    const taken = k ? blockTeachers.get(k) : undefined;
    const notInBlock = pool.filter((t) => !taken?.has(t));
    if (notInBlock.length === 0) {
      result.unassigned.push({ sectionId: s.id, reason: "BLOCK_CLASH" });
      continue;
    }
    const fits = notInBlock.filter((t) => (load[t] ?? 0) + s.periods <= (capacity[t] ?? 0));
    if (fits.length === 0) {
      result.unassigned.push({ sectionId: s.id, reason: "AT_CAPACITY" });
      continue;
    }
    fits.sort((a, b) => {
      const ra = (load[a] ?? 0) / Math.max(1, capacity[a] ?? 1);
      const rb = (load[b] ?? 0) / Math.max(1, capacity[b] ?? 1);
      if (ra !== rb) return ra - rb;
      // The section's current teacher wins a tie, so re-running with overwrite changes as little as possible.
      if (a === s.teacherId) return -1;
      if (b === s.teacherId) return 1;
      return a.localeCompare(b);
    });
    const pickT = fits[0];
    load[pickT] = (load[pickT] ?? 0) + s.periods;
    noteBlock(s, pickT);
    result.assignments.push({ sectionId: s.id, teacherId: pickT, previousTeacherId: s.teacherId });
  }
  return result;
}
