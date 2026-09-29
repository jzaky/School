// Subject registration rules shared by the browser (live checks) and the server (final checks).
// Offerings for one grade: core subjects everyone takes, and option blocks where a student picks one.
// Prerequisites are subject codes. One is met when the student takes that subject in the same
// registration (core or another option) or took it in an earlier academic year.

export type OfferingLite = {
  subjectId: string;
  code: string;
  kind: "CORE" | "OPTION";
  optionBlock: string | null;
  prerequisites: string[];
};

export type ChoiceError =
  | { code: "missingBlock"; block: string }
  | { code: "sameBlock"; block: string }
  | { code: "notOffered"; subjectId: string }
  | { code: "prerequisite"; subjectId: string; missing: string[] };

/** Option blocks in order (A, B, C...) with the offerings in each. */
export function blocksOf<T extends OfferingLite>(offerings: T[]): Array<{ block: string; options: T[] }> {
  const map = new Map<string, T[]>();
  for (const o of offerings) {
    if (o.kind !== "OPTION") continue;
    const b = (o.optionBlock ?? "A").toUpperCase();
    map.set(b, [...(map.get(b) ?? []), o]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([block, options]) => ({ block, options }));
}

/** Prerequisite codes not met by this set of subjects. */
export function missingPrerequisites(offering: OfferingLite, takingCodes: Set<string>, priorCodes: Set<string> = new Set()): string[] {
  return offering.prerequisites.map((c) => c.toUpperCase()).filter((c) => !takingCodes.has(c) && !priorCodes.has(c));
}

/**
 * Check a student's option choices (subject ids) against the offerings for their grade.
 * Returns an empty list when the choices can be saved.
 */
export function checkChoices(offerings: OfferingLite[], chosenSubjectIds: string[], priorCodes: Set<string> = new Set(), opts: { requireAllBlocks?: boolean } = {}): ChoiceError[] {
  const errors: ChoiceError[] = [];
  const byId = new Map(offerings.map((o) => [o.subjectId, o]));
  const chosen: OfferingLite[] = [];
  for (const id of new Set(chosenSubjectIds)) {
    const o = byId.get(id);
    if (!o || o.kind !== "OPTION") errors.push({ code: "notOffered", subjectId: id });
    else chosen.push(o);
  }
  const blocks = blocksOf(offerings);
  for (const b of blocks) {
    const inBlock = chosen.filter((o) => (o.optionBlock ?? "A").toUpperCase() === b.block);
    if (inBlock.length > 1) errors.push({ code: "sameBlock", block: b.block });
    if (inBlock.length === 0 && opts.requireAllBlocks !== false) errors.push({ code: "missingBlock", block: b.block });
  }
  const taking = new Set([...offerings.filter((o) => o.kind === "CORE"), ...chosen].map((o) => o.code.toUpperCase()));
  for (const o of chosen) {
    const missing = missingPrerequisites(o, taking, priorCodes);
    if (missing.length) errors.push({ code: "prerequisite", subjectId: o.subjectId, missing });
  }
  return errors;
}
