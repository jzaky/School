// Weekly timetable generator. Pure and deterministic: the same input always gives the same timetable.
//
// Model: each section (class) needs `periods` lessons a week in LESSON periods of the bell schedule.
// Sections of the same grade and option block form one group that runs in parallel.
// Hard constraints: a teacher, a student and a room are in one place per period; locked lessons stay;
// a subject meets at most a few times per day; a teacher's daily load is capped.
// Method: most constrained group first, greedy placement by a spread score, then a bounded
// repair search (move up to a few blocking lessons elsewhere) with full undo, then a relaxed pass.

export type SolverPeriod = { day: number; period: number };
export type SolverClass = {
  id: string;
  teacherId: string | null;
  gradeLevel: number;
  optionBlock?: string | null;
  periods: number;
  room?: string | null;
  studentIds: string[];
};
export type SolverLock = { classId: string; day: number; period: number };
export type SolverOptions = { maxTeacherPerDay?: number; budget?: number };

export type UnplacedReason = "NO_LESSON_PERIODS" | "TEACHER_BUSY" | "STUDENTS_BUSY" | "ROOM_BUSY" | "DAY_LIMIT" | "TEACHER_DAY_LIMIT" | "TOO_MANY_PERIODS";
export type SolverWarning =
  | { kind: "BLOCK_STUDENT_OVERLAP"; classIds: string[]; count: number }
  | { kind: "BLOCK_TEACHER_OVERLAP"; classIds: string[]; teacherId: string }
  | { kind: "NO_TEACHER"; classIds: string[] }
  | { kind: "LOCK_INVALID"; classIds: string[]; day: number; period: number }
  | { kind: "LOCK_CLASH"; classIds: string[]; day: number; period: number };

export type SolveResult = {
  placements: Array<{ classId: string; day: number; period: number; locked: boolean }>;
  unplaced: Array<{ classId: string; missing: number; reason: UnplacedReason; teacherId?: string | null }>;
  warnings: SolverWarning[];
  stats: { groups: number; lessonsRequired: number; lessonsPlaced: number; lockedKept: number; ms: number };
};

type Group = {
  key: string;
  members: number[]; // class indexes
  periods: number;
  teachers: string[];
  students: string[];
  rooms: string[];
  slots: number[]; // placed slot indexes
  locked: Set<number>;
};

type Block = { reason: UnplacedReason | null; blockers: Set<number> };

