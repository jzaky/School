/**
 * Continuous governance: the organization lets AEGIS act on monitoring alerts on its own, inside limits it
 * chose in advance, instead of only notifying a person.
 *
 * Mode "assisted" (default): alerts notify people; every containment action is a human decision.
 * Mode "continuous": each monitoring rule can carry an automatic response. When the worker raises an alert
 * for that rule, the response runs immediately with a system actor, is written to the evidence ledger and
 * notifies the administrators. Responses are deterministic and reversible: suspend the agent the alert
 * names, pause the Action Gateway, or disable the integration the alert names. Nothing here approves or
 * executes an action; automatic responses only ever reduce what agents may do.
 */
import { withTenant, type Prisma, type TenantDb } from "@aegis/db";
import { z } from "zod";
import { transitionAgent } from "../agents/registry.js";
import { appendEvidence } from "../evidence/ledger.js";
import { gatewayPausedState, pauseGateway } from "../gateway/gateway.js";
import { setIntegrationStatus } from "../integrations/service.js";
import { systemActor, systemContext, type OrgContext } from "../lib/context.js";
import { notifyUsers, userIdsWithPermission } from "../notify/notifications.js";
import { validation } from "../lib/errors.js";
import { assertPermission, getOrganization, updateOrganization } from "../orgs/orgs.js";

export const GOVERNANCE_MODES = ["assisted", "continuous"] as const;
export type GovernanceMode = (typeof GOVERNANCE_MODES)[number];

export const AUTO_RESPONSES = ["notify", "suspend_agent", "pause_gateway", "disable_integration"] as const;
export type AutoResponse = (typeof AUTO_RESPONSES)[number];

export const continuousGovernanceSchema = z.object({
  mode: z.enum(GOVERNANCE_MODES).default("assisted"),
  /** Monitoring rule key (RM-001 ...) to the response that runs when that rule raises an alert. */
  responses: z.record(z.string().regex(/^[A-Z]{2}-\d{3}$/), z.enum(AUTO_RESPONSES)).default({}),
});
export type ContinuousGovernance = z.infer<typeof continuousGovernanceSchema>;

/** Starting point offered when an organization switches to continuous mode. Every entry is editable. */
export const DEFAULT_AUTO_RESPONSES: Record<string, AutoResponse> = {
  "RM-001": "suspend_agent",
  "RM-002": "suspend_agent",
  "RM-004": "suspend_agent",
  "RM-005": "disable_integration",
  "RM-008": "suspend_agent",
  "RM-010": "pause_gateway",
};

/** Which responses make sense for a rule: only agent-scoped rules can suspend, only RM-005 names an integration. */
export function responseOptionsForRule(ruleKey: string): AutoResponse[] {
  const agentScoped = ["RM-001", "RM-002", "RM-003", "RM-004", "RM-008"];
  if (agentScoped.includes(ruleKey)) return ["notify", "suspend_agent", "pause_gateway"];
  if (ruleKey === "RM-005") return ["notify", "disable_integration", "pause_gateway"];
  return ["notify", "pause_gateway"];
}

export function describeAutoResponse(action: AutoResponse): string {
  switch (action) {
    case "notify":
      return "Notify people only";
    case "suspend_agent":
      return "Suspend the agent";
    case "pause_gateway":
      return "Pause the gateway";
    case "disable_integration":
      return "Disable the integration";
  }
}

export function readContinuousGovernance(settings: unknown): ContinuousGovernance {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).continuousGovernance : undefined;
  const parsed = continuousGovernanceSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { mode: "assisted", responses: {} };
}

/** Sets the mode and the per-rule responses. Needs org:admin; recorded in evidence. */
export async function setContinuousGovernance(ctx: OrgContext, input: unknown): Promise<ContinuousGovernance> {
  assertPermission(ctx, "org:admin");
  const data = continuousGovernanceSchema.parse(input);
  for (const [key, action] of Object.entries(data.responses)) {
    if (!responseOptionsForRule(key).includes(action)) throw validation(`${describeAutoResponse(action)} is not available for ${key}`);
  }
  const org = await getOrganization(ctx.orgId);
  const settings = { ...((org?.settings ?? {}) as Record<string, unknown>), continuousGovernance: data };
  await updateOrganization(ctx, { settings });
  await withTenant(ctx.orgId, (db) => appendEvidence(db, ctx, { type: "governance.mode_changed", subjectType: "organization", subjectId: ctx.orgId, payload: { mode: data.mode, responses: data.responses } }));
  return data;
}

