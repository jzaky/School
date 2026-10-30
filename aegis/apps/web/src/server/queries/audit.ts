import "server-only";
import type { TenantDb } from "@aegis/db";

export interface DocumentPick {
  id: string;
  title: string;
  filename: string;
  status: string;
  chunkCount: number;
}

/** Documents for pickers (assessment scope, remediation evidence). */
export async function documentPicks(db: TenantDb, orgId: string, parsedOnly = false): Promise<DocumentPick[]> {
  return db.document.findMany({ where: { orgId, ...(parsedOnly ? { status: "parsed" } : {}) }, orderBy: { title: "asc" }, select: { id: true, title: true, filename: true, status: true, chunkCount: true } });
}

export interface FrameworkPick {
  id: string;
  key: string;
  name: string;
  version: string;
  isCustom: boolean;
  controlCount: number;
}

export async function frameworkPicks(db: TenantDb): Promise<FrameworkPick[]> {
  const rows = await db.framework.findMany({ orderBy: [{ isCustom: "asc" }, { name: "asc" }], select: { id: true, key: true, name: true, version: true, isCustom: true, _count: { select: { controls: true } } } });
  return rows.map((f) => ({ id: f.id, key: f.key, name: f.name, version: f.version, isCustom: f.isCustom, controlCount: f._count.controls }));
}

export interface AssessmentPick {
  id: string;
  name: string;
  status: string;
  frameworkName: string;
  completedAt: Date | null;
}

export async function assessmentPicks(db: TenantDb, orgId: string, completedOnly = true): Promise<AssessmentPick[]> {
  const rows = await db.assessment.findMany({ where: { orgId, ...(completedOnly ? { status: "completed" } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true, completedAt: true, framework: { select: { name: true } } } });
  return rows.map((a) => ({ id: a.id, name: a.name, status: a.status, frameworkName: a.framework.name, completedAt: a.completedAt }));
}

export interface FindingPick {
  id: string;
  code: string;
  title: string;
  assessmentName: string;
  status: string;
}

/** Findings of completed assessments, for linking remediation tasks. */
export async function findingPicks(db: TenantDb, orgId: string, assessmentId?: string): Promise<FindingPick[]> {
  const rows = await db.finding.findMany({ where: { orgId, ...(assessmentId ? { assessmentId } : { assessment: { status: "completed" } }) }, select: { id: true, status: true, humanStatus: true, control: { select: { code: true, title: true, sortOrder: true } }, assessment: { select: { name: true } } }, take: 1000 });
  rows.sort((a, b) => a.control.sortOrder - b.control.sortOrder || a.control.code.localeCompare(b.control.code));
  return rows.map((f) => ({ id: f.id, code: f.control.code, title: f.control.title, assessmentName: f.assessment.name, status: f.humanStatus ?? f.status }));
}

/**
 * AuditExport rows do not store the assessment they were generated from; the ledger does
 * (report.generated payload.assessmentId). Resolve it from there for display.
 */
export async function exportAssessmentIds(db: TenantDb, orgId: string, exportIds: string[]): Promise<Map<string, string>> {
  if (exportIds.length === 0) return new Map();
  const rows = await db.evidenceEvent.findMany({ where: { orgId, type: "report.generated", subjectType: "audit_export", subjectId: { in: exportIds } }, select: { subjectId: true, payload: true } });
  const out = new Map<string, string>();
  for (const r of rows) {
    const assessmentId = (r.payload as { assessmentId?: string } | null)?.assessmentId;
    if (r.subjectId && assessmentId) out.set(r.subjectId, assessmentId);
  }
  return out;
}

export async function assessmentNames(db: TenantDb, ids: string[]): Promise<Map<string, { name: string; frameworkName: string }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.assessment.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, framework: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.id, { name: r.name, frameworkName: r.framework.name }]));
}
