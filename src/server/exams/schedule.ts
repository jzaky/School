// Exam timetable logic. Pure functions: clash detection and an automatic schedule suggestion.
// All dates are Dubai calendar days (YYYY-MM-DD) and minutes from Dubai midnight.

const DUBAI_OFFSET_MIN = 240;

export type SittingLike = {
  id: string;
  gradeLevel: number;
  subjectId: string;
  startsAt: Date;
  endsAt: Date;
  room: string | null;
  invigilatorIds: string[];
};

export type ClashKind = "grade" | "invigilator" | "room" | "holiday" | "weekend";
export type Clash = { sittingId: string; kind: ClashKind; otherId?: string; invigilatorId?: string; holiday?: string };
export type HolidaySpan = { start: Date; end: Date; title: string };

export function dayKey(d: Date) {
  return new Date(d.getTime() + DUBAI_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

export function instant(key: string, minute: number) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minute - DUBAI_OFFSET_MIN));
}

export function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * Every clash in a set of sittings: the same grade sitting two exams at once, an invigilator or a room
 * booked twice at the same time, or an exam on a weekend or a holiday. Each pairwise clash is reported
 * for both sittings so each row can show its own warning.
 */
export function detectClashes(sittings: SittingLike[], opts: { holidays?: HolidaySpan[]; weekDays?: number[] } = {}): Clash[] {
  const weekDays = opts.weekDays ?? [1, 2, 3, 4, 5];
  const out: Clash[] = [];
  for (let i = 0; i < sittings.length; i++) {
    const a = sittings[i];
    for (let j = i + 1; j < sittings.length; j++) {
      const b = sittings[j];
      if (!overlaps(a, b)) continue;
      if (a.gradeLevel === b.gradeLevel) {
        out.push({ sittingId: a.id, kind: "grade", otherId: b.id }, { sittingId: b.id, kind: "grade", otherId: a.id });
      }
      if (a.room && b.room && a.room.trim().toLowerCase() === b.room.trim().toLowerCase()) {
        out.push({ sittingId: a.id, kind: "room", otherId: b.id }, { sittingId: b.id, kind: "room", otherId: a.id });
      }
      for (const inv of a.invigilatorIds) {
        if (b.invigilatorIds.includes(inv)) out.push({ sittingId: a.id, kind: "invigilator", otherId: b.id, invigilatorId: inv }, { sittingId: b.id, kind: "invigilator", otherId: a.id, invigilatorId: inv });
      }
    }
    const key = dayKey(a.startsAt);
    if (!weekDays.includes(weekdayOf(key))) out.push({ sittingId: a.id, kind: "weekend" });
    const hol = (opts.holidays ?? []).find((h) => dayKey(h.start) <= key && dayKey(new Date(h.end.getTime() - 1)) >= key);
    if (hol) out.push({ sittingId: a.id, kind: "holiday", holiday: hol.title });
  }
  return out;
}

export type SuggestInput = {
  windowStart: string;
  windowEnd: string;
  grades: Array<{ gradeLevel: number; subjects: Array<{ subjectId: string; durationMin: number }> }>;
  /** At most this many exams per day for one grade (1 or 2). */
  maxPerDay: number;
  /** Start minute of each session in a day, for example 08:30 and 11:30. */
  sessions: number[];
  weekDays?: number[];
  blockedDays?: string[];
  rooms?: string[];
  invigilators?: string[];
  invigilatorsPerSitting?: number;
};

export type SuggestedSitting = { gradeLevel: number; subjectId: string; dateKey: string; startMinute: number; endMinute: number; room: string | null; invigilatorIds: string[] };
export type SuggestResult = { sittings: SuggestedSitting[]; unplaced: Array<{ gradeLevel: number; subjectId: string }>; days: string[] };

