import { z } from "zod";
import type { Effect } from "./evaluate.js";
import { parsePolicyDocument, type Condition, type PolicyDocument, type Rule } from "./schema.js";

/**
 * Guided trading policy template (AEGIS Trading).
 *
 * AEGIS does not trade. It governs someone else's trading agent: every order the agent wants to
 * place goes through the Action Gateway, and this template turns a handful of business limits into
 * ordinary policy rules. The settings are the owner's own: an instrument allowlist, allowed sides
 * and order types, a per-order size cap, notional bands (automatic, approval, refused), market
 * hours, a duplicate block, a daily loss cap and a daily order cap. The generated document is plain
 * JSON that validates, evaluates and edits like any other policy; the settings are kept under
 * `meta.template` so the console can reopen the guided form.
 *
 * Every order the agent sends carries: symbol, side, type, qty, notional (the order's value in the
 * account currency as the agent declares it), an optional limit price, a reference (the agent's own
 * order reference, which the gateway also uses to detect duplicates) and a reason. The Alpaca paper
 * connector refuses an order whose declared notional does not match qty times the limit price, and
 * submits market orders by notional, so the declared value is what executes.
 */

export const TRADING_TEMPLATE_ID = "trading-v1";
export const DEFAULT_TRADING_TOOLS = ["submit-order", "place-order"];
export const DEFAULT_INSTRUMENTS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"];

const hourSchema = z.coerce.number().int().min(0).max(23);
const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z0-9.\-/]+$/.test(s), "Symbols are letters, digits, dot, hyphen or slash");

export const ORDER_SIDES = ["buy", "sell"] as const;
export const ORDER_TYPES = ["market", "limit"] as const;

export const tradingTemplateSchema = z
  .object({
    tools: z.array(z.string().trim().min(1).max(80)).min(1).max(20).default(DEFAULT_TRADING_TOOLS),
    /** Account currency the notional bands are expressed in. */
    currency: z
      .string()
      .trim()
      .min(3)
      .max(3)
      .transform((s) => s.toUpperCase())
      .default("USD"),
    /** Only these symbols may be traded. */
    instruments: z.array(symbolSchema).min(1).max(200).default(DEFAULT_INSTRUMENTS),
    allowedSides: z.array(z.enum(ORDER_SIDES)).min(1).default(["buy", "sell"]),
    allowedOrderTypes: z.array(z.enum(ORDER_TYPES)).min(1).default(["market", "limit"]),
    /** Orders above this many shares or units are refused outright. */
    maxOrderQty: z.coerce.number().positive().max(1_000_000_000).default(500),
    /** Orders whose notional is strictly below this run on their own. 0 means nothing runs without a person. */
    autoApproveNotionalBelow: z.coerce.number().min(0).max(1_000_000_000).default(5000),
    /** Notional from the automatic limit up to and including this needs approval. Above is refused. */
    approvalNotionalUpTo: z.coerce.number().min(0).max(1_000_000_000).default(50_000),
    approverRoles: z.array(z.string().trim().min(1).max(64)).max(10).default(["approver"]),
    minApprovers: z.coerce.number().int().min(1).max(3).default(1),
    /** Markets move; approvals expire quickly by default. */
    approvalExpiresMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60).default(30),
    separationOfDuties: z.boolean().default(true),
    /** Refuse a second order carrying the same reference in 30 days. */
    blockDuplicates: z.boolean().default(true),
    /** Refuse orders without a stated reason (params.reason). */
    requireReason: z.boolean().default(true),
    marketHoursOnly: z
      .object({
        enabled: z.boolean().default(true),
        /** US regular session is 13:30 to 20:00 UTC in summer and 14:30 to 21:00 UTC in winter; the window is to the hour. */
        startHourUtc: hourSchema.default(14),
        endHourUtc: hourSchema.default(20),
        handling: z.enum(["deny", "require_approval"]).default("require_approval"),
      })
      .default({ enabled: true, startHourUtc: 14, endHourUtc: 20, handling: "require_approval" }),
    /** Refuse new orders once the day's realised and unrealised loss reaches this amount (context.dayPnl as reported by the agent, see docs). 0 disables. */
    maxDailyLoss: z.coerce.number().min(0).max(1_000_000_000).default(0),
    /** Refuse once the agent has sent this many requests in 24 hours. 0 disables. */
    maxDailyOrders: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .superRefine((s, ctx) => {
    if (s.approvalNotionalUpTo < s.autoApproveNotionalBelow) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalNotionalUpTo"], message: "The approval ceiling must be at least the automatic limit" });
    }
    if (s.marketHoursOnly.enabled && s.marketHoursOnly.startHourUtc === s.marketHoursOnly.endHourUtc) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["marketHoursOnly", "endHourUtc"], message: "Market hours must cover at least one hour" });
    }
  });

