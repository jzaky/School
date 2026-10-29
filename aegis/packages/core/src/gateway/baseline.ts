import AjvModule, { type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

// CommonJS interop under NodeNext: the default export may be wrapped.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- ajv ships a CJS/ESM dual default; the inline type is the reliable spelling
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as unknown as new (opts: object) => import("ajv").default;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as unknown as (ajv: import("ajv").default) => void;
import type { Agent, Integration, Resource, Tool } from "@aegis/db";
import { hashObject } from "../lib/crypto.js";
import { freezeMessage, type ChangeFreeze } from "./freeze.js";
import { pendingDefinitionChange } from "../shield/tool-pins.js";

/**
 * Structural checks that run before any policy. They encode the registry, not customer policy:
 * an agent can only use tools it was granted, on resources it has permissions for, through enabled
 * integrations, with parameters that match the tool's schema. Any failure is a deny.
 */
export interface BaselineFailure {
  code:
    | "agent_not_active"
    | "tool_not_found"
    | "tool_disabled"
    | "tool_not_granted"
    | "integration_disabled"
    | "resource_not_found"
    | "resource_not_permitted"
    | "action_not_permitted"
    | "classification_exceeded"
    | "permission_expired"
    | "invalid_parameters"
    | "destination_not_allowed"
    | "gateway_paused"
    | "agent_credential_expired"
    | "grant_expired"
    | "delegation_invalid"
    | "delegation_not_permitted"
    | "delegation_limit_exceeded"
    | "policy_integrity"
    | "concurrency_limit"
    | "change_freeze"
    | "tool_definition_changed"
    | "payment_document_mismatch"
    | "expense_claim_mismatch";
  message: string;
  details?: unknown;
}

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false, removeAdditional: false });
addFormats(ajv);
const compiled = new Map<string, ValidateFunction>();

