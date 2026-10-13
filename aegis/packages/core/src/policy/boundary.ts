import { extractRefundSettings, formatRefundAmount, refundCurrencies } from "./templates.js";
import { extractScoreBandSettings, formatScore, scoreBandAttr } from "./score-band.js";
import { extractTradingSettings, formatNotional } from "./trading.js";

/**
 * One sentence for approvers: which boundary the request was close to. Derived from the policy that
 * decided the request. Guided templates give exact wording (how far the amount or score sits from
 * each limit); any other policy gets the matched comparison of the deciding rule from the stored trace.
 */

export interface TraceComparison {
  attr: string;
  op: string;
  expected?: unknown;
  actual?: unknown;
  result: boolean;
}
export interface TraceEntry {
  policyKey?: string;
  ruleId: string;
  matched: boolean;
  comparisons?: TraceComparison[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pad(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function getPath(obj: Record<string, unknown> | undefined, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function refundBoundary(doc: unknown, ruleId: string, params: Record<string, unknown>, context: Record<string, unknown>): string | null {
  const s = extractRefundSettings(doc);
  if (!s) return null;
  const amount = num(params.amount);
  const cur = typeof params.currency === "string" ? params.currency : s.currency;
  const f = (n: number) => formatRefundAmount(n, cur);
  switch (ruleId) {
    case "approval-band":
      if (amount === null) return null;
      return `${f(amount)} is ${f(amount - s.autoApproveBelow)} above the automatic limit of ${f(s.autoApproveBelow)} and ${f(s.approvalUpTo - amount)} below the ceiling of ${f(s.approvalUpTo)}.`;
    case "above-limit":
      if (amount === null) return null;
      return `${f(amount)} is ${f(amount - s.approvalUpTo)} above the ceiling of ${f(s.approvalUpTo)}; the agent has no authority for it.`;
    case "autonomous-band":
      if (amount === null) return null;
      return `${f(amount)} is ${f(s.autoApproveBelow - amount)} below the automatic limit of ${f(s.autoApproveBelow)}.`;
    case "duplicate-refund": {
      const n = num(context.priorRequestsSameReference) ?? 1;
      const key = typeof context.duplicateReferenceKey === "string" ? context.duplicateReferenceKey : "reference";
      return `${n} earlier refund request${n === 1 ? "" : "s"} for the same ${key} in the last 30 days; the limit is none.`;
    }
    case "after-hours": {
      const hour = num(context.hour);
      return hour === null ? `Requested outside business hours (${pad(s.businessHoursOnly.startHourUtc)} to ${pad(s.businessHoursOnly.endHourUtc)} UTC).` : `Requested at ${pad(hour)} UTC, outside business hours (${pad(s.businessHoursOnly.startHourUtc)} to ${pad(s.businessHoursOnly.endHourUtc)} UTC).`;
    }
    case "too-many-denials": {
      const n = num(context.deniedCount24h);
      return n === null ? `The agent reached the limit of ${s.maxDailyDeniedAttempts} refused attempts in 24 hours.` : `The agent had ${n} refused attempts in 24 hours; the limit is ${s.maxDailyDeniedAttempts}.`;
    }
    case "wrong-currency":
      return `${cur} is not an accepted currency (${refundCurrencies(s).join(", ")}).`;
    case "missing-reason":
      return "No reason was given with the refund.";
    default:
      return null;
  }
}

function scoreBoundary(doc: unknown, ruleId: string, params: Record<string, unknown>, context: Record<string, unknown>): string | null {
  const s = extractScoreBandSettings(doc);
  if (!s) return null;
  const path = scoreBandAttr(s);
  const score = num(getPath({ params, context }, path));
  const f = (n: number) => formatScore(n, s);
  switch (ruleId) {
    case "review-band":
      if (score === null) return null;
      return `Score ${f(score)} is ${f(score - s.reviewFrom)} above the review boundary of ${f(s.reviewFrom)} and ${f(s.holdFrom - score)} below the hold boundary of ${f(s.holdFrom)}.`;
    case "hold-band":
      if (score === null) return null;
      return `Score ${f(score)} is ${f(score - s.holdFrom)} above the hold boundary of ${f(s.holdFrom)} and ${f(s.blockFrom - score)} below the block boundary of ${f(s.blockFrom)}.`;
    case "block-band":
      if (score === null) return null;
      return `Score ${f(score)} is ${f(score - s.blockFrom)} above the block boundary of ${f(s.blockFrom)}.`;
    case "clear-band":
      if (score === null) return null;
      return `Score ${f(score)} is ${f(s.reviewFrom - score)} below the review boundary of ${f(s.reviewFrom)}.`;
    case "score-missing":
      return `No ${s.scoreAttribute} was sent with the request.`;
    case "score-out-of-range":
      return score === null ? null : `Score ${f(score)} is outside the 0 to ${f(s.scale === "unit" ? 1 : 100)} range.`;
    default:
      return null;
  }
}

function tradingBoundary(doc: unknown, ruleId: string, params: Record<string, unknown>, context: Record<string, unknown>): string | null {
  const s = extractTradingSettings(doc);
  if (!s) return null;
  const notional = num(params.notional);
  const qty = num(params.qty);
  const f = (n: number) => formatNotional(n, s.currency);
  const units = (n: number) => new Intl.NumberFormat("en-US").format(n);
  switch (ruleId) {
    case "approval-band":
      if (notional === null) return null;
      return `${f(notional)} is ${f(notional - s.autoApproveNotionalBelow)} above the automatic limit of ${f(s.autoApproveNotionalBelow)} and ${f(s.approvalNotionalUpTo - notional)} below the ceiling of ${f(s.approvalNotionalUpTo)}.`;
    case "above-ceiling":
      if (notional === null) return null;
      return `${f(notional)} is ${f(notional - s.approvalNotionalUpTo)} above the ceiling of ${f(s.approvalNotionalUpTo)}; the agent has no authority for it.`;
    case "autonomous-band":
      if (notional === null) return null;
      return `${f(notional)} is ${f(s.autoApproveNotionalBelow - notional)} below the automatic limit of ${f(s.autoApproveNotionalBelow)}.`;
    case "oversize-order":
      if (qty === null) return null;
      return `${units(qty)} units is ${units(qty - s.maxOrderQty)} above the per-order cap of ${units(s.maxOrderQty)}.`;
    case "instrument-not-allowed":
      return `${String(params.symbol ?? "The symbol")} is not on the allowed list (${s.instruments.join(", ")}).`;
    case "side-not-allowed":
      return `${String(params.side ?? "This side")} is not an allowed side (${s.allowedSides.join(", ")}).`;
    case "order-type-not-allowed":
      return `${String(params.type ?? "This order type")} is not an allowed order type (${s.allowedOrderTypes.join(", ")}).`;
    case "duplicate-order": {
      const n = num(context.priorRequestsSameReference) ?? 1;
      return `${n} earlier order${n === 1 ? "" : "s"} with the same reference in the last 30 days; the limit is none.`;
    }
    case "outside-market-hours": {
      const hour = num(context.hour);
      const w = `${pad(s.marketHoursOnly.startHourUtc)} to ${pad(s.marketHoursOnly.endHourUtc)} UTC`;
      return hour === null ? `Requested outside market hours (${w}).` : `Requested at ${pad(hour)} UTC, outside market hours (${w}).`;
    }
    case "daily-loss-cap": {
      const pnl = num((context.supplied as Record<string, unknown> | undefined)?.dayPnl);
      return pnl === null ? `The day's reported loss reached the cap of ${f(s.maxDailyLoss)}.` : `The day's reported result is ${f(pnl)}; the loss cap is ${f(s.maxDailyLoss)}.`;
    }
    case "too-many-orders": {
      const n = num(context.requestCount24h);
      return n === null ? `The agent reached the limit of ${s.maxDailyOrders} requests in 24 hours.` : `The agent sent ${n} requests in 24 hours; the limit is ${s.maxDailyOrders}.`;
    }
    case "missing-reason":
      return "No reason was given with the order.";
    default:
      return null;
  }
}

function show(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (v === undefined || v === null) return "nothing";
  return JSON.stringify(v);
}

const OP_WORDS: Record<string, string> = {
  eq: "equals",
  neq: "is not",
  gt: "is above",
  gte: "is at or above",
  lt: "is below",
  lte: "is at or below",
  between: "is between",
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  matches: "matches",
  exists: "is present",
  missing: "is missing",
  domain_in: "is a domain in",
  domain_not_in: "is a domain outside",
  subset_of: "is within",
  intersects: "overlaps",
};

/** Generic fallback: the deciding rule's matched comparisons, in words. */
export function boundaryFromTrace(trace: TraceEntry[] | undefined, ruleId: string | null, policyKey?: string | null): string | null {
  if (!trace || !ruleId) return null;
  const entry = trace.find((t) => t.ruleId === ruleId && t.matched && (!policyKey || !t.policyKey || t.policyKey === policyKey));
  if (!entry?.comparisons?.length) return null;
  const hits = entry.comparisons.filter((c) => c.result && c.attr !== "always");
  if (!hits.length) return null;
  const parts = hits.slice(0, 2).map((c) => {
    const attr = c.attr.replace(/^params\./, "").replace(/^context\./, "").replace(/^agent\./, "agent ").replace(/^action\./, "action ");
    const word = OP_WORDS[c.op] ?? c.op;
    if (c.op === "exists" || c.op === "missing") return `${attr} ${word}`;
    if (c.op === "between" && Array.isArray(c.expected) && c.expected.length === 2) return `${attr} (${show(c.actual)}) is between ${show(c.expected[0])} and ${show(c.expected[1])}`;
    return `${attr} (${show(c.actual)}) ${word} ${show(c.expected)}`;
  });
  return `Matched because ${parts.join(" and ")}.`;
}

/**
 * Rebuilds the evaluation context a stored decision saw, from the values recorded in its trace
 * (every `context.*` comparison keeps the actual value). Used when the request's context was not stored.
 */
export function contextFromTrace(trace: TraceEntry[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of trace ?? []) {
    for (const c of t.comparisons ?? []) {
      if (!c.attr.startsWith("context.") || c.actual === undefined) continue;
      const path = c.attr.slice("context.".length).split(".");
      let cur = out;
      for (let i = 0; i < path.length - 1; i++) {
        const next = cur[path[i]!];
        if (!next || typeof next !== "object") cur[path[i]!] = {};
        cur = cur[path[i]!] as Record<string, unknown>;
      }
      if (!(path[path.length - 1]! in cur)) cur[path[path.length - 1]!] = c.actual;
    }
  }
  return out;
}

/**
 * Returns the boundary sentence for a decision, or null when nothing useful can be said.
 * `ruleId` may carry the policy prefix ("policy/rule"); the last segment is used. Context values
 * missing from `context` are taken from the trace when one is given.
 */
export function boundarySentence(args: { document: unknown; ruleId: string | null; params: Record<string, unknown>; context?: Record<string, unknown>; trace?: TraceEntry[]; policyKey?: string | null }): string | null {
  const ruleId = args.ruleId?.split("/").pop() ?? null;
  if (!ruleId) return null;
  const fromTrace = contextFromTrace(args.trace);
  const context = { ...fromTrace, ...(args.context ?? {}), supplied: { ...((fromTrace.supplied as Record<string, unknown> | undefined) ?? {}), ...((args.context?.supplied as Record<string, unknown> | undefined) ?? {}) } };
  return refundBoundary(args.document, ruleId, args.params, context) ?? scoreBoundary(args.document, ruleId, args.params, context) ?? tradingBoundary(args.document, ruleId, args.params, context) ?? boundaryFromTrace(args.trace, ruleId, args.policyKey);
}
