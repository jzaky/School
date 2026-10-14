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
    /** Earlier requests (last 30 days, any agent) for the same tool and the same business reference (orderId, paymentIntentId, chargeId, invoiceId, reference, ticketId) that were executed, are executing, or are awaiting approval. Lets policies block duplicate refunds. */
    priorRequestsSameReference: number;
    /** The reference field that was matched, for approvers. */
    duplicateReferenceKey: string | null;
    /** Caller supplied free-form context (never trusted for authorization unless policies choose to). */
    supplied: Record<string, unknown>;
  };
  shield: {
    dataClasses: string[];
    highestSeverity: string | null;
    injectionSignals: string[];
    blocked: boolean;
  };
  /** Set when the request is made on behalf of another agent under an active delegation. */
  delegation: { id: string; delegatorAgentId: string; delegatorSlug: string; toolKeys: string[]; constraints: Record<string, unknown> } | null;
  /**
   * The uncertainty assessment made before policies run (docs/UNCERTAINTY_ENGINE.md). Policies may refer to
   * uncertainty.level (low, elevated, high, unknown), uncertainty.missing, uncertainty.contradictions,
   * uncertainty.confidence and uncertainty.confidenceBasis (self_reported or calibrated).
   */
  uncertainty: { level: string; missing: string[]; contradictions: string[]; confidence: number | null; confidenceBasis: string | null };
}

const AMOUNT_KEYS = ["amount", "value", "total", "sum"];
/** Business references that identify "the same operation" across requests. First present key wins. */
export const REFERENCE_KEYS = ["orderId", "paymentIntentId", "chargeId", "invoiceId", "ticketId", "reference"];

export function extractReference(params: Record<string, unknown>): { key: string; value: string } | null {
  for (const k of REFERENCE_KEYS) {
    const v = params[k];
    if (typeof v === "string" && v.trim() !== "") return { key: k, value: v.trim() };
    if (typeof v === "number" && Number.isFinite(v)) return { key: k, value: String(v) };
  }
  return null;
}
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
    delegation?: AuthorizationInput["delegation"];
    uncertainty?: AuthorizationInput["uncertainty"];
    now?: Date;
  },
): Promise<AuthorizationInput> {
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 3600_000);
  const reference = extractReference(args.params);
  const since30d = new Date(now.getTime() - 30 * 24 * 3600_000);
  const [requestCount24h, deniedCount24h, approvalsPending, priorRequestsSameReference] = await Promise.all([
    // Bounded above so a replay as of an earlier time does not count requests that came later.
    db.actionRequest.count({ where: { agentId: args.agent.id, createdAt: { gte: since, lte: now } } }),
    db.actionRequest.count({ where: { agentId: args.agent.id, createdAt: { gte: since, lte: now }, status: "denied" } }),
    db.actionRequest.count({ where: { agentId: args.agent.id, status: "pending_approval" } }),
    reference
      ? db.actionRequest.count({ where: { orgId: args.agent.orgId, toolKey: args.tool.key, createdAt: { gte: since30d, lt: now }, status: { in: ["allowed", "pending_approval", "approved", "executing", "executed", "unknown"] }, params: { path: [reference.key], equals: reference.value } } })
      : Promise.resolve(0),
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
      priorRequestsSameReference,
      duplicateReferenceKey: reference?.key ?? null,
      supplied: args.supplied ?? {},
    },
    shield: args.shield ?? { dataClasses: [], highestSeverity: null, injectionSignals: [], blocked: false },
    delegation: args.delegation ?? null,
    uncertainty: args.uncertainty ?? { level: "low", missing: [], contradictions: [], confidence: null, confidenceBasis: null },
  };
}