export function validateParams(schema: unknown, params: unknown): { ok: true } | { ok: false; errors: string[] } {
  if (!schema || typeof schema !== "object" || Object.keys(schema as object).length === 0) return { ok: true };
  const key = hashObject(schema);
  let fn: ValidateFunction | undefined = compiled.get(key);
  if (!fn) {
    try {
      fn = ajv.compile(schema as object);
    } catch (e) {
      return { ok: false, errors: [`tool parameter schema is invalid: ${e instanceof Error ? e.message : "unknown"}`] };
    }
    compiled.set(key, fn);
  }
  const validate: ValidateFunction = fn;
  if (validate(params)) return { ok: true };
  return { ok: false, errors: (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`.trim()) };
}

const CLASS_ORDER = ["public", "internal", "confidential", "restricted"];

export function baselineChecks(args: {
  agent: Agent & { tools: { enabled: boolean; revokedAt: Date | null; toolId: string; expiresAt?: Date | null }[]; permissions: { resourceId: string; actions: string[]; expiresAt: Date | null; revokedAt: Date | null }[] };
  tool: (Tool & { integration: Omit<Integration, "settings" | "enforcementSummary"> | null }) | null;
  action: string;
  resource: Resource | null;
  resourceKeyRequested: string | null;
  params: Record<string, unknown>;
  destinationDomain: string | null;
  gatewayPaused: { paused: boolean; reason?: string };
  /** A change freeze in force for this tool and agent whose effect is to refuse (see freeze.ts). */
  freeze?: ChangeFreeze | null;
  /** The request clock (replays pass the original time). */
  now?: Date;
}): { failures: BaselineFailure[]; permittedActions: string[] } {
  const failures: BaselineFailure[] = [];
  const { agent, tool, resource } = args;
  const now = args.now ?? new Date();
  if (args.gatewayPaused.paused) failures.push({ code: "gateway_paused", message: `Gateway is paused: ${args.gatewayPaused.reason ?? "emergency control"}` });
  if (agent.status !== "active") failures.push({ code: "agent_not_active", message: `Agent is ${agent.status}` });
  if (agent.credentialExpiresAt && agent.credentialExpiresAt <= now) failures.push({ code: "agent_credential_expired", message: `Agent authority lapsed on ${agent.credentialExpiresAt.toISOString().slice(0, 10)}; it must be re-certified` });
  if (!tool) {
    failures.push({ code: "tool_not_found", message: "Unknown tool" });
    return { failures, permittedActions: [] };
  }
  if (args.freeze?.effect === "deny") failures.push({ code: "change_freeze", message: freezeMessage(args.freeze), details: { freezeId: args.freeze.id } });
  const definitionChange = pendingDefinitionChange(tool.definitionPin);
  if (definitionChange) failures.push({ code: "tool_definition_changed", message: `Tool ${tool.key}: ${definitionChange}` });
  if (!tool.enabled) failures.push({ code: "tool_disabled", message: `Tool ${tool.key} is disabled${tool.disabledReason ? `: ${tool.disabledReason}` : ""}` });
  if (tool.integration && tool.integration.status !== "active") failures.push({ code: "integration_disabled", message: `Integration ${tool.integration.key} is disabled${tool.integration.statusReason ? `: ${tool.integration.statusReason}` : ""}` });
  const grant = agent.tools.find((t) => t.toolId === tool.id);
  if (!grant || !grant.enabled || grant.revokedAt) failures.push({ code: "tool_not_granted", message: `Agent has no active grant for tool ${tool.key}` });
  else if (grant.expiresAt && grant.expiresAt <= now) failures.push({ code: "grant_expired", message: `Temporary access to ${tool.key} ended at ${grant.expiresAt.toISOString()}` });

  const paramCheck = validateParams(tool.parameterSchema, args.params);
  if (!paramCheck.ok) failures.push({ code: "invalid_parameters", message: "Parameters do not match the tool schema", details: paramCheck.errors });

  let permittedActions: string[] = [];
  if (args.resourceKeyRequested && !resource) failures.push({ code: "resource_not_found", message: `Unknown resource ${args.resourceKeyRequested}` });
  if (resource) {
    const perm = agent.permissions.find((p) => p.resourceId === resource.id && !p.revokedAt);
    if (!perm) failures.push({ code: "resource_not_permitted", message: `Agent has no permission on resource ${resource.key}` });
    else if (perm.expiresAt && perm.expiresAt < now) failures.push({ code: "permission_expired", message: `Permission on ${resource.key} expired` });
    else {
      permittedActions = perm.actions;
      if (!perm.actions.includes(args.action) && !perm.actions.includes("*")) failures.push({ code: "action_not_permitted", message: `Action ${args.action} is not permitted on ${resource.key} (permitted: ${perm.actions.join(", ") || "none"})` });
    }
    const resourceClass = CLASS_ORDER.indexOf(resource.classification);
    const agentLimit = CLASS_ORDER.indexOf(agent.dataClassificationLimit);
    // An unknown classification on either side is a failure, never a pass: fail closed.
    if (resourceClass < 0 || agentLimit < 0) {
      failures.push({ code: "classification_exceeded", message: `Unknown data classification (resource ${resource.classification}, agent limit ${agent.dataClassificationLimit})` });
    } else if (resourceClass > agentLimit) {
      failures.push({ code: "classification_exceeded", message: `Resource ${resource.key} is ${resource.classification}; agent is limited to ${agent.dataClassificationLimit}` });
    }
    const rules = (tool.destinationRules ?? {}) as { allowedResourceKeys?: string[] };
    if (rules.allowedResourceKeys?.length && !rules.allowedResourceKeys.includes(resource.key)) {
      failures.push({ code: "destination_not_allowed", message: `Tool ${tool.key} may not target resource ${resource.key}` });
    }
  }
  const rules = (tool.destinationRules ?? {}) as { allowedDomains?: string[] };
  if (rules.allowedDomains?.length && args.destinationDomain) {
    const ok = rules.allowedDomains.some((d) => domainMatches(args.destinationDomain!, d));
    if (!ok) failures.push({ code: "destination_not_allowed", message: `Destination ${args.destinationDomain} is outside the allowed destinations for ${tool.key}` });
  }
  // The agent's own destination list applies on top of each tool's: both must allow the destination.
  if (agent.allowedDestinations?.length && args.destinationDomain && !agent.allowedDestinations.some((d) => domainMatches(args.destinationDomain!, d))) {
    failures.push({ code: "destination_not_allowed", message: `Destination ${args.destinationDomain} is outside this agent's allowed destinations` });
  }
  return { failures, permittedActions };
}

function domainMatches(host: string, allowed: string): boolean {
  const a = allowed.toLowerCase();
  if (a.startsWith("*.")) return host === a.slice(2) || host.endsWith(a.slice(1));
  return host === a || host.endsWith(`.${a}`);
}
