// Automatic class allocation: a pure function with no database access, so it is easy to test.
// One call handles one group: a subject, a grade and an academic year, with its class sections.
//
// Rules
// 1. Stability: a student who is already in a section of this group stays there, even when the
//    section is now over capacity. Running the allocation twice changes nothing.
// 2. Capacity: a new placement only goes to a section with a free seat (capacity, default 24).
// 3. Balance: a new placement goes to the section with the lowest fill, then the fewest students,
//    then the earliest section letter.
// 4. Growth: when every section is full, a new section is opened with the next letter.
// 5. Clean up: a student with a registration row in this group (any status) but no active placement
//    in a section is removed from it. Students without any registration row are left alone, so older
//    enrollments that were never registered are not touched.

export const DEFAULT_CAPACITY = 24;

export type AllocSection = {
  id: string;
  /** Section letter; a single section without a letter counts as "A". */
  section: string | null;
  capacity: number | null;
  /** Student ids currently enrolled in this section. */
  members: string[];
};

export type AllocRequest = {
  registrationId: string;
  studentId: string;
  /** The class this registration points at today, if any. */
  classId: string | null;
  /** REQUESTED and ALLOCATED registrations are active; DROPPED ones are not. */
  active: boolean;
  status: string;
};

export type AllocInput = { sections: AllocSection[]; requests: AllocRequest[]; defaultCapacity?: number };

export type NewSection = { id: string; section: string };

export type AllocResult = {
  /** Sections to create before the enrollments below. Ids start with "new:". */
  newSections: NewSection[];
  enroll: Array<{ studentId: string; classId: string }>;
  unenroll: Array<{ studentId: string; classId: string }>;
  /** Registration rows whose classId or status must change. */
  updates: Array<{ registrationId: string; classId: string | null; status: "ALLOCATED" | "DROPPED" }>;
  /** Final placement of every active registration. */
  placements: Array<{ registrationId: string; studentId: string; classId: string }>;
};

/** A, B, ... Z, AA, AB ... */
export function letterAt(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function letterIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) {
    const c = ch.charCodeAt(0) - 64;
    if (c < 1 || c > 26) return -1;
    n = n * 26 + c;
  }
  return n - 1;
}

/** The letter for the next new section, after every letter already in use. */
export function nextSectionLetter(existing: Array<string | null>): string {
  const used = existing.map((s) => letterIndex(s ?? "A")).filter((i) => i >= 0);
  return letterAt(used.length ? Math.max(...used) + 1 : 0);
}

export function allocateGroup(input: AllocInput): AllocResult {
  const cap = (s: { capacity: number | null }) => (s.capacity && s.capacity > 0 ? s.capacity : input.defaultCapacity ?? DEFAULT_CAPACITY);
  type Working = { id: string; section: string | null; capacity: number | null; members: Set<string>; count: number; isNew: boolean };
  const sections: Working[] = input.sections.map((s) => ({ id: s.id, section: s.section, capacity: s.capacity, members: new Set(s.members), count: 0, isNew: false }));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const managed = new Set(input.requests.map((r) => r.studentId));

  // A student may hold only one active registration per group; keep the first.
  const seen = new Set<string>();
  const active: AllocRequest[] = [];
  const inactive: AllocRequest[] = [];
  for (const r of input.requests) {
    if (r.active && !seen.has(r.studentId)) {
      seen.add(r.studentId);
      active.push(r);
    } else inactive.push(r);
  }

  // Seats already taken by students this allocation does not manage.
  for (const s of sections) for (const m of s.members) if (!managed.has(m)) s.count++;

  // 1. Keep existing placements.
  const placed = new Map<string, string>(); // registrationId -> classId
  const unplaced: AllocRequest[] = [];
  for (const r of active) {
    let current = r.classId && byId.has(r.classId) ? r.classId : null;
    if (!current) {
      const home = sections.filter((s) => s.members.has(r.studentId)).sort((a, b) => a.id.localeCompare(b.id))[0];
      current = home?.id ?? null;
    }
    if (current) {
      placed.set(r.registrationId, current);
      byId.get(current)!.count++;
    } else unplaced.push(r);
  }

  // 2. Place the rest where there is room, least full first; open a section when all are full.
  const newSections: NewSection[] = [];
  const order = (s: Working) => letterIndex(s.section ?? "A");
  for (const r of unplaced) {
    const open = sections.filter((s) => s.count < cap(s));
    let target = open.sort((a, b) => a.count / cap(a) - b.count / cap(b) || a.count - b.count || order(a) - order(b) || a.id.localeCompare(b.id))[0];
    if (!target) {
      const letter = nextSectionLetter(sections.map((s) => s.section));
      target = { id: `new:${letter}`, section: letter, capacity: null, members: new Set(), count: 0, isNew: true };
      sections.push(target);
      byId.set(target.id, target);
      newSections.push({ id: target.id, section: letter });
    }
    placed.set(r.registrationId, target.id);
    target.count++;
  }

  // 3. Diff against what exists.
  const enroll: AllocResult["enroll"] = [];
  const unenroll: AllocResult["unenroll"] = [];
  const updates: AllocResult["updates"] = [];
  const placements: AllocResult["placements"] = [];
  const finalClassOf = new Map<string, string>();
  for (const r of active) {
    const classId = placed.get(r.registrationId)!;
    finalClassOf.set(r.studentId, classId);
    placements.push({ registrationId: r.registrationId, studentId: r.studentId, classId });
    if (!byId.get(classId)!.members.has(r.studentId)) enroll.push({ studentId: r.studentId, classId });
    if (r.classId !== classId || r.status !== "ALLOCATED") updates.push({ registrationId: r.registrationId, classId, status: "ALLOCATED" });
  }
  for (const r of inactive) {
    if (r.classId !== null) updates.push({ registrationId: r.registrationId, classId: null, status: "DROPPED" });
  }
  for (const s of sections) {
    if (s.isNew) continue;
    for (const m of s.members) {
      if (!managed.has(m)) continue;
      if (finalClassOf.get(m) !== s.id) unenroll.push({ studentId: m, classId: s.id });
    }
  }
  return { newSections, enroll, unenroll, updates, placements };
}
