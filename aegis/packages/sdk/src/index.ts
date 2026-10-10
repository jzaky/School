/**
 * AEGIS TypeScript SDK for AI agents. Zero dependencies (uses fetch).
 *
 *   const aegis = new AegisClient({ baseUrl: "https://aegis.example", apiKey: process.env.AEGIS_AGENT_KEY! });
 *   const decision = await aegis.authorize({ tool: "issue-refund", params: { ... }, idempotencyKey: "order-123-refund" });
 *   if (decision.status === "executed") { ... } // gateway executed it
 *   if (decision.decision === "require_approval") { const final = await aegis.waitForApproval(decision.requestId); }
 *
 * Fail closed: any network or server error is reported as a deny. The SDK never executes anything itself.
 */
export interface AuthorizeInput {
  tool: string;
  action?: string;
  params?: Record<string, unknown>;
  resource?: string;
  idempotencyKey: string;
  correlationId?: string;
  justification?: string;
  principal?: { type: "user" | "customer" | "system" | "none"; ref?: string; userId?: string };
  context?: Record<string, unknown>;
  executionMode?: "gateway" | "agent";
}

export interface Decision {
  requestId: string;
  status: string;
  decision: "allow" | "deny" | "require_approval" | "error";
  reasons: string[];
  riskIndicators: string[];
  policyVersionIds: string[];
  matchedRuleIds: string[];
  approval?: { approvalRequestId: string; expiresAt: string; requiredApprovals: number; requiredRoles: string[] };
  grant?: { token: string; expiresAt: string };
  receipt?: { status: string; downstreamSystem: string; reference: string | null; summary: Record<string, unknown> };
  duplicate?: boolean;
  correlationId: string;
  /** Set by the SDK when the gateway could not be reached or returned an error. */
  transportError?: string;
}

export interface AegisClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class AegisClient {
  private readonly base: string;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AegisClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.key = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as T) : null;
      return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : ((data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`) };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : "network error" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Asks the gateway whether (and how) the action may proceed. Never throws. */
  async authorize(input: AuthorizeInput): Promise<Decision> {
    const r = await this.request<Decision>("POST", "/v1/gateway/actions", input);
    if (r.data && (r.status === 200 || r.status === 202 || r.status === 403) && "decision" in r.data) return r.data;
    return {
      requestId: "",
      status: "denied",
      decision: "deny",
      reasons: [`Authorization service unavailable or rejected the request: ${r.error ?? "unknown"}`],
      riskIndicators: [],
      policyVersionIds: [],
      matchedRuleIds: [],
      correlationId: input.correlationId ?? "",
      transportError: r.error ?? `HTTP ${r.status}`,
    };
  }

  async getRequest(requestId: string): Promise<Record<string, unknown> | null> {
    const r = await this.request<Record<string, unknown>>("GET", `/v1/gateway/actions/${requestId}`);
    return r.ok ? r.data : null;
  }

  /** Polls until the request leaves the pending state or the deadline passes. */
  async waitForApproval(requestId: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<{ status: string; receipt?: Record<string, unknown> | null }> {
    const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
    while (Date.now() < deadline) {
      const r = await this.getRequest(requestId);
      const status = (r?.status as string | undefined) ?? "unknown";
      if (!["pending_approval", "approved", "evaluating"].includes(status)) {
        const receipts = (r?.receipts as Record<string, unknown>[] | undefined) ?? [];
        return { status, receipt: receipts[0] ?? null };
      }
      await new Promise((res) => setTimeout(res, opts.intervalMs ?? 3000));
    }
    return { status: "timeout" };
  }

  /** Agent-mode: obtain a single-use grant for an allowed/approved request to present downstream. */
  async getGrant(requestId: string): Promise<{ grant: string; expiresAt: string; requestHash: string } | null> {
    const r = await this.request<{ grant: string; expiresAt: string; requestHash: string }>("POST", `/v1/gateway/actions/${requestId}/grant`);
    return r.ok ? r.data : null;
  }

  /** Agent-mode: record that the agent executed with the grant (the gateway writes the receipt). */
  async reportExecution(requestId: string, grant: string): Promise<Record<string, unknown> | null> {
    const r = await this.request<Record<string, unknown>>("POST", `/v1/gateway/actions/${requestId}/execute`, { grant });
    return r.ok ? r.data : null;
  }

  async provideApprovalInfo(approvalRequestId: string, info: string): Promise<boolean> {
    const r = await this.request("POST", `/v1/gateway/approvals/${approvalRequestId}/info`, { info });
    return r.ok;
  }
}

/** Helper for downstream systems: verify a grant against the exact parameters received. */
export async function verifyGrantDownstream(opts: { baseUrl: string; integrationApiKey: string; grant: string; toolKey: string; action?: string; params: Record<string, unknown>; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; reason?: string }> {
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(`${opts.baseUrl.replace(/\/$/, "")}/v1/gateway/grants/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.integrationApiKey}` },
      body: JSON.stringify({ grant: opts.grant, toolKey: opts.toolKey, action: opts.action ?? "execute", params: opts.params }),
    });
    const data = (await res.json()) as { ok: boolean; reason?: string };
    return res.ok && data.ok ? { ok: true } : { ok: false, reason: data.reason ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error" };
  }
}