export interface NewAlert {
  id: string;
  ruleKey: string;
  severity: string;
  title: string;
  agentId: string | null;
  detail: Record<string, unknown>;
}

export interface AppliedResponse {
  alertId: string;
  ruleKey: string;
  action: AutoResponse;
  target: string | null;
  outcome: "applied" | "skipped";
  note: string;
}

/**
 * Runs the configured response for each newly raised alert. Called by runMonitoring right after the alerts
 * are created, so every response is tied to exactly one alert (the alert's dedupe key already prevents the
 * same situation from being raised twice). The result is stored on the alert and in the evidence ledger.
 */
export async function applyAutoResponses(db: TenantDb, ctx: OrgContext, alerts: NewAlert[], now = new Date()): Promise<AppliedResponse[]> {
  if (alerts.length === 0) return [];
  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { settings: true } });
  const cfg = readContinuousGovernance(org?.settings);
  if (cfg.mode !== "continuous") return [];
  // The system actor carries every permission here: the organization delegated these specific responses in advance.
  const sys: OrgContext = { ...systemContext(ctx.orgId), now, actor: { ...systemActor, label: "AEGIS continuous governance", permissions: ["*"] } };
  const applied: AppliedResponse[] = [];
  for (const a of alerts) {
    const action = cfg.responses[a.ruleKey] ?? "notify";
    if (action === "notify" || a.detail.autoResponse) continue;
    const reason = `Automatic response to ${a.ruleKey}: ${a.title}`;
    let outcome: AppliedResponse["outcome"] = "skipped";
    let target: string | null = null;
    let note = "";
    try {
      if (action === "suspend_agent") {
        if (!a.agentId) note = "the alert names no agent";
        else {
          const agent = await db.agent.findUnique({ where: { id: a.agentId }, select: { status: true, name: true } });
          if (!agent) note = "agent not found";
          else if (agent.status !== "active") note = `agent already ${agent.status}`;
          else {
            await transitionAgent(db, sys, a.agentId, "suspended", reason);
            outcome = "applied";
            target = a.agentId;
            note = `${agent.name} suspended; its pending approvals cannot execute until a person resumes it`;
          }
        }
      } else if (action === "pause_gateway") {
        const state = await gatewayPausedState(db, ctx.orgId);
        if (state.paused) note = "gateway already paused";
        else {
          const r = await pauseGateway(db, sys, reason);
          outcome = "applied";
          target = "gateway";
          note = `gateway paused, ${r.voidedGrants} outstanding grant(s) voided; every new request is denied until a person resumes`;
        }
      } else if (action === "disable_integration") {
        const key = typeof a.detail.integration === "string" ? a.detail.integration : null;
        if (!key) note = "the alert names no integration";
        else {
          const integ = await db.integration.findFirst({ where: { orgId: ctx.orgId, key }, select: { id: true, status: true, name: true } });
          if (!integ) note = "integration not found";
          else if (integ.status !== "active") note = `integration already ${integ.status}`;
          else {
            await setIntegrationStatus(db, sys, integ.id, "disabled", reason);
            outcome = "applied";
            target = integ.id;
            note = `${integ.name} disabled; executions through it fail closed until a person re-enables it`;
          }
        }
      }
    } catch (e) {
      note = e instanceof Error ? e.message : "response failed";
    }
    const record = { action, outcome, target, note, at: now.toISOString() };
    await db.alert.update({ where: { id: a.id }, data: { detail: { ...a.detail, autoResponse: record } as Prisma.InputJsonValue } });
    await appendEvidence(db, sys, { type: "governance.auto_response", subjectType: "alert", subjectId: a.id, payload: { rule: a.ruleKey, severity: a.severity, alertTitle: a.title, ...record } });
    applied.push({ alertId: a.id, ruleKey: a.ruleKey, action, target, outcome, note });
  }
  if (applied.length) {
    const admins = await userIdsWithPermission(db, ctx, "org:admin");
    for (const r of applied) {
      await notifyUsers(db, ctx, { userIds: admins, type: "governance.auto_response", title: `${r.outcome === "applied" ? "Automatic response" : "Automatic response skipped"}: ${describeAutoResponse(r.action)} (${r.ruleKey})`, body: r.note, link: `/alerts?focus=${r.alertId}`, idempotencyKey: `auto_response:${r.alertId}` });
    }
  }
  return applied;
}
