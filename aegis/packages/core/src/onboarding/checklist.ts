import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { hasPermission } from "../identity/permissions.js";

/**
 * Guided onboarding for a pilot. Every step is derived from data that already exists in the tenant,
 * never from stored flags, so the checklist stays truthful when records change.
 */
export const ONBOARDING_STEP_KEYS = ["explore", "connect", "agent", "policy", "approver", "verify", "evidence"] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  description: string;
  done: boolean;
  href: string;
  /** Plain-language instruction for the person doing the step. */
  hint: string;
}

const STEP_COPY: Record<OnboardingStepKey, Omit<OnboardingStep, "done" | "key">> = {
  explore: {
    title: "Explore a sample workflow",
    description: "Run the refund scenario end to end: an AI support agent asks to refund customers, policy decides, a person approves the larger one.",
    href: "/gateway/demos",
    hint: "Open Demo scenarios and run \"Refunds\". It uses simulated systems, so no external credentials are needed.",
  },
  connect: {
    title: "Connect a sandbox system",
    description: "Add an integration in sandbox mode with a live credential and a passing health check, so real (test) calls flow through the gateway.",
    href: "/integrations",
    hint: "Create an integration of kind \"sandbox\" (for example Stripe test mode), store its credential and run the health check until it passes.",
  },
  agent: {
    title: "Register an agent and assign its owner",
    description: "Every agent needs an accountable business or technical owner before it can act. Owners cannot approve their own agent's requests.",
    href: "/agents",
    hint: "Register the agent, set a business owner or technical owner, and activate it.",
  },
  policy: {
    title: "Choose and customise a policy template",
    description: "A policy decides which actions run on their own, which need a person, and which are blocked. Assign an active version to the agent.",
    href: "/policies",
    hint: "Start from the refund template, adjust the thresholds, activate the version and assign it to the agent.",
  },
  approver: {
    title: "Assign an approver",
    description: "At least one active member, other than the agent owners, must hold the permission to decide approvals.",
    href: "/org/users",
    hint: "Invite a colleague or change a member's role to Approver. Separation of duties means agent owners do not count.",
  },
  verify: {
    title: "Run verification scenarios",
    description: "Prove the three outcomes in the last 30 days: an action executed, an action denied and an approval decided by a person.",
    href: "/gateway/demos",
    hint: "Run the scenarios, then decide the pending approval in the Approval Center. All three outcomes must be recent.",
  },
  evidence: {
    title: "Review and export the evidence",
    description: "Export the tamper-evident ledger once, so you know what an auditor will receive and how to re-verify it offline.",
    href: "/evidence",
    hint: "Open the Evidence Ledger, verify the chain and use Export. The export itself is recorded as evidence.",
  },
};

const THIRTY_DAYS = 30 * 86400_000;

/** Computes the seven onboarding steps for the current tenant. Read-only. */
export async function computeOnboarding(db: TenantDb, ctx: OrgContext): Promise<OnboardingStep[]> {
  const orgId = ctx.orgId;
  const since = new Date((ctx.now ?? new Date()).getTime() - THIRTY_DAYS);
  const [demoEvent, demoRequest, sandbox, ownedAgent, assignedPolicy, memberships, agents, executed, denied, decided, exported] = await Promise.all([
    db.evidenceEvent.findFirst({ where: { orgId, type: { startsWith: "demo." } }, select: { id: true } }),
    db.actionRequest.findFirst({ where: { orgId, correlationId: { startsWith: "demo-" } }, select: { id: true } }),
    db.integration.findFirst({ where: { orgId, status: "active", lastHealthOk: true, settings: { path: ["kind"], equals: "sandbox" }, credentials: { some: { revokedAt: null } } }, select: { id: true } }),
    db.agent.findFirst({ where: { orgId, status: "active", OR: [{ businessOwnerId: { not: null } }, { technicalOwnerId: { not: null } }] }, select: { id: true } }),
    db.policyAssignment.findFirst({ where: { orgId, targetType: "agent", policy: { archived: false, versions: { some: { state: "active" } } } }, select: { id: true } }),
    db.membership.findMany({ where: { orgId, status: "active" }, select: { userId: true, role: { select: { permissions: true } } } }),
    db.agent.findMany({ where: { isLab: false, orgId, status: { not: "archived" } }, select: { businessOwnerId: true, technicalOwnerId: true } }),
    db.actionRequest.findFirst({ where: { orgId, status: "executed", createdAt: { gte: since } }, select: { id: true } }),
    db.actionRequest.findFirst({ where: { orgId, status: "denied", createdAt: { gte: since } }, select: { id: true } }),
    db.approvalRequest.findFirst({ where: { orgId, status: { in: ["approved", "rejected"] }, decidedAt: { gte: since } }, select: { id: true } }),
    db.evidenceEvent.findFirst({ where: { orgId, type: "evidence.exported" }, select: { id: true } }),
  ]);
  const owners = new Set(agents.flatMap((a) => [a.businessOwnerId, a.technicalOwnerId]).filter((x): x is string => !!x));
  const approverExists = memberships.some((m) => hasPermission(m.role.permissions, "approvals:decide") && !owners.has(m.userId));
  const done: Record<OnboardingStepKey, boolean> = {
    explore: !!(demoEvent || demoRequest),
    connect: !!sandbox,
    agent: !!ownedAgent,
    policy: !!assignedPolicy,
    approver: approverExists,
    verify: !!(executed && denied && decided),
    evidence: !!exported,
  };
  return ONBOARDING_STEP_KEYS.map((key) => ({ key, ...STEP_COPY[key], done: done[key] }));
}

