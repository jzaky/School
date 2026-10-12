import { formatMoney } from "./utils";

/** Business fields approvers care about, pulled from tool parameters when present. Client-safe. */
export interface KeyParams {
  amount: number | null;
  currency: string | null;
  destination: string | null;
  orderId: string | null;
  toAccount: string | null;
  customerId: string | null;
  reason: string | null;
  paymentIntentId: string | null;
}

export function keyParams(params: unknown): KeyParams {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const amount = typeof p.amount === "number" ? p.amount : typeof p.amount === "string" && p.amount.trim() !== "" && Number.isFinite(Number(p.amount)) ? Number(p.amount) : null;
  const str = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim() !== "" ? (p[k] as string) : null);
  return {
    amount,
    currency: str("currency"),
    destination: str("destination") ?? str("to") ?? str("url"),
    orderId: str("orderId"),
    toAccount: str("toAccount"),
    customerId: str("customerId") ?? str("customer"),
    reason: str("reason"),
    paymentIntentId: str("paymentIntentId") ?? str("chargeId"),
  };
}

const TOOL_VERBS: { match: RegExp; verb: string }[] = [
  { match: /refund/i, verb: "Refund" },
  { match: /transfer|payment|payout/i, verb: "Transfer" },
  { match: /export/i, verb: "Export" },
  { match: /email|send/i, verb: "Send" },
  { match: /delete|remove/i, verb: "Delete" },
  { match: /query|read|search|lookup|get/i, verb: "Read" },
  { match: /update|write|edit/i, verb: "Update" },
  { match: /create|open|issue/i, verb: "Create" },
];

/** A short noun for the kind of action, used in headings ("Requested refund"). */
export function actionNoun(toolKey: string): string {
  if (/refund/i.test(toolKey)) return "refund";
  if (/transfer|payment|payout/i.test(toolKey)) return "transfer";
  if (/export/i.test(toolKey)) return "data export";
  if (/email|send/i.test(toolKey)) return "message";
  return "action";
}

/**
 * Describes a request in plain words from its tool key and parameters:
 * "Refund AED 1,450.00 for order ORD-55377 to customer CUST-88213".
 */
export function describeRequest(toolKey: string, action: string, params: unknown, fallbackCurrency = "AED"): string {
  const kp = keyParams(params);
  const verb = TOOL_VERBS.find((t) => t.match.test(toolKey))?.verb ?? humanize(toolKey);
  const parts: string[] = [verb];
  if (kp.amount !== null) parts.push(formatMoney(kp.amount, kp.currency ?? fallbackCurrency));
  if (kp.orderId) parts.push(`for order ${kp.orderId}`);
  else if (kp.paymentIntentId) parts.push(`for payment ${kp.paymentIntentId}`);
  if (kp.customerId) parts.push(`to customer ${kp.customerId}`);
  else if (kp.toAccount) parts.push(`to account ${kp.toAccount}`);
  else if (kp.destination) parts.push(`to ${kp.destination}`);
  if (parts.length === 1) {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const extra = Object.entries(p)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .slice(0, 2)
      .map(([k, v]) => `${humanize(k).toLowerCase()} ${String(v)}`);
    return extra.length ? `${verb} (${action}): ${extra.join(", ")}` : `${verb} (${action})`;
  }
  return parts.join(" ");
}

function humanize(key: string): string {
  const words = key.replace(/[-_.]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type OutcomeGroup = "allowed" | "approved" | "blocked" | "unresolved";

export const OUTCOME_GROUPS: { id: OutcomeGroup; label: string; description: string }[] = [
  { id: "allowed", label: "Allowed and executed", description: "Policy allowed the action and it ran without a person" },
  { id: "approved", label: "Approval", description: "A person was asked: awaiting, approved or approved and executed" },
  { id: "blocked", label: "Blocked", description: "Denied by policy, rejected by a person or expired unused" },
  { id: "unresolved", label: "Failed or unresolved", description: "The downstream call failed, or its outcome is not confirmed yet" },
];

const EXECUTING_GRACE_MS = 5 * 60_000;

/** Groups a request outcome for lists. `hasApproval` separates autonomous actions from approved ones. */
export function outcomeGroup(status: string, hasApproval: boolean, createdAt?: string | Date | null, now = Date.now()): OutcomeGroup {
  switch (status) {
    case "denied":
    case "rejected":
    case "expired":
      return "blocked";
    case "failed":
    case "unknown":
    case "evaluating":
      return "unresolved";
    case "executing": {
      const t = createdAt ? new Date(createdAt).getTime() : now;
      if (now - t > EXECUTING_GRACE_MS) return "unresolved";
      return hasApproval ? "approved" : "allowed";
    }
    case "pending_approval":
    case "approved":
      return "approved";
    default:
      return hasApproval ? "approved" : "allowed";
  }
}

/** Short plain-language outcome for a row ("Approved and executed", "Awaiting approval"). */
export function outcomeLabel(status: string, hasApproval: boolean): string {
  switch (status) {
    case "executed":
      return hasApproval ? "Approved and executed" : "Allowed and executed";
    case "allowed":
      return "Allowed";
    case "executing":
      return hasApproval ? "Approved, executing" : "Executing";
    case "pending_approval":
      return "Awaiting approval";
    case "approved":
      return "Approved, not yet executed";
    case "denied":
      return "Denied by policy";
    case "rejected":
      return "Rejected by a person";
    case "expired":
      return "Expired unused";
    case "failed":
      return "Failed downstream";
    case "unknown":
      return "Outcome unresolved";
    case "evaluating":
      return "Evaluating";
    default:
      return status.replace(/_/g, " ");
  }
}