/** School days in the window, skipping weekends and blocked days (holidays). */
export function examDays(windowStart: string, windowEnd: string, weekDays: number[] = [1, 2, 3, 4, 5], blocked: string[] = []) {
  const days: string[] = [];
  for (let k = windowStart; k <= windowEnd; k = addDays(k, 1)) {
    if (weekDays.includes(weekdayOf(k)) && !blocked.includes(k)) days.push(k);
  }
  return days;
}

/**
 * Spread each grade's subjects evenly across the exam window with at most `maxPerDay` exams per day.
 * Grades are staggered across sessions so rooms and invigilators are shared fairly, and every sitting
 * gets a room and invigilators that are not already booked in the same session.
 */
export function suggestSchedule(input: SuggestInput): SuggestResult {
  const maxPerDay = Math.max(1, Math.min(input.maxPerDay, input.sessions.length || 1));
  const sessions = input.sessions.length ? [...input.sessions].sort((a, b) => a - b) : [8 * 60 + 30];
  const days = examDays(input.windowStart, input.windowEnd, input.weekDays, input.blockedDays);
  const D = days.length;
  const placed: Array<{ gradeLevel: number; subjectId: string; durationMin: number; day: number; session: number }> = [];
  const unplaced: SuggestResult["unplaced"] = [];

  input.grades.forEach((g, gi) => {
    const n = g.subjects.length;
    if (!n) return;
    const capacity = D * maxPerDay;
    const fits = g.subjects.slice(0, capacity);
    for (const s of g.subjects.slice(capacity)) unplaced.push({ gradeLevel: g.gradeLevel, subjectId: s.subjectId });
    const m = fits.length;
    if (m <= D) {
      // One a day, spaced out evenly from the first to the last day of the window.
      fits.forEach((s, i) => {
        const day = m === 1 ? 0 : Math.round((i * (D - 1)) / (m - 1));
        placed.push({ gradeLevel: g.gradeLevel, subjectId: s.subjectId, durationMin: s.durationMin, day, session: (gi + i) % Math.max(1, Math.min(sessions.length, 2)) });
      });
    } else {
      // More subjects than days: fill each day up to maxPerDay, spreading the extras evenly.
      const perDay = Array.from({ length: D }, (_, d) => Math.floor(m / D) + (d < m % D ? 1 : 0));
      let i = 0;
      perDay.forEach((count, day) => {
        for (let k = 0; k < count; k++) {
          const s = fits[i++];
          placed.push({ gradeLevel: g.gradeLevel, subjectId: s.subjectId, durationMin: s.durationMin, day, session: k });
        }
      });
    }
  });

  // Rooms and invigilators, allocated per (day, session) slot with a rotating pool so the load is shared.
  const rooms = input.rooms ?? [];
  const pool = input.invigilators ?? [];
  const perSitting = Math.max(0, input.invigilatorsPerSitting ?? 1);
  const used = new Map<string, { rooms: Set<string>; people: Set<string> }>();
  let rot = 0;
  const sittings: SuggestedSitting[] = placed
    .sort((a, b) => a.day - b.day || a.session - b.session || a.gradeLevel - b.gradeLevel)
    .map((p) => {
      const slot = `${p.day}:${p.session}`;
      const u = used.get(slot) ?? { rooms: new Set<string>(), people: new Set<string>() };
      used.set(slot, u);
      const room = rooms.find((r) => !u.rooms.has(r)) ?? null;
      if (room) u.rooms.add(room);
      const inv: string[] = [];
      for (let tries = 0; tries < pool.length && inv.length < perSitting; tries++) {
        const cand = pool[(rot + tries) % pool.length];
        if (!u.people.has(cand)) {
          inv.push(cand);
          u.people.add(cand);
        }
      }
      rot = pool.length ? (rot + Math.max(1, inv.length)) % pool.length : 0;
      const startMinute = sessions[p.session] ?? sessions[0];
      return { gradeLevel: p.gradeLevel, subjectId: p.subjectId, dateKey: days[p.day], startMinute, endMinute: startMinute + p.durationMin, room, invigilatorIds: inv };
    });
  return { sittings, unplaced, days };
}
