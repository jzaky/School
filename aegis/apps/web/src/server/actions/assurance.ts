"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { acknowledgeAlert, createMonitoringRule, deleteMonitoringRule, evidenceFilter, exportEvidence, forbidden, getEvidenceEvent, governanceReport, resolveAlert, ruleDefinitionSchema, ruleInputSchema, runMonitoring, updateMonitoringRule, verifyAndRecord } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { actorLabel, evidenceLabels } from "@/server/queries/assurance";
import { subjectHref } from "@/server/queries/control";
import { act } from "./util";

const uuid = z.string().uuid();

// ---------- Evidence ----------

export async function verifyChainAction() {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("evidence:read")) throw forbidden("Missing permission evidence:read");
    const r = await withTenant(c.ctx.orgId, (db) => verifyAndRecord(db, c.ctx), { timeout: 60_000 });
    revalidatePath("/evidence");
    revalidatePath("/overview");
    return { valid: r.valid, checked: r.checked, firstBadSeq: r.firstBadSeq, reason: r.reason, lastHash: r.lastHash, checkpoints: r.checkpoints };
  });
}

const exportSchema = evidenceFilter.omit({ page: true, pageSize: true }).extend({ format: z.enum(["jsonl", "csv"]) });

export async function exportEvidenceAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("evidence:read")) throw forbidden("Missing permission evidence:read");
    const raw = Object.fromEntries(Object.entries((input ?? {}) as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && v !== undefined));
    const f = exportSchema.parse(raw);
    const r = await withTenant(c.ctx.orgId, (db) => exportEvidence(db, c.ctx, { ...f, page: 1, pageSize: 50 }), { timeout: 60_000 });
    revalidatePath("/evidence");
    return { filename: r.filename, contentType: r.contentType, body: r.body, sha256: r.sha256, count: r.count, valid: r.verification.valid, checked: r.verification.checked };
  });
}

export interface EvidenceDetail {
  event: { id: string; seq: string; type: string; actorType: string; actor: string; actorId: string | null; subjectType: string; subjectId: string | null; subjectHref: string | null; correlationId: string | null; traceId: string | null; prevHash: string; hash: string; occurredAt: string; payload: string };
  related: { id: string; seq: string; type: string; actor: string; occurredAt: string; hash: string }[];
  verified: boolean;
}

export async function getEvidenceEventAction(seq: string) {
  return act(async (): Promise<EvidenceDetail | null> => {
    const c = await getConsoleContext();
    if (!c.can("evidence:read")) throw forbidden("Missing permission evidence:read");
    const s = z.string().regex(/^\d+$/).parse(seq);
    return withTenant(c.ctx.orgId, async (db) => {
      const r = await getEvidenceEvent(db, c.ctx, BigInt(s));
      if (!r) return null;
      const labels = await evidenceLabels(db, [r.event, ...r.related]);
      return {
        event: { id: r.event.id, seq: r.event.seq.toString(), type: r.event.type, actorType: r.event.actorType, actor: actorLabel(r.event, labels), actorId: r.event.actorId, subjectType: r.event.subjectType, subjectId: r.event.subjectId, subjectHref: subjectHref(r.event.subjectType, r.event.subjectId), correlationId: r.event.correlationId, traceId: r.event.traceId, prevHash: r.event.prevHash, hash: r.event.hash, occurredAt: r.event.occurredAt.toISOString(), payload: JSON.stringify(r.event.payload ?? {}, null, 2) },
        related: r.related.map((e) => ({ id: e.id, seq: e.seq.toString(), type: e.type, actor: actorLabel(e, labels), occurredAt: e.occurredAt.toISOString(), hash: e.hash })),
        verified: r.verified,
      };
    });
  });
}

// ---------- Reports ----------

export async function downloadReportAction(days: number) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("reports:read")) throw forbidden("Missing permission reports:read");
    const d = z.coerce.number().int().refine((n) => [7, 30, 90].includes(n), "Period must be 7, 30 or 90 days").parse(days);
    const report = await withTenant(c.ctx.orgId, (db) => governanceReport(db, c.ctx, d, { record: true }), { timeout: 60_000 });
    revalidatePath("/evidence");
    return { filename: `aegis-governance-report-${d}d-${report.generatedAt.slice(0, 10)}.json`, body: JSON.stringify(report, null, 2) };
  });
}

// ---------- Monitoring ----------

function revalidateMonitoring() {
  revalidatePath("/monitoring");
  revalidatePath("/alerts");
  revalidatePath("/overview");
}

export async function createRuleAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = ruleInputSchema.parse(input);
    const row = await withTenant(c.ctx.orgId, (db) => createMonitoringRule(db, c.ctx, data));
    revalidateMonitoring();
    return { id: row.id, key: row.key };
  });
}

const rulePatchSchema = z.object({ name: z.string().min(3).max(120).optional(), description: z.string().max(500).optional(), severity: z.enum(["low", "medium", "high", "critical"]).optional(), definition: ruleDefinitionSchema.optional(), enabled: z.boolean().optional() });

export async function updateRuleAction(ruleId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(ruleId);
    const patch = rulePatchSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => updateMonitoringRule(db, c.ctx, id, patch));
    revalidateMonitoring();
  });
}

export async function deleteRuleAction(ruleId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => deleteMonitoringRule(db, c.ctx, uuid.parse(ruleId)));
    revalidateMonitoring();
  });
}

export async function runMonitoringAction() {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("monitoring:write")) throw forbidden("Missing permission monitoring:write");
    const r = await withTenant(c.ctx.orgId, (db) => runMonitoring(db, c.ctx), { timeout: 60_000 });
    revalidateMonitoring();
    return r;
  });
}

export async function acknowledgeAlertAction(alertId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => acknowledgeAlert(db, c.ctx, uuid.parse(alertId)));
    revalidateMonitoring();
  });
}

export async function resolveAlertAction(alertId: string, note: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => resolveAlert(db, c.ctx, uuid.parse(alertId), z.string().min(3).max(2000).parse(note)));
    revalidateMonitoring();
  });
}