export function solveTimetable(input: { periods: SolverPeriod[]; classes: SolverClass[]; locks?: SolverLock[]; options?: SolverOptions }): SolveResult {
  const t0 = Date.now();
  const P = [...input.periods].sort((a, b) => a.day - b.day || a.period - b.period);
  const slotIndex = new Map(P.map((p, i) => [`${p.day}|${p.period}`, i]));
  const days = [...new Set(P.map((p) => p.day))];
  const dayIdx = P.map((p) => days.indexOf(p.day));
  const nDays = Math.max(1, days.length);
  const maxTeacherPerDay = input.options?.maxTeacherPerDay ?? 6;
  let budget = input.options?.budget ?? 60000;
  const classes = [...input.classes].sort((a, b) => a.id.localeCompare(b.id));
  const warnings: SolverWarning[] = [];

  // --- Groups ---------------------------------------------------------------------------
  const byKey = new Map<string, Group>();
  classes.forEach((c, i) => {
    const key = c.optionBlock ? `b|${c.gradeLevel}|${c.optionBlock}` : `c|${c.id}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, members: [], periods: 0, teachers: [], students: [], rooms: [], slots: [], locked: new Set() };
      byKey.set(key, g);
    }
    g.members.push(i);
  });
  const groups = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  const groupOfClass = new Array<number>(classes.length);
  const noTeacher: string[] = [];
  groups.forEach((g, gi) => {
    const tSeen = new Map<string, string>();
    const sSeen = new Map<string, number>();
    const overlapStudents = new Set<string>();
    for (const m of g.members) {
      groupOfClass[m] = gi;
      const c = classes[m];
      g.periods = Math.max(g.periods, Math.max(0, c.periods));
      if (c.teacherId) {
        if (tSeen.has(c.teacherId)) warnings.push({ kind: "BLOCK_TEACHER_OVERLAP", classIds: [tSeen.get(c.teacherId)!, c.id], teacherId: c.teacherId });
        else tSeen.set(c.teacherId, c.id);
      } else noTeacher.push(c.id);
      for (const s of c.studentIds) {
        if (sSeen.has(s)) overlapStudents.add(s);
        sSeen.set(s, (sSeen.get(s) ?? 0) + 1);
      }
      if (c.room && !g.rooms.includes(c.room)) g.rooms.push(c.room);
    }
    g.teachers = [...tSeen.keys()].sort();
    g.students = [...sSeen.keys()].sort();
    g.rooms.sort();
    if (overlapStudents.size) warnings.push({ kind: "BLOCK_STUDENT_OVERLAP", classIds: g.members.map((m) => classes[m].id), count: overlapStudents.size });
  });
  if (noTeacher.length) warnings.push({ kind: "NO_TEACHER", classIds: noTeacher });

  // --- Occupancy ------------------------------------------------------------------------
  const teacherAt = P.map(() => new Map<string, number>());
  const studentAt = P.map(() => new Map<string, number>());
  const roomAt = P.map(() => new Map<string, number>());
  const teacherDay = new Map<string, number[]>();
  const tDay = (t: string) => {
    let a = teacherDay.get(t);
    if (!a) teacherDay.set(t, (a = new Array(nDays).fill(0)));
    return a;
  };
  const groupDay = groups.map(() => new Array<number>(nDays).fill(0));

  type Op = { kind: "place" | "remove"; g: number; s: number };
  let journal: Op[] | null = null;

  function place(gi: number, s: number) {
    const g = groups[gi];
    g.slots.push(s);
    for (const t of g.teachers) {
      teacherAt[s].set(t, gi);
      tDay(t)[dayIdx[s]]++;
    }
    for (const st of g.students) studentAt[s].set(st, gi);
    for (const r of g.rooms) roomAt[s].set(r, gi);
    groupDay[gi][dayIdx[s]]++;
    journal?.push({ kind: "place", g: gi, s });
  }
  function remove(gi: number, s: number) {
    const g = groups[gi];
    const at = g.slots.indexOf(s);
    if (at < 0) return;
    g.slots.splice(at, 1);
    for (const t of g.teachers) {
      if (teacherAt[s].get(t) === gi) teacherAt[s].delete(t);
      tDay(t)[dayIdx[s]]--;
    }
    for (const st of g.students) if (studentAt[s].get(st) === gi) studentAt[s].delete(st);
    for (const r of g.rooms) if (roomAt[s].get(r) === gi) roomAt[s].delete(r);
    groupDay[gi][dayIdx[s]]--;
    journal?.push({ kind: "remove", g: gi, s });
  }
  function undo(ops: Op[]) {
    const saved = journal;
    journal = null;
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (op.kind === "place") remove(op.g, op.s);
      else place(op.g, op.s);
    }
    journal = saved;
  }

  // --- Locked lessons stay ----------------------------------------------------------------
  let lockedKept = 0;
  const lockedByClass = new Map<string, Set<number>>();
  for (const l of [...(input.locks ?? [])].sort((a, b) => a.classId.localeCompare(b.classId) || a.day - b.day || a.period - b.period)) {
    const ci = classes.findIndex((c) => c.id === l.classId);
    if (ci < 0) continue;
    const s = slotIndex.get(`${l.day}|${l.period}`);
    if (s === undefined) {
      warnings.push({ kind: "LOCK_INVALID", classIds: [l.classId], day: l.day, period: l.period });
      continue;
    }
    const gi = groupOfClass[ci];
    if (!lockedByClass.has(l.classId)) lockedByClass.set(l.classId, new Set());
    lockedByClass.get(l.classId)!.add(s);
    lockedKept++;
    if (groups[gi].slots.includes(s)) continue;
    const b = blockersAt(gi, s, true, true);
    if (b.blockers.size) warnings.push({ kind: "LOCK_CLASH", classIds: [l.classId, ...[...b.blockers].flatMap((x) => groups[x].members.map((m) => classes[m].id))], day: l.day, period: l.period });
    place(gi, s);
    groups[gi].locked.add(s);
  }

  // --- Constraint checks ------------------------------------------------------------------
  function dayCap(gi: number, relaxed: boolean) {
    const base = Math.max(1, Math.ceil(groups[gi].periods / nDays));
    return relaxed ? base + 1 : base;
  }
  /** Why group gi cannot go in slot s, and which placed groups are in the way. */
  function blockersAt(gi: number, s: number, relaxed: boolean, ignoreCaps = false): Block {
    const g = groups[gi];
    const blockers = new Set<number>();
    let reason: UnplacedReason | null = null;
    if (g.slots.includes(s)) return { reason: "DAY_LIMIT", blockers };
    const d = dayIdx[s];
    if (!ignoreCaps) {
      if (groupDay[gi][d] >= dayCap(gi, relaxed)) return { reason: "DAY_LIMIT", blockers };
      const cap = relaxed ? maxTeacherPerDay + 1 : maxTeacherPerDay;
      for (const t of g.teachers) if (tDay(t)[d] >= cap) return { reason: "TEACHER_DAY_LIMIT", blockers };
    }
    for (const t of g.teachers) {
      const o = teacherAt[s].get(t);
      if (o !== undefined) {
        blockers.add(o);
        reason ??= "TEACHER_BUSY";
      }
    }
    for (const st of g.students) {
      const o = studentAt[s].get(st);
      if (o !== undefined) {
        blockers.add(o);
        reason ??= "STUDENTS_BUSY";
      }
    }
    for (const r of g.rooms) {
      const o = roomAt[s].get(r);
      if (o !== undefined) {
        blockers.add(o);
        reason ??= "ROOM_BUSY";
      }
    }
    return { reason, blockers };
  }

  function score(gi: number, s: number) {
    const g = groups[gi];
    const d = dayIdx[s];
    let sc = groupDay[gi][d] * 1000;
    if (d > 0 && groupDay[gi][d - 1] > 0) sc += 40;
    if (d < nDays - 1 && groupDay[gi][d + 1] > 0) sc += 40;
    for (const t of g.teachers) sc += tDay(t)[d] * 12;
    // Mild preference for lessons earlier in the day, and for the day with the fewest lessons of this group so far.
    sc += (P[s].period % 16) * 0.5;
    return sc;
  }

  function bestFree(gi: number, relaxed: boolean, avoid?: number): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (let s = 0; s < P.length; s++) {
      if (s === avoid) continue;
      const b = blockersAt(gi, s, relaxed);
      if (b.reason) continue;
      const sc = score(gi, s);
      if (sc < bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    return best;
  }

  /** Place one lesson of gi, moving up to `maxBlockers` other lessons if needed. */
  function placeWithRepair(gi: number, relaxed: boolean, depth: number, frozen: Set<string>): boolean {
    const direct = bestFree(gi, relaxed);
    if (direct !== null) {
      place(gi, direct);
      return true;
    }
    if (depth <= 0 || budget <= 0) return false;
    const cands: Array<{ s: number; blockers: number[]; sc: number }> = [];
    for (let s = 0; s < P.length; s++) {
      const b = blockersAt(gi, s, relaxed);
      if (b.reason === "DAY_LIMIT" || b.reason === "TEACHER_DAY_LIMIT") continue;
      const bl = [...b.blockers];
      if (bl.length === 0 || bl.length > 2) continue;
      if (bl.some((x) => groups[x].locked.has(s) || frozen.has(`${x}|${s}`))) continue;
      cands.push({ s, blockers: bl, sc: bl.length * 10000 + bl.reduce((n, x) => n + groups[x].students.length, 0) * 10 + score(gi, s) });
    }
    cands.sort((a, b) => a.sc - b.sc || a.s - b.s);
    for (const c of cands.slice(0, 10)) {
      if (budget-- <= 0) return false;
      const outer = journal;
      const ops: Op[] = [];
      journal = ops;
      for (const x of c.blockers) remove(x, c.s);
      if (blockersAt(gi, c.s, relaxed).reason) {
        journal = outer;
        undo(ops);
        continue;
      }
      place(gi, c.s);
      const nextFrozen = new Set(frozen);
      nextFrozen.add(`${gi}|${c.s}`);
      let ok = true;
      for (const x of c.blockers) {
        const alt = bestFree(x, relaxed, c.s);
        if (alt !== null) place(x, alt);
        else if (!placeWithRepair(x, relaxed, depth - 1, nextFrozen)) {
          ok = false;
          break;
        }
      }
      journal = outer;
      if (ok) {
        outer?.push(...ops);
        return true;
      }
      undo(ops);
    }
    return false;
  }

  // --- Order: most constrained first ----------------------------------------------------
  const tIndex = new Map<string, number[]>();
  const sIndex = new Map<string, number[]>();
  groups.forEach((g, gi) => {
    for (const t of g.teachers) (tIndex.get(t) ?? tIndex.set(t, []).get(t)!).push(gi);
    for (const s of g.students) (sIndex.get(s) ?? sIndex.set(s, []).get(s)!).push(gi);
  });
  const difficulty = groups.map((g, gi) => {
    const nb = new Set<number>();
    for (const t of g.teachers) for (const x of tIndex.get(t)!) nb.add(x);
    for (const s of g.students) for (const x of sIndex.get(s)!) nb.add(x);
    nb.delete(gi);
    let load = 0;
    for (const x of nb) load += groups[x].periods;
    return load + g.periods * 4 + g.students.length;
  });
  const order = groups.map((_, i) => i).sort((a, b) => difficulty[b] - difficulty[a] || groups[a].key.localeCompare(groups[b].key));
  const need = (gi: number) => Math.max(0, groups[gi].periods - groups[gi].slots.length);

  let lessonsRequired = 0;
  for (const c of classes) lessonsRequired += Math.max(0, c.periods);

  if (P.length > 0) {
    // Pass 1: strict caps, shallow repair. Place lessons round-robin so no group hogs the best periods.
    for (const gi of order) {
      let n = need(gi);
      while (n-- > 0) if (!placeWithRepair(gi, false, 2, new Set())) break;
    }
    // Pass 2 and 3: relaxed caps and deeper repair for anything left.
    for (const depth of [3, 4]) {
      for (const gi of order) {
        let n = need(gi);
        while (n-- > 0) if (!placeWithRepair(gi, true, depth, new Set())) break;
      }
    }
  }

  // --- Output ---------------------------------------------------------------------------
  const placements: SolveResult["placements"] = [];
  const unplaced: SolveResult["unplaced"] = [];
  let lessonsPlaced = 0;
  groups.forEach((g, gi) => {
    const slots = [...g.slots].sort((a, b) => a - b);
    for (const m of g.members) {
      const c = classes[m];
      const own = lockedByClass.get(c.id) ?? new Set<number>();
      const mine: number[] = slots.filter((s) => own.has(s));
      for (const s of slots) {
        if (mine.length >= Math.max(c.periods, own.size)) break;
        if (!own.has(s) && !g.locked.has(s)) mine.push(s);
      }
      // Other members' locked periods are shared by the whole group when there is room.
      for (const s of slots) {
        if (mine.length >= c.periods) break;
        if (!mine.includes(s)) mine.push(s);
      }
      for (const s of mine.sort((a, b) => a - b)) placements.push({ classId: c.id, day: P[s].day, period: P[s].period, locked: own.has(s) });
      lessonsPlaced += Math.min(mine.length, c.periods);
      const missing = c.periods - mine.length;
      if (missing > 0) unplaced.push({ classId: c.id, missing, reason: explain(gi), teacherId: c.teacherId });
    }
  });

  function explain(gi: number): UnplacedReason {
    if (P.length === 0) return "NO_LESSON_PERIODS";
    if (groups[gi].periods > P.length) return "TOO_MANY_PERIODS";
    const tally = new Map<UnplacedReason, number>();
    for (let s = 0; s < P.length; s++) {
      if (groups[gi].slots.includes(s)) continue;
      const b = blockersAt(gi, s, true);
      if (b.reason) tally.set(b.reason, (tally.get(b.reason) ?? 0) + 1);
    }
    const order: UnplacedReason[] = ["TEACHER_BUSY", "STUDENTS_BUSY", "ROOM_BUSY", "TEACHER_DAY_LIMIT", "DAY_LIMIT"];
    let best: UnplacedReason = "STUDENTS_BUSY";
    let n = -1;
    for (const r of order) if ((tally.get(r) ?? 0) > n) [best, n] = [r, tally.get(r) ?? 0];
    return best;
  }

  return {
    placements,
    unplaced: unplaced.sort((a, b) => a.classId.localeCompare(b.classId)),
    warnings,
    stats: { groups: groups.length, lessonsRequired, lessonsPlaced, lockedKept, ms: Date.now() - t0 },
  };
}

/** Independent checker: returns every clash in a set of placements. Used by tests and the move-lesson check. */
export function findClashes(
  placements: Array<{ classId: string; day: number; period: number }>,
  classes: SolverClass[],
): Array<{ kind: "TEACHER" | "STUDENT" | "ROOM"; day: number; period: number; classIds: [string, string] }> {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const blockOf = (c: SolverClass) => (c.optionBlock ? `${c.gradeLevel}|${c.optionBlock}` : null);
  const out: ReturnType<typeof findClashes> = [];
  const bySlot = new Map<string, string[]>();
  for (const p of placements) {
    const k = `${p.day}|${p.period}`;
    (bySlot.get(k) ?? bySlot.set(k, []).get(k)!).push(p.classId);
  }
  for (const [k, ids] of bySlot) {
    const [day, period] = k.split("|").map(Number);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = byId.get(ids[i]);
        const b = byId.get(ids[j]);
        if (!a || !b) continue;
        if (a.teacherId && a.teacherId === b.teacherId) out.push({ kind: "TEACHER", day, period, classIds: [a.id, b.id] });
        if (a.room && a.room === b.room) out.push({ kind: "ROOM", day, period, classIds: [a.id, b.id] });
        const sameBlock = blockOf(a) !== null && blockOf(a) === blockOf(b);
        if (!sameBlock) {
          const set = new Set(a.studentIds);
          if (b.studentIds.some((s) => set.has(s))) out.push({ kind: "STUDENT", day, period, classIds: [a.id, b.id] });
        }
      }
  }
  return out;
}
