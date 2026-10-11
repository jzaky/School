"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { activateVersion, assignPolicy, assignmentSchema, createPolicy, createPolicyVersion, deactivatePolicy, forbidden, isAegisError, notFound, policyDocumentSchema, policyInputSchema, rollbackToVersion, simulatePolicy, submitForReview, unassignPolicy, updateDraftVersion, updatePolicyMeta, validation, type EvaluationResult } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();
const reasonSchema = z.string().min(3).max(1000);

function parseDocument(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw validation("The policy document must be valid JSON");
  }
}

function revalidatePolicy(policyId?: string) {
  revalidatePath("/policies");
  revalidatePath("/policy-history");
  if (policyId) revalidatePath(`/policies/${policyId}`);
}

export async function createPolicyAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("policies:write")) throw forbidden("Missing permission policies:write");
    const raw = (input ?? {}) as Record<string, unknown>;
    const data = policyInputSchema.parse({ ...raw, document: parseDocument(raw.document) });
    const r = await withTenant(c.ctx.orgId, (db) => createPolicy(db, c.ctx, data));
    revalidatePolicy(r.policy.id);
    return { id: r.policy.id, versionId: r.version.id };
  });
}

const metaSchema = z.object({ name: z.string().min(2).max(120).optional(), description: z.string().max(2000).optional(), category: z.enum(["authorization", "data_protection", "tool_security", "operational"]).optional() });

export async function updatePolicyMetaAction(policyId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(policyId);
    const patch = metaSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => updatePolicyMeta(db, c.ctx, id, patch));
    revalidatePolicy(id);
  });
}

const versionSchema = z.object({ document: z.unknown(), changeNote: z.string().min(2).max(500) });

export async function createVersionAction(policyId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(policyId);
    const raw = (input ?? {}) as Record<string, unknown>;
    const data = versionSchema.parse({ ...raw, document: parseDocument(raw.document) });
    const v = await withTenant(c.ctx.orgId, (db) => createPolicyVersion(db, c.ctx, id, { document: data.document ?? null, changeNote: data.changeNote }));
    revalidatePolicy(id);
    return { versionId: v.id, version: v.version };
  });
}

export async function saveDraftAction(policyId: string, versionId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const pid = uuid.parse(policyId);
    const vid = uuid.parse(versionId);
    const raw = (input ?? {}) as Record<string, unknown>;
    const data = z.object({ document: z.unknown(), changeNote: z.string().max(500).optional() }).parse({ ...raw, document: parseDocument(raw.document) });
    const v = await withTenant(c.ctx.orgId, (db) => updateDraftVersion(db, c.ctx, vid, { document: data.document ?? null, changeNote: data.changeNote }));
    revalidatePolicy(pid);
    return { contentHash: v.contentHash };
  });
}

export interface PolicyTestResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  decidingRule: string | null;
}

/** Submits a draft. On test failure the embedded results come back so the UI can show every failing case. */
export async function submitForReviewAction(policyId: string, versionId: string): Promise<{ ok: true; data: { tests: PolicyTestResult[] } } | { ok: false; error: string; tests?: PolicyTestResult[] }> {
  const c = await getConsoleContext();
  const pid = uuid.parse(policyId);
  const vid = uuid.parse(versionId);
  try {
    const r = await withTenant(c.ctx.orgId, (db) => submitForReview(db, c.ctx, vid));
    revalidatePolicy(pid);
    return { ok: true, data: { tests: r.tests as PolicyTestResult[] } };
  } catch (e) {
    if (isAegisError(e)) {
      const details = e.details as { tests?: PolicyTestResult[] } | undefined;
      return { ok: false, error: e.message, tests: details?.tests };
    }
    throw e;
  }
}

export async function activateVersionAction(policyId: string, versionId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const pid = uuid.parse(policyId);
    const vid = uuid.parse(versionId);
    const fourEyes = c.org.settings.policyFourEyes !== false;
    await withTenant(c.ctx.orgId, (db) => activateVersion(db, c.ctx, vid, { fourEyes }));
    revalidatePolicy(pid);
    revalidatePath("/agents");
  });
}

export async function deactivatePolicyAction(policyId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const pid = uuid.parse(policyId);
    await withTenant(c.ctx.orgId, (db) => deactivatePolicy(db, c.ctx, pid, reasonSchema.parse(reason)));
    revalidatePolicy(pid);
  });
}

export async function rollbackAction(policyId: string, targetVersionId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const pid = uuid.parse(policyId);
    const v = await withTenant(c.ctx.orgId, (db) => rollbackToVersion(db, c.ctx, uuid.parse(targetVersionId), reasonSchema.parse(reason)));
    revalidatePolicy(pid);
    return { versionId: v.id, version: v.version };
  });
}

export async function assignPolicyAction(policyId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const pid = uuid.parse(policyId);
    const data = assignmentSchema.parse(input);
    const row = await withTenant(c.ctx.orgId, (db) => assignPolicy(db, c.ctx, pid, data));
    revalidatePolicy(pid);
    revalidatePath("/agents");
    return { id: row.id };
  });
}