export interface OnboardingSummary {
  done: number;
  total: number;
  complete: boolean;
  /** ISO timestamp when an administrator dismissed the checklist, or null. */
  dismissedAt: string | null;
  /** The first step that is not done, or null when everything is complete. */
  next: OnboardingStep | null;
}

/** Progress plus the per-organization dismissal flag stored in settings.onboardingDismissedAt. */
export function summarizeOnboarding(steps: OnboardingStep[], settings: Record<string, unknown> | null | undefined): OnboardingSummary {
  const done = steps.filter((s) => s.done).length;
  const dismissedAt = typeof settings?.onboardingDismissedAt === "string" ? (settings.onboardingDismissedAt as string) : null;
  return { done, total: steps.length, complete: done === steps.length, dismissedAt, next: steps.find((s) => !s.done) ?? null };
}

/**
 * Enterprise rollout (docs/COMMERCIAL_READINESS.md): the path from a new customer organization to its first audit
 * report. Like the pilot checklist, every step is derived from records, never from stored flags.
 */
export interface RolloutStep {
  key: "organization" | "administrator" | "sso" | "agent" | "integration" | "policy" | "protected_action" | "audit_report";
  title: string;
  done: boolean;
  href: string;
}

export async function enterpriseRollout(db: TenantDb, ctx: OrgContext): Promise<RolloutStep[]> {
  const orgId = ctx.orgId;
  const [owners, sso, agents, integrations, policies, decisions, reports] = await Promise.all([
    db.membership.count({ where: { orgId, status: "active", role: { key: "owner" } } }),
    db.ssoConnection.count({ where: { orgId, enabled: true } }),
    db.agent.count({ where: { orgId, isLab: false, status: "active" } }),
    db.integration.count({ where: { orgId, status: "active" } }),
    db.policy.count({ where: { orgId, currentVersionId: { not: null } } }),
    db.authorizationDecision.count({ where: { orgId, request: { agent: { isLab: false } } }, take: 1 }),
    db.evidenceEvent.count({ where: { orgId, type: "report.generated" }, take: 1 }),
  ]);
  return [
    { key: "organization", title: "Organization created", done: true, href: "/org/settings" },
    { key: "administrator", title: "First administrator signed in", done: owners > 0, href: "/org/users" },
    { key: "sso", title: "Single sign-on configured", done: sso > 0, href: "/org/settings" },
    { key: "agent", title: "First agent registered and active", done: agents > 0, href: "/agents" },
    { key: "integration", title: "First integration connected", done: integrations > 0, href: "/integrations" },
    { key: "policy", title: "First policy active", done: policies > 0, href: "/policies" },
    { key: "protected_action", title: "First action decided by the gateway", done: decisions > 0, href: "/activity" },
    { key: "audit_report", title: "First audit or governance report", done: reports > 0, href: "/reports" },
  ];
}
