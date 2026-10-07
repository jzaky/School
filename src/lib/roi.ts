// School ROI estimate and price quote for /pricing. Pure, shared by the page (client) and the server.
// Every default below is an ASSUMPTION shown and editable on the page; the reasoning is in docs/decisions.md.

export const MODULES = ["core", "safeguarding", "academics", "career", "applications"] as const;
export type PricingModule = (typeof MODULES)[number];

/** Editable assumptions. Volumes are per student, times are minutes of staff time saved per item. */
export type RoiAssumptions = {
  lettersPerStudentYear: number;
  minutesPerLetter: number;
  absencesPerStudentMonth: number;
  minutesPerAbsence: number;
  meetingsPerStudentYear: number;
  minutesPerMeeting: number;
  messagesPerStudentMonth: number;
  minutesPerMessage: number;
  schoolMonthsPerYear: number;
};

export const DEFAULT_ASSUMPTIONS: RoiAssumptions = {
  lettersPerStudentYear: 1,
  minutesPerLetter: 10,
  absencesPerStudentMonth: 0.5,
  minutesPerAbsence: 3,
  meetingsPerStudentYear: 2,
  minutesPerMeeting: 6,
  messagesPerStudentMonth: 1,
  minutesPerMessage: 2,
  schoolMonthsPerYear: 10,
};

/** Input limits for each assumption (the page clamps to these). */
export const ASSUMPTION_LIMITS: Record<keyof RoiAssumptions, { min: number; max: number; step: number }> = {
  lettersPerStudentYear: { min: 0, max: 20, step: 0.1 },
  minutesPerLetter: { min: 0, max: 120, step: 1 },
  absencesPerStudentMonth: { min: 0, max: 10, step: 0.1 },
  minutesPerAbsence: { min: 0, max: 60, step: 1 },
  meetingsPerStudentYear: { min: 0, max: 20, step: 0.1 },
  minutesPerMeeting: { min: 0, max: 60, step: 1 },
  messagesPerStudentMonth: { min: 0, max: 30, step: 0.1 },
  minutesPerMessage: { min: 0, max: 30, step: 1 },
  schoolMonthsPerYear: { min: 1, max: 12, step: 1 },
};

/** Assumed fully loaded cost of one hour of administrative staff time, in AED. Editable on the page. */
export const DEFAULT_STAFF_COST_PER_HOUR = 60;

export type RoiInput ={ students: number; staffCostPerHour: number; assumptions: RoiAssumptions };

export type RoiCategory = "letters" | "absence" | "meetings" | "communication";
export type RoiResult = {
  /** Hours saved per school month, by category and in total, rounded to one decimal. */
  hours: Record<RoiCategory, number>;
  totalHoursMonth: number;
  valueMonth: number;
  valueYear: number;
};

const clamp = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);
const round1 = (v: number) => Math.round(v * 10) / 10;

export function clampAssumptions(a: Partial<RoiAssumptions>): RoiAssumptions {
  const out = { ...DEFAULT_ASSUMPTIONS };
  for (const k of Object.keys(DEFAULT_ASSUMPTIONS) as Array<keyof RoiAssumptions>) {
    const v = a[k];
    if (typeof v === "number") out[k] = clamp(v, ASSUMPTION_LIMITS[k].min, ASSUMPTION_LIMITS[k].max);
  }
  return out;
}

export const STUDENT_LIMITS = { min: 1, max: 20000 };
export const CAMPUS_LIMITS = { min: 1, max: 50 };

/** Hours of staff time saved per school month, and their value at the given hourly staff cost. */
export function computeRoi(input: RoiInput): RoiResult {
  const s = clamp(Math.round(input.students), 0, STUDENT_LIMITS.max);
  const a = clampAssumptions(input.assumptions);
  const months = a.schoolMonthsPerYear;
  const minutes: Record<RoiCategory, number> = {
    // Yearly volumes are spread over the school months.
    letters: ((s * a.lettersPerStudentYear) / months) * a.minutesPerLetter,
    absence: s * a.absencesPerStudentMonth * a.minutesPerAbsence,
    meetings: ((s * a.meetingsPerStudentYear) / months) * a.minutesPerMeeting,
    communication: s * a.messagesPerStudentMonth * a.minutesPerMessage,
  };
  const hours = Object.fromEntries(Object.entries(minutes).map(([k, m]) => [k, round1(m / 60)])) as Record<RoiCategory, number>;
  const exactHours = Object.values(minutes).reduce((x, m) => x + m, 0) / 60;
  const cost = clamp(input.staffCostPerHour, 0, 10000);
  const valueMonth = Math.round(exactHours * cost);
  return { hours, totalHoursMonth: round1(exactHours), valueMonth, valueYear: valueMonth * months };
}

// ---------------------------------------------------------------------------
// Pricing (set by the platform admin; unset by default)
// ---------------------------------------------------------------------------

