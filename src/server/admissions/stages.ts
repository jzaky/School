// Admissions stages and the rules for moving between them. Pure: safe for client and server.
//
// Every school has the same system stages with fixed meaning. A school may rename any stage, hide the optional
// ones and add its own review stages (for example "Principal interview"), which sit with the other review stages
// before an offer. The rules work on the stage's phase, so custom stages behave like the built-in review stages.
//
// Moves that need more than a click go through their own action: an offer needs a deadline and a letter,
// "Seat booking paid" records a payment, "Enrolled" creates the student, and declining or withdrawing needs a reason.

export const SYSTEM_STAGES = [
  "NEW",
  "DOCUMENTS_PENDING",
  "ASSESSMENT_BOOKED",
  "ASSESSED",
  "OFFER_MADE",
  "OFFER_ACCEPTED",
  "SEAT_PAID",
  "ENROLLED",
  "WAITLISTED",
  "DECLINED",
  "WITHDRAWN",
] as const;
export type SystemStage = (typeof SYSTEM_STAGES)[number];

/** Stages a school may hide. The others are needed by the offer and enrollment rules. */
export const OPTIONAL_STAGES: string[] = ["DOCUMENTS_PENDING", "ASSESSMENT_BOOKED", "ASSESSED", "SEAT_PAID", "WAITLISTED"];

export type Phase = "draft" | "review" | "offer" | "accepted" | "paid" | "enrolled" | "waitlist" | "closed";

const SYSTEM_PHASE: Record<string, Phase> = {
  DRAFT: "draft",
  NEW: "review",
  DOCUMENTS_PENDING: "review",
  ASSESSMENT_BOOKED: "review",
  ASSESSED: "review",
  OFFER_MADE: "offer",
  OFFER_ACCEPTED: "accepted",
  SEAT_PAID: "paid",
  ENROLLED: "enrolled",
  WAITLISTED: "waitlist",
  DECLINED: "closed",
  WITHDRAWN: "closed",
};

export const CUSTOM_STAGE_RE = /^C_[A-Z0-9_]{2,30}$/;
export const MAX_CUSTOM_STAGES = 6;

export type StageDef = { key: string; phase: Phase; labelEn: string | null; labelAr: string | null; hidden: boolean; custom: boolean };

/** Stages that hold a seat for the grade (the family accepted and has not left). */
export const SEAT_HOLDING_STAGES = ["OFFER_ACCEPTED", "SEAT_PAID"];
/** Stages that are finished: nothing more happens on the application. */
export const FINAL_STAGES = ["ENROLLED", "DECLINED", "WITHDRAWN"];

export function isSystemStage(key: string): key is SystemStage {
  return (SYSTEM_STAGES as readonly string[]).includes(key);
}

type RawStage = { key?: unknown; labelEn?: unknown; labelAr?: unknown; hidden?: unknown };

const clean = (v: unknown, max = 40) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/**
 * The school's stages in board order: review stages in the school's order (built-in and custom), then the offer,
 * acceptance, payment and enrollment stages, then waitlist and the closed stages. Unknown or malformed entries in the
 * stored JSON are ignored, so a bad setting never breaks the board.
 */
export function stageConfig(raw: unknown): StageDef[] {
  const list: RawStage[] = Array.isArray(raw) ? (raw as RawStage[]) : [];
  const byKey = new Map<string, RawStage>();
  const reviewOrder: string[] = [];
  let customs = 0;
  for (const r of list) {
    const key = typeof r?.key === "string" ? r.key : "";
    if (!key || byKey.has(key)) continue;
    const custom = CUSTOM_STAGE_RE.test(key);
    if (!isSystemStage(key) && !custom) continue;
    if (custom && (customs >= MAX_CUSTOM_STAGES || !clean(r.labelEn))) continue;
    if (custom) customs++;
    byKey.set(key, r);
    if (custom || SYSTEM_PHASE[key] === "review") reviewOrder.push(key);
  }
  // Built-in review stages the stored order leaves out keep their default position.
  const defaultsReview = SYSTEM_STAGES.filter((k) => SYSTEM_PHASE[k] === "review");
  for (const k of defaultsReview) if (!reviewOrder.includes(k)) reviewOrder.splice(Math.min(defaultsReview.indexOf(k), reviewOrder.length), 0, k);
  // NEW is always first: it is where submitted applications arrive.
  const ordered = ["NEW", ...reviewOrder.filter((k) => k !== "NEW"), ...SYSTEM_STAGES.filter((k) => SYSTEM_PHASE[k] !== "review")];
  return ordered.map((key) => {
    const r = byKey.get(key);
    const custom = CUSTOM_STAGE_RE.test(key);
    return {
      key,
      phase: custom ? "review" : SYSTEM_PHASE[key],
      labelEn: clean(r?.labelEn),
      labelAr: clean(r?.labelAr),
      hidden: Boolean(r?.hidden) && OPTIONAL_STAGES.includes(key),
      custom,
    };
  });
}

/** The phase of a stage key. Unknown keys (a custom stage the school later removed) count as review. */
export function phaseOf(key: string, cfg?: StageDef[]): Phase {
  if (SYSTEM_PHASE[key]) return SYSTEM_PHASE[key];
  return cfg?.find((s) => s.key === key)?.phase ?? "review";
}

