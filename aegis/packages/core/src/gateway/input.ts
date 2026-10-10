import type { Agent, Resource, TenantDb, Tool } from "@aegis/db";

/** The document policies are evaluated against. Documented in docs/POLICY_LANGUAGE.md. */
export interface AuthorizationInput {
  agent: {
    id: string;
    slug: string;
    status: string;
    environment: string;
    riskTier: string;
    dataClassificationLimit: string;
    teamId: string | null;
    businessOwnerId: string | null;
    technicalOwnerId: string | null;
    tools: string[];
    version: number;
  };
  principal: { type: string; userId: string | null; ref: string | null };
  org: { id: string };
  action: { tool: string; name: string; riskLevel: string; integration: string | null };
  resource: { key: string; type: string; classification: string; permittedActions: string[] } | null;
  params: Record<string, unknown>;
  context: {
    time: string;
    hour: number;
    weekday: number;
    environment: string;
    ip: string | null;
    requestCount24h: number;
    deniedCount24h: number;
    approvalsPending: number;
    destinationDomain: string | null;
    amount: number | null;
    currency: string | null;
    /** Caller supplied free-form context (never trusted for authorization unless policies choose to). */
    supplied: Record<string, unknown>;
  };
  shield: {
    dataClasses: string[];
    highestSeverity: string | null;
    injectionSignals: string[];
    blocked: boolean;
  };
}

const AMOUNT_KEYS = ["amount", "value", "total", "sum"];
const DEST_KEYS = ["to", "destination", "url", "recipient", "email", "endpoint", "webhook"];

export function extractAmount(params: Record<string, unknown>): { amount: number | null; currency: string | null } {
  let amount: number | null = null;
  for (const k of AMOUNT_KEYS) {
    const v = params[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      amount = v;
      break;
    }
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      amount = Number(v);
      break;
    }
  }
  const currency = typeof params.currency === "string" ? params.currency.toUpperCase() : null;
  return { amount, currency };
}

export function extractDestinationDomain(params: Record<string, unknown>): string | null {
  for (const k of DEST_KEYS) {
    const v = params[k];
    if (typeof v !== "string") continue;
    const s = v.trim().toLowerCase();
    const at = s.lastIndexOf("@");
    if (at >= 0 && !s.includes("://")) return s.slice(at + 1);
    try {
      return new URL(s.includes("://") ? s : `https://${s}`).hostname;
    } catch {
      continue;
    }
  }
  return null;
}

export async function buildAuthorizationInput(
  db: TenantDb,
  args: {
    agent: Agent & { tools: { enabled: boolean; revokedAt: Date | null; tool: Tool }[] };
    tool: Tool & { integration: { key: string } | null };
    action: string;
    resource: (Resource & { permittedActions: string[] }) | null;
    params: Record<string, unknown>;
    principal: { type: string; userId: string | null; ref: string | null };
    ip?: string | null;
    supplied?: Record<string, unknown>;
    shield?: AuthorizationInput["shield"];
    now?: Date;
  },
): Promise<AuthorizationInput> {
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 3600_000);
  const [requestCount24h, deniedCount24h, approvalsPending] = await Promise.all([
    db.actionRequest.count({ where: { agentId: args.agent.id, createdAt: { gte: since } } }),
    db.actionRequest.count({ where: { agentId: args.agent.id, createdAt: { gte: since }, status: "denied" } }),
    db.actionRequest.count({ where: { agentId: args.agent.id, status: "pending_approval" } }),
  ]);
  const { amount, currency } = extractAmount(args.params);
  return {
    agent: {
      id: args.agent.id,
      slug: args.agent.slug,
      status: args.agent.status,
      environment: args.agent.environment,
      riskTier: args.agent.riskTier,
      dataClassificationLimit: args.agent.dataClassificationLimit,
      teamId: args.agent.teamId,
      businessOwnerId: args.agent.businessOwnerId,
      technicalOwnerId: args.agent.technicalOwnerId,
      tools: args.agent.tools.filter((t) => t.enabled && !t.revokedAt).map((t) => t.tool.key),
      version: args.agent.currentVersion,
    },
    principal: args.principal,
    org: { id: args.agent.orgId },
    action: { tool: args.tool.key, name: args.action, riskLevel: args.tool.riskLevel, integration: args.tool.integration?.key ?? null },
    resource: args.resource ? { key: args.resource.key, type: args.resource.type, classification: args.resource.classification, permittedActions: args.resource.permittedActions } : null,
    params: args.params,
    context: {
      time: now.toISOString(),
      hour: now.getUTCHours(),
      weekday: now.getUTCDay(),
      environment: args.agent.environment,
      ip: args.ip ?? null,
      requestCount24h,
      deniedCount24h,
      approvalsPending,
      destinationDomain: extractDestinationDomain(args.params),
      amount,
      currency,
      supplied: args.supplied ?? {},
    },
    shield: args.shield ?? { dataClasses: [], highestSeverity: null, injectionSignals: [], blocked: false },
  };
}