export type PricingConfig = {
  currency: string;
  /** Annual price per student for each module. Null means "not priced": the page shows Request an offer. */
  perStudent: Record<PricingModule, number | null>;
  /** Percentage off for a pilot, 0 to 100. */
  pilotDiscountPct: number;
  /** Pilot length in months (the pilot is priced pro rata). */
  pilotMonths: number;
  /** Smallest annual amount per school, and per campus. Null means no minimum. */
  minimumAnnual: number | null;
  minimumPerCampus: number | null;
  /** Prices only appear on /pricing when this is on. */
  published: boolean;
};

export const DEFAULT_PRICING: PricingConfig = {
  currency: "AED",
  perStudent: { core: null, safeguarding: null, academics: null, career: null, applications: null },
  pilotDiscountPct: 0,
  pilotMonths: 3,
  minimumAnnual: null,
  minimumPerCampus: null,
  published: false,
};

const money = (v: unknown, max = 1_000_000_000) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v * 100) / 100) : null);

/** Normalize a stored or submitted pricing config. Unknown or invalid values fall back to the defaults. */
export function normalizePricing(raw: unknown): PricingConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const per = (r.perStudent && typeof r.perStudent === "object" ? r.perStudent : {}) as Record<string, unknown>;
  const currency = typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) ? r.currency : "AED";
  return {
    currency,
    perStudent: Object.fromEntries(MODULES.map((m) => [m, money(per[m], 100_000)])) as Record<PricingModule, number | null>,
    pilotDiscountPct: clamp(Number(r.pilotDiscountPct ?? 0), 0, 100),
    pilotMonths: Math.round(clamp(Number(r.pilotMonths ?? 3), 1, 12)),
    minimumAnnual: money(r.minimumAnnual),
    minimumPerCampus: money(r.minimumPerCampus),
    published: r.published === true,
  };
}

export type QuoteInput = { students: number; campuses: number; modules: PricingModule[]; plan: "pilot" | "year" };
export type Quote = {
  currency: string;
  lines: Array<{ module: PricingModule; perStudent: number; amount: number }>;
  /** Full-year list price for the selection. */
  annualList: number;
  /** Before the minimum: pro rata for a pilot, less the pilot discount. */
  subtotal: number;
  discount: number;
  minimum: number;
  minimumApplied: boolean;
  total: number;
  months: number;
};

/** Core services are always part of a plan. */
export function withCore(modules: PricingModule[]): PricingModule[] {
  return MODULES.filter((m) => m === "core" || modules.includes(m));
}

/** The price for a selection, or null when pricing is not published or a chosen module has no price. */
export function priceQuote(config: PricingConfig, input: QuoteInput): Quote | null {
  if (!config.published) return null;
  const modules = withCore(input.modules);
  if (modules.some((m) => config.perStudent[m] == null)) return null;
  const students = Math.round(clamp(input.students, STUDENT_LIMITS.min, STUDENT_LIMITS.max));
  const campuses = Math.round(clamp(input.campuses, CAMPUS_LIMITS.min, CAMPUS_LIMITS.max));
  const lines = modules.map((m) => ({ module: m, perStudent: config.perStudent[m]!, amount: Math.round(config.perStudent[m]! * students * 100) / 100 }));
  const annualList = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const months = input.plan === "pilot" ? config.pilotMonths : 12;
  const proRata = (annualList * months) / 12;
  const discount = input.plan === "pilot" ? Math.round(proRata * (config.pilotDiscountPct / 100) * 100) / 100 : 0;
  const subtotal = Math.round((proRata - discount) * 100) / 100;
  const annualMinimum = Math.max(config.minimumAnnual ?? 0, (config.minimumPerCampus ?? 0) * campuses);
  const minimum = Math.round(((annualMinimum * months) / 12) * 100) / 100;
  const minimumApplied = minimum > subtotal;
  return { currency: config.currency, lines, annualList, subtotal, discount, minimum, minimumApplied, total: minimumApplied ? minimum : subtotal, months };
}

/** Is any price configured at all? */
export const pricingVisible = (c: PricingConfig) => c.published && c.perStudent.core != null;

export type OfferInputs = QuoteInput & { staffCostPerHour: number; assumptions: RoiAssumptions };

/** Validate the estimator inputs sent with an offer request. Returns null when they make no sense. */
export function parseOfferInputs(raw: unknown): OfferInputs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const students = Number(r.students);
  const campuses = Number(r.campuses);
  if (!Number.isInteger(students) || students < STUDENT_LIMITS.min || students > STUDENT_LIMITS.max) return null;
  if (!Number.isInteger(campuses) || campuses < CAMPUS_LIMITS.min || campuses > CAMPUS_LIMITS.max) return null;
  const modules = Array.isArray(r.modules) ? r.modules.filter((m): m is PricingModule => MODULES.includes(m as PricingModule)) : [];
  const plan = r.plan === "pilot" ? "pilot" : r.plan === "year" ? "year" : null;
  if (!plan) return null;
  const cost = Number(r.staffCostPerHour);
  return {
    students,
    campuses,
    modules: withCore(modules),
    plan,
    staffCostPerHour: Number.isFinite(cost) ? clamp(cost, 0, 10000) : 0,
    assumptions: clampAssumptions((r.assumptions && typeof r.assumptions === "object" ? r.assumptions : {}) as Partial<RoiAssumptions>),
  };
}