export type TradingTemplateSettings = z.infer<typeof tradingTemplateSchema>;
export type TradingTemplateInput = z.input<typeof tradingTemplateSchema>;

export function defaultTradingSettings(): TradingTemplateSettings {
  return tradingTemplateSchema.parse({});
}

export function formatNotional(amount: number, currency: string): string {
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);
  return `${currency} ${n}`;
}

function pad(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function describeWindow(s: TradingTemplateSettings): string {
  return `${pad(s.marketHoursOnly.startHourUtc)} to ${pad(s.marketHoursOnly.endHourUtc)} UTC`;
}

function roleLabel(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function describeApprovers(s: TradingTemplateSettings): string {
  const who = s.approverRoles.length ? s.approverRoles.map(roleLabel).join(" or ") : "anyone who can decide approvals";
  return s.minApprovers === 1 ? `one ${who}` : `${s.minApprovers} approvers (${who})`;
}

function describeDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

function withinHours(start: number, end: number): Condition {
  if (start < end) return { attr: "context.hour", op: "between", value: [start, end - 1] };
  // Window wraps midnight.
  return { any: [{ attr: "context.hour", op: "gte", value: start }, { attr: "context.hour", op: "lt", value: end }] };
}

/** An hour inside the window, for samples. */
export function marketHourSample(s: TradingTemplateSettings): number {
  return s.marketHoursOnly.startHourUtc;
}
/** An hour outside the window, for samples. */
export function outsideHoursSample(s: TradingTemplateSettings): number {
  const { startHourUtc: a, endHourUtc: b } = s.marketHoursOnly;
  for (let h = 0; h < 24; h++) {
    const inside = a < b ? h >= a && h < b : h >= a || h < b;
    if (!inside) return h;
  }
  return 0;
}

const INSTRUCTIONS_MAX = 500;

/** Plain-language lines mirroring the generated rules exactly. */
export function explainTradingPolicy(input: TradingTemplateInput | TradingTemplateSettings): string[] {
  const s = tradingTemplateSchema.parse(input);
  const fmt = (n: number) => formatNotional(n, s.currency);
  const lines: string[] = [];
  lines.push(`Applies to ${s.tools.join(", ")}.`);
  lines.push(`Only ${s.instruments.length === 1 ? s.instruments[0] : s.instruments.join(", ")} may be traded; any other symbol is refused and recorded as a security event.`);
  lines.push(`${s.allowedSides.map((x) => x.toUpperCase()).join(" and ")} orders are allowed, as ${s.allowedOrderTypes.join(" or ")} orders; anything else is refused.`);
  lines.push(`Orders above ${new Intl.NumberFormat("en-US").format(s.maxOrderQty)} units are refused.`);
  lines.push(s.autoApproveNotionalBelow > 0 ? `Orders below ${fmt(s.autoApproveNotionalBelow)} run automatically.` : "No order runs without a person: the automatic limit is zero.");
  lines.push(`Orders from ${fmt(s.autoApproveNotionalBelow)} to ${fmt(s.approvalNotionalUpTo)} need ${describeApprovers(s)} within ${describeDuration(s.approvalExpiresMinutes)}.`);
  lines.push(`Orders above ${fmt(s.approvalNotionalUpTo)} are refused outright.`);
  if (s.marketHoursOnly.enabled) lines.push(s.marketHoursOnly.handling === "deny" ? `Outside ${describeWindow(s)} every order is refused.` : `Outside ${describeWindow(s)} every order needs a person.`);
  if (s.blockDuplicates) lines.push("A second order with the same reference in 30 days is refused.");
  if (s.requireReason) lines.push("Every order must state a reason.");
  if (s.maxDailyLoss > 0) lines.push(`Once the day's loss reported with the request reaches ${fmt(s.maxDailyLoss)}, every further order is refused.`);
  if (s.maxDailyOrders > 0) lines.push(`After ${s.maxDailyOrders} requests in 24 hours, further orders are refused.`);
  if (s.separationOfDuties) lines.push("The agent's owners and the person who asked for the order cannot approve it.");
  return lines;
}

export function buildTradingPolicyDocument(input: TradingTemplateInput | TradingTemplateSettings): PolicyDocument {
  const s = tradingTemplateSchema.parse(input);
  const fmt = (n: number) => formatNotional(n, s.currency);
  const approvers = s.approverRoles.length ? s.approverRoles.map(roleLabel).join(" or ") : "anyone with approvals:decide";
  const approval = (instructions: string): NonNullable<Rule["approval"]> => ({
    roles: s.approverRoles,
    minApprovers: s.minApprovers,
    expiresInMinutes: s.approvalExpiresMinutes,
    separationOfDuties: s.separationOfDuties,
    escalateToRoles: [],
    instructions: instructions.slice(0, INSTRUCTIONS_MAX),
  });
  const rules: Rule[] = [];

  rules.push({
    id: "invalid-order",
    description: "Quantity and notional must be positive numbers",
    effect: "deny",
    when: { any: [{ attr: "params.qty", op: "missing" }, { attr: "params.qty", op: "lte", value: 0 }, { attr: "params.notional", op: "missing" }, { attr: "params.notional", op: "lte", value: 0 }] },
    reason: "Order quantity or notional is missing or not positive",
    riskIndicators: ["invalid_request"],
  });
  rules.push({
    id: "instrument-not-allowed",
    description: `Only ${s.instruments.join(", ")} may be traded`,
    effect: "deny",
    when: { attr: "params.symbol", op: "not_in", value: s.instruments },
    reason: "The instrument is not on the allowed list",
    riskIndicators: ["instrument_not_allowed"],
    securityEventSeverity: "medium",
  });
  rules.push({
    id: "side-not-allowed",
    description: `Only ${s.allowedSides.join(" and ")} orders are allowed`,
    effect: "deny",
    when: { attr: "params.side", op: "not_in", value: s.allowedSides },
    reason: `Only ${s.allowedSides.join(" and ")} orders are permitted`,
    riskIndicators: ["side_not_allowed"],
  });
  rules.push({
    id: "order-type-not-allowed",
    description: `Only ${s.allowedOrderTypes.join(" and ")} orders are allowed`,
    effect: "deny",
    when: { attr: "params.type", op: "not_in", value: s.allowedOrderTypes },
    reason: `Only ${s.allowedOrderTypes.join(" and ")} orders are permitted`,
    riskIndicators: ["order_type_not_allowed"],
  });
  if (s.requireReason) {
    rules.push({
      id: "missing-reason",
      description: "Every order must state a reason",
      effect: "deny",
      when: { any: [{ attr: "params.reason", op: "missing" }, { attr: "params.reason", op: "matches", value: "^\\s*$" }] },
      reason: "An order reason is required",
      riskIndicators: ["missing_reason"],
    });
  }
  if (s.blockDuplicates) {
    rules.push({
      id: "duplicate-order",
      description: "An order with the same reference was already placed or is awaiting a decision",
      effect: "deny",
      when: { attr: "context.priorRequestsSameReference", op: "gt", value: 0 },
      reason: "An order with this reference already exists",
      riskIndicators: ["duplicate_order"],
      securityEventSeverity: "low",
    });
  }
  if (s.maxDailyLoss > 0) {
    rules.push({
      id: "daily-loss-cap",
      description: `Stop once the day's reported loss reaches ${fmt(s.maxDailyLoss)}`,
      effect: "deny",
      when: { attr: "context.supplied.dayPnl", op: "lte", value: -s.maxDailyLoss },
      reason: `The day's reported loss has reached ${fmt(s.maxDailyLoss)}`,
      riskIndicators: ["daily_loss_cap"],
      securityEventSeverity: "high",
    });
  }
  if (s.maxDailyOrders > 0) {
    rules.push({
      id: "too-many-orders",
      description: `Stop after ${s.maxDailyOrders} requests in 24 hours`,
      effect: "deny",
      when: { attr: "context.requestCount24h", op: "gte", value: s.maxDailyOrders },
      reason: `The agent has sent ${s.maxDailyOrders} or more requests in the last 24 hours`,
      riskIndicators: ["order_rate_cap"],
      securityEventSeverity: "medium",
    });
  }
  rules.push({
    id: "oversize-order",
    description: `Orders above ${new Intl.NumberFormat("en-US").format(s.maxOrderQty)} units are refused`,
    effect: "deny",
    when: { attr: "params.qty", op: "gt", value: s.maxOrderQty },
    reason: `Order quantity exceeds the per-order cap of ${new Intl.NumberFormat("en-US").format(s.maxOrderQty)}`,
    riskIndicators: ["oversize_order"],
    securityEventSeverity: "medium",
  });
  rules.push({
    id: "autonomous-band",
    description: s.autoApproveNotionalBelow > 0 ? `Orders below ${fmt(s.autoApproveNotionalBelow)} run without a person` : "No autonomous band: the limit is set to zero",
    effect: "allow",
    when: { all: [{ attr: "params.notional", op: "gt", value: 0 }, { attr: "params.notional", op: "lt", value: s.autoApproveNotionalBelow }] },
    reason: `Within the automatic order limit of ${fmt(s.autoApproveNotionalBelow)}`,
    riskIndicators: [],
  });
  rules.push({
    id: "approval-band",
    description: `Orders from ${fmt(s.autoApproveNotionalBelow)} to ${fmt(s.approvalNotionalUpTo)} need ${approvers}`,
    effect: "require_approval",
    when: { attr: "params.notional", op: "between", value: [s.autoApproveNotionalBelow, s.approvalNotionalUpTo] },
    approval: approval(`Order between ${fmt(s.autoApproveNotionalBelow)} and ${fmt(s.approvalNotionalUpTo)}. Check the instrument, side and size against the mandate, the stated reason, and the account's open exposure in the broker before approving. The approval expires in ${describeDuration(s.approvalExpiresMinutes)}; a stale order needs a new request.`),
    reason: `Orders from ${fmt(s.autoApproveNotionalBelow)} to ${fmt(s.approvalNotionalUpTo)} need approval`,
    riskIndicators: ["elevated_notional"],
  });
  if (s.marketHoursOnly.enabled) {
    const deny = s.marketHoursOnly.handling === "deny";
    rules.push({
      id: "outside-market-hours",
      description: deny ? `Outside ${describeWindow(s)} every order is refused` : `Outside ${describeWindow(s)} every order needs a person`,
      effect: deny ? "deny" : "require_approval",
      when: { not: withinHours(s.marketHoursOnly.startHourUtc, s.marketHoursOnly.endHourUtc) },
      ...(deny ? {} : { approval: approval(`This order was requested outside market hours (${describeWindow(s)}). Confirm it is intended for the next session before approving.`) }),
      reason: deny ? `Orders outside market hours (${describeWindow(s)}) are refused` : `Orders outside market hours (${describeWindow(s)}) need approval`,
      riskIndicators: ["outside_market_hours"],
    });
  }
  rules.push({
    id: "above-ceiling",
    description: `Orders above ${fmt(s.approvalNotionalUpTo)} are outside the agent's authority`,
    effect: "deny",
    when: { attr: "params.notional", op: "gt", value: s.approvalNotionalUpTo },
    reason: `Orders above ${fmt(s.approvalNotionalUpTo)} are refused`,
    riskIndicators: ["authority_exceeded"],
    securityEventSeverity: "medium",
  });

  const tests = tradingSampleRequests(s).map((sample) => ({ name: sample.name, input: tradingSampleToEvaluationInput(sample), expect: sample.expected }));
  return parsePolicyDocument({ version: 1, appliesTo: { tools: s.tools, actions: [], environments: [] }, rules, tests, meta: { template: { id: TRADING_TEMPLATE_ID, settings: s } } });
}

export function extractTradingSettings(document: unknown): TradingTemplateSettings | null {
  if (!document || typeof document !== "object") return null;
  const meta = (document as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const template = (meta as { template?: unknown }).template;
  if (!template || typeof template !== "object") return null;
  const { id, settings } = template as { id?: unknown; settings?: unknown };
  if (id !== TRADING_TEMPLATE_ID) return null;
  const parsed = tradingTemplateSchema.safeParse(settings);
  return parsed.success ? parsed.data : null;
}

export function tradingDocumentMatchesSettings(document: unknown): boolean {
  const settings = extractTradingSettings(document);
  if (!settings) return false;
  const generated = buildTradingPolicyDocument(settings);
  const parsed = parsePolicyDocument(document);
  return JSON.stringify(parsed.rules) === JSON.stringify(generated.rules) && JSON.stringify(parsed.appliesTo) === JSON.stringify(generated.appliesTo);
}

export type TradingSampleId = "small" | "mid" | "large" | "wrong_instrument" | "wrong_side" | "oversize" | "duplicate" | "missing_reason" | "outside_hours" | "daily_loss";

export interface TradingSampleRequest {
  id: TradingSampleId;
  name: string;
  description: string;
  tool: string;
  params: Record<string, unknown>;
  hour: number;
  priorRequestsSameReference: number;
  requestCount24h: number;
  dayPnl: number | null;
  expected: Effect;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Representative notionals for each band, derived from the thresholds. */
export function tradingSampleNotionals(s: TradingTemplateSettings): { small: number; mid: number; large: number } {
  const lo = s.autoApproveNotionalBelow;
  const hi = s.approvalNotionalUpTo;
  const small = lo > 0 ? round2(Math.max(0.01, lo / 2)) : 0;
  const mid = hi > lo ? round2(lo + (hi - lo) / 2) : hi;
  const large = round2(hi > 0 ? hi * 2 : 1000);
  return { small, mid, large };
}

/** A price that makes qty times price equal the notional, with a round quantity. */
function orderFor(notional: number, maxQty: number): { qty: number; limitPrice: number } {
  const qty = Math.max(1, Math.min(Math.floor(maxQty), 10));
  return { qty, limitPrice: round2(notional / qty) };
}

export function tradingSampleRequests(input: TradingTemplateInput | TradingTemplateSettings): TradingSampleRequest[] {
  const s = tradingTemplateSchema.parse(input);
  const fmt = (n: number) => formatNotional(n, s.currency);
  const tool = s.tools[0]!;
  const symbol = s.instruments[0]!;
  const side = s.allowedSides[0]!;
  const type = s.allowedOrderTypes.includes("limit") ? "limit" : s.allowedOrderTypes[0]!;
  const { small, mid, large } = tradingSampleNotionals(s);
  const hour = s.marketHoursOnly.enabled ? marketHourSample(s) : 15;
  const base = (notional: number, extra: Record<string, unknown> = {}) => {
    const o = orderFor(notional, s.maxOrderQty);
    const limitPrice = type === "limit" ? { limitPrice: o.limitPrice } : {};
    return { symbol, side, type, qty: o.qty, notional, ...limitPrice, reference: "SIG-2041", reason: "Rebalance toward target weight", ...extra };
  };
  const common = { hour, priorRequestsSameReference: 0, requestCount24h: 1, dayPnl: null as number | null };
  const out: TradingSampleRequest[] = [];
  if (s.autoApproveNotionalBelow > 0) {
    out.push({ id: "small", name: `Order of ${fmt(small)} runs automatically`, description: "Below the automatic limit, an allowed instrument, inside market hours, with a reason.", tool, params: base(small), ...common, expected: "allow" });
  } else {
    out.push({ id: "small", name: `Order of ${fmt(1)} needs approval`, description: "The automatic limit is zero, so even a small order needs a person.", tool, params: base(1), ...common, expected: s.approvalNotionalUpTo >= 1 ? "require_approval" : "deny" });
  }
  if (s.approvalNotionalUpTo > 0 && (s.approvalNotionalUpTo > s.autoApproveNotionalBelow || s.autoApproveNotionalBelow > 0)) {
    out.push({ id: "mid", name: `Order of ${fmt(mid)} needs approval`, description: "Inside the approval band.", tool, params: base(mid), ...common, expected: "require_approval" });
  }
  out.push({ id: "large", name: `Order of ${fmt(large)} is refused`, description: "Above the approval ceiling.", tool, params: base(large), ...common, expected: "deny" });
  const okNotional = small > 0 ? small : mid > 0 ? mid : 1;
  const guarded = (effect: Effect): Effect => (okNotional <= 0 || okNotional > s.approvalNotionalUpTo ? "deny" : effect);
  const foreign = ["ZZZZ", "XXXX", "QQQQ"].find((x) => !s.instruments.includes(x)) ?? "ZZZZ";
  out.push({ id: "wrong_instrument", name: `Order in ${foreign} is refused`, description: "The symbol is not on the allowed list, whatever the size.", tool, params: base(okNotional, { symbol: foreign }), ...common, expected: "deny" });
  const otherSide = ORDER_SIDES.find((x) => !s.allowedSides.includes(x));
  if (otherSide) {
    out.push({ id: "wrong_side", name: `${otherSide.toUpperCase()} order is refused`, description: `Only ${s.allowedSides.join(" and ")} orders are allowed.`, tool, params: base(okNotional, { side: otherSide }), ...common, expected: "deny" });
  }
  out.push({ id: "oversize", name: `Order of ${new Intl.NumberFormat("en-US").format(s.maxOrderQty + 1)} units is refused`, description: "Above the per-order quantity cap, even at a small notional.", tool, params: base(okNotional, { qty: s.maxOrderQty + 1, limitPrice: type === "limit" ? round2(okNotional / (s.maxOrderQty + 1)) : undefined }), ...common, expected: "deny" });
  if (s.blockDuplicates) {
    out.push({ id: "duplicate", name: "Second order with the same reference is refused", description: "An earlier order with this reference exists in the last 30 days.", tool, params: base(okNotional), ...common, priorRequestsSameReference: 1, expected: guarded("deny") });
  }
  if (s.requireReason) {
    const { reason: _omitted, ...withoutReason } = base(okNotional);
    out.push({ id: "missing_reason", name: "Order without a reason is refused", description: "params.reason is missing.", tool, params: withoutReason, ...common, expected: "deny" });
  }
  if (s.marketHoursOnly.enabled) {
    const h = outsideHoursSample(s);
    const deny = s.marketHoursOnly.handling === "deny";
    out.push({ id: "outside_hours", name: deny ? `Order at ${pad(h)} UTC is refused` : `Order at ${pad(h)} UTC needs approval`, description: `Outside ${describeWindow(s)}.`, tool, params: base(okNotional), ...common, hour: h, expected: guarded(deny ? "deny" : "require_approval") });
  }
  if (s.maxDailyLoss > 0) {
    out.push({ id: "daily_loss", name: `Order after a ${fmt(s.maxDailyLoss)} day loss is refused`, description: "context.dayPnl reported with the request has reached the cap.", tool, params: base(okNotional), ...common, dayPnl: -s.maxDailyLoss, expected: "deny" });
  }
  return out;
}

/** The authorization-input fragment the evaluator (and embedded tests) see for a sample. */
export function tradingSampleToEvaluationInput(sample: TradingSampleRequest): Record<string, unknown> {
  return {
    action: { tool: sample.tool, name: "execute" },
    params: sample.params,
    context: { hour: sample.hour, priorRequestsSameReference: sample.priorRequestsSameReference, duplicateReferenceKey: sample.priorRequestsSameReference > 0 ? "reference" : null, requestCount24h: sample.requestCount24h, deniedCount24h: 0, supplied: sample.dayPnl === null ? {} : { dayPnl: sample.dayPnl } },
  };
}
