// Bell schedule helpers. Pure: no database access, safe for client and server.

export type PeriodKindT = "LESSON" | "BREAK" | "ASSEMBLY";
export type BellRow = { dayOfWeek: number; periodNo: number; startTime: string; endTime: string; kind: PeriodKindT };

export type PresetOptions = {
  days: number[]; // school days, 0 Sunday ... 6 Saturday
  start: string; // "07:30"
  assemblyMin: number; // 0 for no assembly
  lessonsPerDay: number;
  lessonMin: number;
  breakAfter: number[]; // lesson numbers followed by a break, e.g. [3, 6]
  breakMin: number[]; // length of each break, same order
  fridayLessons: number; // shorter Friday
  fridayLessonMin: number;
};

export const UAE_PRESET: PresetOptions = {
  days: [1, 2, 3, 4, 5],
  start: "07:30",
  assemblyMin: 15,
  lessonsPerDay: 8,
  lessonMin: 45,
  breakAfter: [3, 6],
  breakMin: [20, 30],
  fridayLessons: 5,
  fridayLessonMin: 40,
};

export function toMinutes(hhmm: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Build a full week of bell periods from a preset. Friday (5) gets fewer, shorter lessons and one break. */
export function buildPreset(o: PresetOptions): BellRow[] {
  const rows: BellRow[] = [];
  for (const day of [...o.days].sort((a, b) => a - b)) {
    const friday = day === 5;
    const lessons = friday ? o.fridayLessons : o.lessonsPerDay;
    const len = friday ? o.fridayLessonMin : o.lessonMin;
    let t = toMinutes(o.start);
    let no = 1;
    if (o.assemblyMin > 0) {
      rows.push({ dayOfWeek: day, periodNo: no++, startTime: fromMinutes(t), endTime: fromMinutes(t + o.assemblyMin), kind: "ASSEMBLY" });
      t += o.assemblyMin;
    }
    for (let l = 1; l <= lessons; l++) {
      rows.push({ dayOfWeek: day, periodNo: no++, startTime: fromMinutes(t), endTime: fromMinutes(t + len), kind: "LESSON" });
      t += len;
      const bi = o.breakAfter.indexOf(l);
      // Friday keeps only the first break.
      if (bi >= 0 && l < lessons && (!friday || bi === 0)) {
        const bm = o.breakMin[bi] ?? 20;
        rows.push({ dayOfWeek: day, periodNo: no++, startTime: fromMinutes(t), endTime: fromMinutes(t + bm), kind: "BREAK" });
        t += bm;
      }
    }
  }
  return rows;
}

/** Validate one day of periods: times parse, end after start, no overlaps. Returns an error code or null. */
export function validateDay(rows: Array<Pick<BellRow, "startTime" | "endTime" | "kind">>): string | null {
  let prevEnd = -1;
  for (const r of rows) {
    const s = toMinutes(r.startTime);
    const e = toMinutes(r.endTime);
    if (Number.isNaN(s) || Number.isNaN(e)) return "BAD_TIME";
    if (e <= s) return "END_BEFORE_START";
    if (s < prevEnd) return "PERIODS_OVERLAP";
    prevEnd = e;
  }
  return null;
}

/** Lesson number (1, 2, ...) of each LESSON period on a day, keyed by periodNo. */
export function lessonNumbers(rows: BellRow[], day: number): Map<number, number> {
  const out = new Map<number, number>();
  let n = 0;
  for (const r of rows.filter((x) => x.dayOfWeek === day).sort((a, b) => a.periodNo - b.periodNo)) {
    if (r.kind === "LESSON") out.set(r.periodNo, ++n);
  }
  return out;
}
