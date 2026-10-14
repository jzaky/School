/**
 * Plans and entitlements (docs/COMMERCIAL_READINESS.md). Three paid plans follow the product structure: Core
 * (govern and control agent actions), Secure (adds AI security controls) and Enterprise (adds deployment
 * choice and enterprise contract terms), plus a time-limited trial.
 *
 * Prices are deliberately absent: there has been no pricing analysis, so every plan is priced by quote
 * and the amount lives in the customer's contract. Limits are illustrative defaults that a contract can
 * override. Features list their real build status; a planned feature is never presented as included.
 */

export const PLAN_KEYS = ["trial", "core", "secure", "enterprise"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface PlanLimits {
  /** Registered agents that are not archived. null means set by contract. */
  agents: number | null;
  members: number | null;
  /** Gateway decisions per calendar month. */
  monthlyDecisions: number | null;
}

export interface Plan {
  key: PlanKey;
  name: string;
  summary: string;
  limits: PlanLimits;
  trialDays?: number;
}

export const PLANS: Record<PlanKey, Plan> = {
  trial: { key: "trial", name: "Trial", summary: "Every available feature for a limited period, for a pilot with synthetic or test data.", limits: { agents: 10, members: 15, monthlyDecisions: 10_000 }, trialDays: 30 },
  core: { key: "core", name: "Core", summary: "Agent registry, policy engine and Action Gateway, approvals, managed autonomy, uncertainty and reasoning governance, evidence ledger and audit.", limits: { agents: 25, members: 50, monthlyDecisions: 250_000 } },
  secure: { key: "secure", name: "Secure", summary: "Core plus the AI security controls: data protection, tool security, injection defence, incidents and the Attack Simulation Lab.", limits: { agents: 100, members: 200, monthlyDecisions: 2_000_000 } },
  enterprise: { key: "enterprise", name: "Enterprise", summary: "Secure plus single sign-on and SCIM, single-tenant, private-cloud or on-premises deployment, and contract terms agreed with the customer.", limits: { agents: null, members: null, monthlyDecisions: null } },
};

export type FeatureStatus = "available" | "planned";

export interface Feature {
  key: string;
  name: string;
  plans: PlanKey[];
  status: FeatureStatus;
}

const ALL: PlanKey[] = ["trial", "core", "secure", "enterprise"];
const SECURE_UP: PlanKey[] = ["trial", "secure", "enterprise"];
const ENTERPRISE: PlanKey[] = ["trial", "enterprise"];

export const FEATURES: Feature[] = [
  { key: "gateway", name: "Action Gateway with allow, restrict, approval, more information, quarantine and deny", plans: ALL, status: "available" },
  { key: "policies", name: "Policy engine with replay, conflicts, exceptions and templates", plans: ALL, status: "available" },
  { key: "approvals", name: "Approvals bound to exact parameters", plans: ALL, status: "available" },
  { key: "autonomy", name: "Managed autonomy levels", plans: ALL, status: "available" },
  { key: "uncertainty", name: "Uncertainty and reasoning governance", plans: ALL, status: "available" },
  { key: "evidence", name: "Signed evidence ledger and exports", plans: ALL, status: "available" },
  { key: "audit", name: "Audit workspace and framework catalogs", plans: ALL, status: "available" },
  { key: "integrations", name: "Integration marketplace and event destinations", plans: ALL, status: "available" },
  { key: "shield", name: "Data protection, tool security and injection defence", plans: SECURE_UP, status: "available" },
  { key: "lab", name: "Attack Simulation Lab", plans: SECURE_UP, status: "available" },
  { key: "ai_gateway_dlp", name: "AI model gateway with data loss prevention for people's prompts", plans: SECURE_UP, status: "available" },
  { key: "shadow_ai", name: "Shadow AI and shadow IT discovery", plans: SECURE_UP, status: "planned" },
  { key: "sso", name: "Single sign-on (OIDC, SAML) and SCIM", plans: ENTERPRISE, status: "available" },
  { key: "deployment_choice", name: "Single-tenant, private-cloud or on-premises deployment", plans: ENTERPRISE, status: "available" },
];

/** Older organizations carry the plan key used before plans existed. */
export function normalizePlan(raw: string | null | undefined): PlanKey {
  if (raw === "enterprise_trial" || !raw) return "trial";
  return (PLAN_KEYS as readonly string[]).includes(raw) ? (raw as PlanKey) : "trial";
}

export function featuresFor(plan: PlanKey) {
  return FEATURES.map((f) => ({ ...f, included: f.plans.includes(plan) }));
}

/** True when the plan includes a built feature. A planned feature is never included. */
export function planIncludes(plan: PlanKey, featureKey: string): boolean {
  const f = FEATURES.find((x) => x.key === featureKey);
  return !!f && f.status === "available" && f.plans.includes(plan);
}

export type TrialState = { state: "not_trial" } | { state: "active"; daysLeft: number; endsAt: Date } | { state: "ending_soon"; daysLeft: number; endsAt: Date } | { state: "ended"; endedAt: Date } | { state: "no_end_date" };

export function trialState(plan: PlanKey, trialEndsAt: Date | null, now = new Date()): TrialState {
  if (plan !== "trial") return { state: "not_trial" };
  if (!trialEndsAt) return { state: "no_end_date" };
  const ms = trialEndsAt.getTime() - now.getTime();
  if (ms <= 0) return { state: "ended", endedAt: trialEndsAt };
  const daysLeft = Math.ceil(ms / 86_400_000);
  return daysLeft <= 7 ? { state: "ending_soon", daysLeft, endsAt: trialEndsAt } : { state: "active", daysLeft, endsAt: trialEndsAt };
}

export interface UsageLine {
  metric: "agents" | "members" | "monthlyDecisions";
  label: string;
  used: number;
  limit: number | null;
  status: "ok" | "near" | "over" | "unlimited";
}

const METRIC_LABEL: Record<UsageLine["metric"], string> = { agents: "Registered agents", members: "Active members", monthlyDecisions: "Gateway decisions this month" };

/** Usage against limits. Limits are reported, not enforced: nothing is blocked when a limit is passed. */
export function usageAgainstLimits(limits: PlanLimits, used: { agents: number; members: number; monthlyDecisions: number }): UsageLine[] {
  return (Object.keys(METRIC_LABEL) as UsageLine["metric"][]).map((metric) => {
    const limit = limits[metric];
    const u = used[metric];
    const status: UsageLine["status"] = limit === null ? "unlimited" : u > limit ? "over" : u >= limit * 0.8 ? "near" : "ok";
    return { metric, label: METRIC_LABEL[metric], used: u, limit, status };
  });
}

/** A contract may override any plan limit; anything it leaves out keeps the plan default. */
export function effectiveLimits(plan: PlanKey, overrides: Partial<PlanLimits> | null | undefined): PlanLimits {
  const base = PLANS[plan].limits;
  return { agents: overrides?.agents !== undefined ? overrides.agents : base.agents, members: overrides?.members !== undefined ? overrides.members : base.members, monthlyDecisions: overrides?.monthlyDecisions !== undefined ? overrides.monthlyDecisions : base.monthlyDecisions };
}
