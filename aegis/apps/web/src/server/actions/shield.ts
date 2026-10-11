"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { compileCustomPattern, createCustomDataClass, createDataClassSchema, deleteDataClass, evaluateToolSecurity, forbidden, inspectParams, inspectUntrustedContent, loadEnabledDataClasses, triageSchema, triageSecurityEvent, updateDataClass, updateDataClassSchema, validation, type Finding, type InjectionSignal, type Provenance, type ToolSecurityReport } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

// ---------- security events ----------

export async function triageEventAction(eventId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(eventId);
    const data = triageSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => triageSecurityEvent(db, c.ctx, id, data));
    revalidatePath("/security/events");
    revalidatePath(`/security/events/${id}`);
    return { status: data.status };
  });
}

// ---------- data classes ----------

export async function updateDataClassAction(classId: string, patch: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(classId);
    const data = updateDataClassSchema.parse(patch);
    const row = await withTenant(c.ctx.orgId, (db) => updateDataClass(db, c.ctx, id, data));
    revalidatePath("/security/data-protection");
    return { key: row.key, action: row.action, severity: row.severity, enabled: row.enabled };
  });
}

export async function createDataClassAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = createDataClassSchema.parse(input);
    const row = await withTenant(c.ctx.orgId, (db) => createCustomDataClass(db, c.ctx, data));
    revalidatePath("/security/data-protection");
    return { id: row.id, key: row.key };
  });
}

export async function deleteDataClassAction(classId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(classId);
    const r = await withTenant(c.ctx.orgId, (db) => deleteDataClass(db, c.ctx, id));
    revalidatePath("/security/data-protection");
    return { key: r.key };
  });
}

/** Compile check for a custom pattern, using the same guard rails the detector applies. */
export async function compilePatternAction(pattern: string): Promise<{ ok: true; source: string; flags: string } | { ok: false; error: string }> {
  await getConsoleContext();
  try {
    const compiled = compileCustomPattern(z.string().max(500).parse(pattern));
    return { ok: true, source: compiled.source, flags: compiled.flags };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Pattern rejected" };
  }
}

export interface SampleTestResult {
  field: string;
  toolKey: string | null;
  findings: Finding[];
  dataClasses: string[];
  highestSeverity: string | null;
  blocked: boolean;
  blockedClasses: string[];
  requireApproval: boolean;
  rewritten: string;
  classesLoaded: number;
}

const sampleSchema = z.object({ text: z.string().min(1).max(20_000), toolKey: z.string().max(80).optional() });

/**
 * Dry run of the Shield inspector over one sample. When a tool key is given and the tool declares
 * a parameter schema, the sample is placed in the tool's first string parameter so field specific
 * rules (addressing fields are preserved, not rewritten) apply exactly as they would at the gateway.
 */
export async function testSampleAction(input: unknown) {
  return act(async (): Promise<SampleTestResult> => {
    const c = await getConsoleContext();
    if (!c.can("security:read")) throw forbidden("Requires security:read");
    const data = sampleSchema.parse(input);
    return withTenant(
      c.ctx.orgId,
      async (db) => {
        let field = "sample";
        let toolKey: string | null = null;
        if (data.toolKey) {
          const tool = await db.tool.findUnique({ where: { orgId_key: { orgId: c.ctx.orgId, key: data.toolKey } }, select: { key: true, parameterSchema: true } });
          if (!tool) throw validation(`Unknown tool ${data.toolKey}`);
          toolKey = tool.key;
          const props = (tool.parameterSchema as { properties?: Record<string, { type?: string }> } | null)?.properties ?? {};
          const first = Object.entries(props).find(([, v]) => v?.type === "string")?.[0];
          if (first) field = first;
        }
        const classes = await loadEnabledDataClasses(db, c.ctx.orgId);
        const r = inspectParams({ [field]: data.text }, classes);
        return { field, toolKey, findings: r.findings, dataClasses: r.dataClasses, highestSeverity: r.highestSeverity, blocked: r.blocked, blockedClasses: r.blockedClasses, requireApproval: r.requireApproval, rewritten: String((r.params as Record<string, unknown>)[field] ?? ""), classesLoaded: classes.length };
      },
      { readOnly: true },
    );
  });
}

export interface InjectionTestResult {
  provenance: Provenance;
  scanned: boolean;
  signals: InjectionSignal[];
  keys: string[];
  heuristic: true;
}

const injectionSchema = z.object({ text: z.string().max(50_000), provenance: z.enum(["trusted", "untrusted", "retrieved"]) });

export async function injectionSignalsAction(input: unknown) {
  return act(async (): Promise<InjectionTestResult> => {
    const c = await getConsoleContext();
    if (!c.can("security:read")) throw forbidden("Requires security:read");
    const data = injectionSchema.parse(input);
    const r = inspectUntrustedContent(data);
    return { provenance: r.provenance, scanned: r.scanned, signals: r.signals, keys: r.keys, heuristic: true };
  });
}

// ---------- tool security ----------

const evaluateSchema = z.object({
  agentId: uuid,
  toolKey: z.string().min(1).max(80),
  resourceKey: z.string().max(120).optional(),
  destinationDomain: z.string().max(253).optional(),
  params: z.string().max(50_000).optional(),
});

export async function evaluateToolSecurityAction(input: unknown) {
  return act(async (): Promise<ToolSecurityReport> => {
    const c = await getConsoleContext();
    if (!c.can("security:read")) throw forbidden("Requires security:read");
    const data = evaluateSchema.parse(input);
    let params: Record<string, unknown> = {};
    if (data.params && data.params.trim()) {
      try {
        const parsed: unknown = JSON.parse(data.params);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Parameters must be a JSON object");
        params = parsed as Record<string, unknown>;
      } catch (e) {
        throw validation(`Parameters: ${e instanceof Error ? e.message : "invalid JSON"}`);
      }
    }
    const destination = data.destinationDomain?.trim();
    return withTenant(c.ctx.orgId, (db) => evaluateToolSecurity(db, c.ctx.orgId, { agentId: data.agentId, toolKey: data.toolKey, params, resourceKey: data.resourceKey?.trim() || null, destinationDomain: destination ? destination.toLowerCase() : undefined }), { readOnly: true });
  });
}
