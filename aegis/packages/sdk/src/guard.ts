import type { AegisClient, AuthorizeInput, Decision } from "./index.js";

/**
 * Framework-neutral enforcement wrapper. Every adapter in this package reduces to `guardedCall`:
 *
 *   1. Ask the gateway (agent execution mode) before the tool runs.
 *   2. allow or restrict: present the single-use grant (consumed now), run the tool with the parameters the
 *      gateway returned (restricted ones when narrowed), then report the outcome so a receipt is written.
 *   3. require_approval: optionally wait for a person; otherwise refuse with a clear message.
 *   4. deny, quarantine, request_more_information, error or an unreachable gateway: the tool never
 *      runs. The framework receives an AegisRefusal it can show to the model.
 *
 * Enforcement holds only for tools wrapped this way, or for systems that verify the grant themselves
 * (see verifyGrantDownstream). A tool the agent can call without the wrapper is outside AEGIS.
 */
export class AegisRefusal extends Error {
  constructor(
    readonly decision: Decision,
    message: string,
  ) {
    super(message);
    this.name = "AegisRefusal";
  }
}

export interface GuardOptions {
  /** AEGIS tool key. Defaults to the framework tool name. */
  toolKey?: string;
  action?: string;
  resource?: string;
  /** Builds a stable idempotency key so a retried call is one request. Default: tool key plus a hash of the arguments. */
  idempotencyKey?: (args: Record<string, unknown>) => string;
  justification?: (args: Record<string, unknown>) => string;
  context?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Wait for a human decision on require_approval instead of refusing at once. */
  waitForApproval?: { timeoutMs: number; intervalMs?: number } | false;
  onBehalfOf?: { agentId: string; delegationId?: string };
}

export interface GuardedExecution<T> {
  decision: Decision;
  result: T;
  /** Parameters the tool actually ran with (the gateway's narrowed set on restrict). */
  params: Record<string, unknown>;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** FNV-1a 64-bit, enough to make retries of the same call collide on one key. Not a security hash. */
export function argumentFingerprint(args: unknown): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of stableStringify(args)) {
    h ^= BigInt(ch.codePointAt(0)!);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

function refusalMessage(d: Decision): string {
  const why = d.reasons.length ? d.reasons.join("; ") : "no reason given";
  switch (d.decision) {
    case "deny":
      return `AEGIS refused this action: ${why}`;
    case "quarantine":
      return `AEGIS is holding this action for security review: ${why}`;
    case "request_more_information":
      return `AEGIS needs more information before deciding. Supply: ${d.moreInformation?.fields.join(", ") ?? "the requested fields"}. ${d.moreInformation?.message ?? ""}`.trim();
    case "require_approval":
      return `This action needs a person's approval (request ${d.requestId}). It has not run.`;
    case "error":
      return `AEGIS could not evaluate this action and refused it: ${why}`;
    default:
      return `AEGIS did not allow this action: ${why}`;
  }
}

export async function guardedCall<T>(client: AegisClient, toolName: string, args: Record<string, unknown>, run: (params: Record<string, unknown>) => Promise<T> | T, opts: GuardOptions = {}): Promise<GuardedExecution<T>> {
  const toolKey = opts.toolKey ?? toolName;
  const input: AuthorizeInput = {
    tool: toolKey,
    action: opts.action ?? "execute",
    params: args,
    resource: opts.resource,
    idempotencyKey: opts.idempotencyKey?.(args) ?? `${toolKey}:${argumentFingerprint(args)}`,
    justification: opts.justification?.(args) ?? "",
    context: opts.context?.(args) ?? {},
    executionMode: "agent",
    ...(opts.onBehalfOf ? { onBehalfOf: opts.onBehalfOf } : {}),
  } as AuthorizeInput;
  let decision = await client.authorize(input);
  let grant = decision.grant?.token ?? null;

  if (decision.decision === "require_approval" && opts.waitForApproval) {
    const waited = await client.waitForApproval(decision.requestId, { ...opts.waitForApproval, stopAtApproved: true });
    if (waited.status !== "approved") throw new AegisRefusal(decision, `The approval ended as ${waited.status}; the action did not run.`);
    const g = await client.getGrant(decision.requestId);
    if (!g) throw new AegisRefusal(decision, "Approved, but no execution grant could be obtained; the action did not run.");
    grant = g.grant;
    decision = { ...decision, decision: "allow", status: "approved" };
  }
  if ((decision.decision !== "allow" && decision.decision !== "restrict") || !grant) throw new AegisRefusal(decision, refusalMessage(decision));

  const params = decision.decision === "restrict" && decision.restrictions ? decision.restrictions.params : args;
  // The grant is consumed before the tool runs, never after: if the gateway was paused or the grant voided
  // since the decision, the tool does not run.
  const refused = await client.startExecution(decision.requestId, grant);
  if (refused !== null) throw new AegisRefusal(decision, `The action did not run: ${refused}`);
  let result: T;
  try {
    result = await run(params);
  } catch (e) {
    // A thrown tool error is reported as failed only when the tool says so definitively; otherwise
    // the gateway reconciles from the downstream system. Here the tool threw before or during the call.
    await client.reportExecution(decision.requestId, grant, { outcome: "failed", summary: { error: e instanceof Error ? e.message : "tool error" } });
    throw e;
  }
  await client.reportExecution(decision.requestId, grant, { outcome: "succeeded", summary: {} });
  return { decision, result, params };
}

/** Returns a function with the tool's own signature that asks AEGIS first. */
export function guard<A extends Record<string, unknown>, T>(client: AegisClient, toolName: string, fn: (args: A) => Promise<T> | T, opts: GuardOptions = {}): (args: A) => Promise<T> {
  return async (args: A) => (await guardedCall(client, toolName, args, (p) => fn(p as A), opts)).result;
}