export async function unassignPolicyAction(policyId: string, assignmentId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const pid = uuid.parse(policyId);
    await withTenant(c.ctx.orgId, (db) => unassignPolicy(db, c.ctx, uuid.parse(assignmentId)));
    revalidatePolicy(pid);
    revalidatePath("/agents");
  });
}

const simulateSchema = z.object({
  versionId: z.string().uuid().optional(),
  document: z.unknown().optional(),
  tool: z.string().min(1).max(80),
  action: z.string().min(1).max(80).default("execute"),
  agentId: z.string().uuid().nullable().optional(),
  resource: z.string().max(80).optional(),
  params: z.unknown(),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  deniedCount24h: z.coerce.number().int().min(0).optional(),
});

export interface SimulationOutput {
  result: EvaluationResult["result"];
  defaultDeny: boolean;
  decidingRule: { ruleId: string; effect: string; description: string; reason: string } | null;
  reasons: string[];
  riskIndicators: string[];
  skipped: { policyKey: string; reason: string }[];
  trace: { ruleId: string; effect: string; matched: boolean; comparisons: { attr: string; op: string; expected: string; actual: string; result: boolean }[] }[];
  input: Record<string, unknown>;
}

/** Dry run of a version's document (or an unsaved document) against a constructed input. Nothing is recorded. */
export async function simulatePolicyAction(input: unknown) {
  return act(async (): Promise<SimulationOutput> => {
    const c = await getConsoleContext();
    if (!c.can("policies:read")) throw forbidden("Missing permission policies:read");
    const raw = (input ?? {}) as Record<string, unknown>;
    const data = simulateSchema.parse({ ...raw, params: parseDocument(raw.params ?? {}), document: raw.document === undefined ? undefined : parseDocument(raw.document) });
    if (!data.versionId && data.document === undefined) throw validation("Choose a version or supply a document");
    const params = data.params && typeof data.params === "object" && !Array.isArray(data.params) ? (data.params as Record<string, unknown>) : {};
    const { document, agent, tool, resource } = await withTenant(c.ctx.orgId, async (db) => {
      let document: unknown = data.document;
      if (data.versionId) {
        const v = await db.policyVersion.findUnique({ where: { id: data.versionId } });
        if (!v) throw notFound("Policy version");
        document = v.document;
      }
      const agent = data.agentId ? await db.agent.findUnique({ where: { id: data.agentId }, include: { tools: { where: { revokedAt: null }, include: { tool: { select: { key: true } } } } } }) : null;
      const tool = await db.tool.findUnique({ where: { orgId_key: { orgId: c.ctx.orgId, key: data.tool } }, include: { integration: { select: { key: true } } } });
      const resource = data.resource ? await db.resource.findUnique({ where: { orgId_key: { orgId: c.ctx.orgId, key: data.resource } } }) : null;
      return { document, agent, tool, resource };
    });
    policyDocumentSchema.parse(document);
    const now = new Date();
    const hour = data.hour ?? now.getUTCHours();
    const amount = typeof params.amount === "number" ? params.amount : typeof params.amount === "string" && Number.isFinite(Number(params.amount)) ? Number(params.amount) : null;
    const simInput: Record<string, unknown> = {
      agent: agent ? { id: agent.id, slug: agent.slug, status: agent.status, environment: agent.environment, riskTier: agent.riskTier, dataClassificationLimit: agent.dataClassificationLimit, teamId: agent.teamId, tools: agent.tools.map((t) => t.tool.key), version: agent.currentVersion } : { id: null, slug: "simulation", status: "active", environment: "production", riskTier: "medium", dataClassificationLimit: "internal", teamId: null, tools: [data.tool], version: 1 },
      principal: { type: "none", userId: null, ref: null },
      action: { tool: data.tool, name: data.action, riskLevel: tool?.riskLevel ?? "medium", integration: tool?.integration?.key ?? null },
      resource: resource ? { key: resource.key, type: resource.type, classification: resource.classification, permittedActions: [] } : data.resource ? { key: data.resource, type: null, classification: null, permittedActions: [] } : null,
      params,
      context: { time: now.toISOString(), hour, weekday: now.getUTCDay(), ip: null, requestCount24h: 0, deniedCount24h: data.deniedCount24h ?? 0, approvalsPending: 0, destinationDomain: null, amount, currency: typeof params.currency === "string" ? params.currency : null, supplied: {} },
      shield: { dataClasses: [], highestSeverity: null, injectionSignals: [], blocked: false },
    };
    const r = simulatePolicy(document, simInput);
    const show = (v: unknown) => (v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v));
    return {
      result: r.result,
      defaultDeny: r.defaultDeny,
      decidingRule: r.decidingRule ? { ruleId: r.decidingRule.ruleId, effect: r.decidingRule.effect, description: r.decidingRule.description, reason: r.decidingRule.reason } : null,
      reasons: r.reasons,
      riskIndicators: r.riskIndicators,
      skipped: r.skippedPolicies,
      trace: r.trace.map((t) => ({ ruleId: t.ruleId, effect: t.effect, matched: t.matched, comparisons: t.comparisons.map((cmp) => ({ attr: cmp.attr, op: cmp.op, expected: show(cmp.expected), actual: show(cmp.actual), result: cmp.result })) })),
      input: simInput,
    };
  });
}