/** Columns on the board: visible stages, plus a hidden or removed stage that still holds applications. */
export function boardStages(cfg: StageDef[], inUse: string[] = []): StageDef[] {
  const shown = cfg.filter((s) => !s.hidden || inUse.includes(s.key));
  for (const k of inUse) {
    if (k !== "DRAFT" && !shown.some((s) => s.key === k)) shown.splice(Math.max(1, shown.findIndex((s) => s.phase !== "review")), 0, { key: k, phase: "review", labelEn: null, labelAr: null, hidden: true, custom: true });
  }
  return shown;
}

export type MoveAction = "offer" | "paid" | "enroll" | "reason";
export type MoveCheck = { ok: true; action: MoveAction | null } | { ok: false; error: "SAME" | "INVALID" | "HIDDEN" | "NEEDS_PAYMENT" };

/**
 * Whether staff may move an application from one stage to another, and which action the move needs.
 * `seatFeeRequired`: the grade has a seat booking amount and the school uses the "Seat booking paid" stage.
 */
export function checkMove(from: string, to: string, cfg: StageDef[], opts: { seatFeeRequired: boolean }): MoveCheck {
  if (from === to) return { ok: false, error: "SAME" };
  const target = cfg.find((s) => s.key === to);
  if (!target) return { ok: false, error: "INVALID" };
  if (target.hidden) return { ok: false, error: "HIDDEN" };
  const pf = phaseOf(from, cfg);
  const pt = target.phase;
  if (pf === "draft" || pf === "enrolled") return { ok: false, error: "INVALID" };
  switch (pt) {
    case "review":
      // Review stages move freely among themselves; a lapsed offer, a waitlisted or a closed application can return.
      return pf === "review" || pf === "waitlist" || pf === "offer" || pf === "closed" ? { ok: true, action: null } : { ok: false, error: "INVALID" };
    case "waitlist":
      return pf === "review" || pf === "offer" ? { ok: true, action: null } : { ok: false, error: "INVALID" };
    case "offer":
      return pf === "review" || pf === "waitlist" ? { ok: true, action: "offer" } : { ok: false, error: "INVALID" };
    case "accepted":
      return pf === "offer" ? { ok: true, action: null } : { ok: false, error: "INVALID" };
    case "paid":
      return pf === "accepted" ? { ok: true, action: "paid" } : { ok: false, error: "INVALID" };
    case "enrolled":
      if (pf === "paid") return { ok: true, action: "enroll" };
      if (pf === "accepted") return opts.seatFeeRequired ? { ok: false, error: "NEEDS_PAYMENT" } : { ok: true, action: "enroll" };
      return { ok: false, error: "INVALID" };
    case "closed":
      return pf === "closed" ? { ok: false, error: "INVALID" } : { ok: true, action: "reason" };
    default:
      return { ok: false, error: "INVALID" };
  }
}

/** Every stage staff can move to from here, with the action each needs. */
export function nextMoves(from: string, cfg: StageDef[], opts: { seatFeeRequired: boolean }): Array<{ key: string; action: MoveAction | null }> {
  const out: Array<{ key: string; action: MoveAction | null }> = [];
  for (const s of cfg) {
    const c = checkMove(from, s.key, cfg, opts);
    if (c.ok) out.push({ key: s.key, action: c.action });
  }
  return out;
}

/** Does the school collect a seat booking payment before enrollment for this grade? */
export function seatFeeRequired(cfg: StageDef[], seatFeeFils: number | null | undefined) {
  const paid = cfg.find((s) => s.key === "SEAT_PAID");
  return Boolean(seatFeeFils && seatFeeFils > 0 && paid && !paid.hidden);
}

/** Family-side moves: submit a draft, accept or decline an offer before its deadline, withdraw an open application. */
export function familyCan(stage: string, action: "submit" | "accept" | "decline" | "withdraw", opts: { now: Date; offerDeadline?: Date | null }, cfg?: StageDef[]): boolean {
  const p = phaseOf(stage, cfg);
  switch (action) {
    case "submit":
      return p === "draft";
    case "accept":
    case "decline":
      return p === "offer" && (!opts.offerDeadline || opts.offerDeadline.getTime() >= opts.now.getTime());
    case "withdraw":
      return p !== "enrolled" && p !== "closed";
  }
}

/** The family's view of a stage: families see a simple status, never the school's internal review stages. */
export function familyStatus(stage: string, cfg?: StageDef[]): "draft" | "received" | "assessment" | "offer" | "accepted" | "enrolled" | "waitlisted" | "declined" | "withdrawn" {
  if (stage === "ASSESSMENT_BOOKED") return "assessment";
  if (stage === "DECLINED") return "declined";
  if (stage === "WITHDRAWN") return "withdrawn";
  const p = phaseOf(stage, cfg);
  if (p === "draft") return "draft";
  if (p === "offer") return "offer";
  if (p === "accepted" || p === "paid") return "accepted";
  if (p === "enrolled") return "enrolled";
  if (p === "waitlist") return "waitlisted";
  return "received";
}
