// Attendance codes: the school's list (AttendanceCode rows) with a built-in default set, and the pure rules
// for how a code counts. Pure: no database access, safe for client and server, unit-tested.
//
// The default set follows the shape common in UAE private schools: one present code, one late code, an
// "absent, reason not known yet" code that the attendance office later explains, authorised absence codes
// by reason, an unauthorised code, approved school activities and remote learning (both count as present),
// and a not-counted code. It is a starting point, not a regulator's list: each school edits it to match its
// own attendance policy and the categories its regulator (KHDA, ADEK, SPEA, MoE) asks it to report.
import type { AttendanceCountsAs, AttendanceStatus } from "@prisma/client";

/** Statistical categories reports group codes by. Labels live in messages under attendance.category. */
export const CATEGORIES = [
  "present",
  "late",
  "activity",
  "remote",
  "unexplained",
  "authorised",
  "illness",
  "medical",
  "family",
  "religious",
  "suspension",
  "unauthorised",
  "not_required",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** The one-tap buttons on a register, in order. */
export const QUICK = ["present", "late", "absent", "excused", "activity"] as const;
export type Quick = (typeof QUICK)[number];

export type Code = {
  code: string;
  labelEn: string;
  labelAr: string;
  countsAs: AttendanceCountsAs;
  authorised: boolean;
  late: boolean;
  category: string;
  private: boolean;
  quick: string | null;
  active: boolean;
  sortOrder: number;
};

const c = (code: string, labelEn: string, labelAr: string, countsAs: AttendanceCountsAs, category: Category, extra: Partial<Code> = {}): Code => ({
  code,
  labelEn,
  labelAr,
  countsAs,
  category,
  authorised: false,
  late: false,
  private: false,
  quick: null,
  active: true,
  sortOrder: 0,
  ...extra,
});

export const DEFAULT_CODES: Code[] = [
  c("P", "Present", "حاضر", "PRESENT", "present", { quick: "present" }),
  c("L", "Late", "متأخر", "PRESENT", "late", { late: true, quick: "late" }),
  c("LB", "Late, school bus", "تأخر بسبب الحافلة المدرسية", "PRESENT", "present"),
  c("SA", "School activity or educational visit", "نشاط مدرسي أو رحلة تعليمية", "PRESENT", "activity", { quick: "activity" }),
  c("RL", "Remote learning", "تعلم عن بعد", "PRESENT", "remote"),
  c("A", "Absent, reason not known yet", "غائب، لم يُعرف السبب بعد", "ABSENT", "unexplained", { quick: "absent" }),
  c("E", "Excused absence", "غياب بعذر", "ABSENT", "authorised", { authorised: true, quick: "excused" }),
  c("I", "Illness", "مرض", "ABSENT", "illness", { authorised: true, private: true }),
  c("M", "Medical or dental appointment", "موعد طبي أو موعد أسنان", "ABSENT", "medical", { authorised: true, private: true }),
  c("F", "Family emergency or bereavement", "ظرف عائلي طارئ أو وفاة", "ABSENT", "family", { authorised: true, private: true }),
  c("R", "Religious observance", "مناسبة دينية", "ABSENT", "religious", { authorised: true, private: true }),
  c("S", "Suspension", "إيقاف عن الدراسة", "ABSENT", "suspension", { authorised: true, private: true }),
  c("U", "Unauthorised absence", "غياب بدون عذر", "ABSENT", "unauthorised"),
  c("N", "Not required to attend", "غير مطلوب الحضور", "NOT_COUNTED", "not_required"),
].map((x, i) => ({ ...x, sortOrder: i }));

/** The legacy status for a code: what the API, older screens and analytics read. */
export function statusOf(code: Pick<Code, "countsAs" | "late" | "authorised">): AttendanceStatus {
  if (code.countsAs === "PRESENT") return code.late ? "LATE" : "PRESENT";
  if (code.countsAs === "ABSENT") return code.authorised ? "EXCUSED" : "ABSENT";
  return "EXCUSED";
}

/** The code for a legacy status when a record has none (rows from before codes, the API, imports). */
export function codeForStatus(codes: Code[], status: AttendanceStatus): Code | undefined {
  const quick: Record<AttendanceStatus, Quick> = { PRESENT: "present", LATE: "late", ABSENT: "absent", EXCUSED: "excused" };
  return codes.find((x) => x.quick === quick[status]) ?? codes.find((x) => statusOf(x) === status);
}

/** Resolve a record's code: its own when known, else the code for its status. */
export function resolveCode(codes: Code[], code: string | null | undefined, status: AttendanceStatus): Code | undefined {
  return (code ? codes.find((x) => x.code === code) : undefined) ?? codeForStatus(codes, status);
}

/** The code a viewer may see. Without attendance.reasons a private code shows as the plain excused code. */
export function visibleCode(codes: Code[], code: Code, seesReasons: boolean): Code {
  if (seesReasons || !code.private) return code;
  return codes.find((x) => x.quick === "excused") ?? { ...code, code: "E", labelEn: "Excused absence", labelAr: "غياب بعذر", private: false };
}

/** Whether a mark needs follow-up by the attendance office: absent and not explained. */
export function isUnexplained(code: Pick<Code, "countsAs" | "category">) {
  return code.countsAs === "ABSENT" && code.category === "unexplained";
}

export type CodeInput = Omit<Code, "sortOrder"> & { sortOrder?: number };

/** Check a school's edited code list. Returns an error key (attendance.codes.error.*) or null. */
export function validateCodes(list: CodeInput[]): string | null {
  if (!list.length || list.length > 40) return "count";
  const seen = new Set<string>();
  for (const x of list) {
    const code = x.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(code)) return "code";
    if (seen.has(code)) return "duplicate";
    seen.add(code);
    if (!x.labelEn.trim() || x.labelEn.length > 80 || x.labelAr.length > 80) return "label";
    if (!["PRESENT", "ABSENT", "NOT_COUNTED"].includes(x.countsAs)) return "countsAs";
    if (!(CATEGORIES as readonly string[]).includes(x.category)) return "category";
    if (x.quick !== null && !(QUICK as readonly string[]).includes(x.quick)) return "quick";
    if (x.countsAs !== "ABSENT" && x.authorised) return "authorised";
    if (x.countsAs !== "PRESENT" && x.late) return "late";
  }
  for (const q of QUICK) {
    const backing = list.filter((x) => x.quick === q);
    if (backing.length !== 1) return "quickMissing";
    if (!backing[0].active) return "quickInactive";
  }
  // The quick buttons must mean what they say.
  const by = (q: Quick) => list.find((x) => x.quick === q)!;
  if (by("present").countsAs !== "PRESENT" || by("present").late) return "quickPresent";
  if (by("late").countsAs !== "PRESENT" || !by("late").late) return "quickLate";
  if (by("absent").countsAs !== "ABSENT" || by("absent").category !== "unexplained") return "quickAbsent";
  if (by("excused").countsAs !== "ABSENT" || !by("excused").authorised || by("excused").private) return "quickExcused";
  if (by("activity").countsAs !== "PRESENT") return "quickActivity";
  return null;
}
