/**
 * Standards frameworks and their controls.
 *
 * Shared frameworks (org_id NULL) are a read-only catalog seeded with the owner connection; see
 * src/seed/frameworks. Tenants may define custom frameworks (is_custom, org_id set) and edit their
 * controls. Control summaries in the shared catalog are original wording; standard texts are not
 * reproduced.
 */
import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";

export const frameworkKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "lowercase letters, digits, dots and hyphens");

export const createFrameworkSchema = z.object({
  key: frameworkKeySchema,
  name: z.string().trim().min(2).max(120),
  version: z.string().trim().max(40).default(""),
  description: z.string().trim().max(2000).default(""),
  publisher: z.string().trim().max(120).default(""),
});

export const controlInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000).default(""),
  category: z.string().trim().max(120).default(""),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  automatedEvidenceType: z.string().trim().max(60).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type ControlInput = z.infer<typeof controlInputSchema>;

export async function listFrameworks(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "audit:read");
  // RLS returns shared rows (org_id NULL) plus this tenant's custom rows.
  const frameworks = await db.framework.findMany({ orderBy: [{ isCustom: "asc" }, { name: "asc" }] });
  const counts = await db.control.groupBy({ by: ["frameworkId"], _count: { _all: true }, where: { frameworkId: { in: frameworks.map((f) => f.id) } } });
  const countBy = new Map(counts.map((c) => [c.frameworkId, c._count._all]));
  const assessed = await db.assessment.groupBy({ by: ["frameworkId"], _count: { _all: true }, where: { orgId: ctx.orgId, status: "completed" } });
  const assessedBy = new Map(assessed.map((a) => [a.frameworkId, a._count._all]));
  return frameworks.map((f) => ({ ...f, controlCount: countBy.get(f.id) ?? 0, completedAssessments: assessedBy.get(f.id) ?? 0, shared: f.orgId === null }));
}

export async function getFramework(db: TenantDb, ctx: OrgContext, frameworkId: string) {
  assertPermission(ctx, "audit:read");
  const f = await db.framework.findUnique({ where: { id: frameworkId }, include: { controls: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] } } });
  if (!f) throw notFound("Framework");
  const categories = [...new Set(f.controls.map((c) => c.category))];
  return { ...f, shared: f.orgId === null, categories };
}

export async function getFrameworkByKey(db: TenantDb, ctx: OrgContext, key: string) {
  assertPermission(ctx, "audit:read");
  const f = await db.framework.findFirst({ where: { key, OR: [{ orgId: null }, { orgId: ctx.orgId }] }, orderBy: { isCustom: "desc" } });
  if (!f) throw notFound("Framework");
  return f;
}

export async function createCustomFramework(db: TenantDb, ctx: OrgContext, input: z.input<typeof createFrameworkSchema>) {
  assertPermission(ctx, "audit:write");
  const data = createFrameworkSchema.parse(input);
  const existing = await db.framework.findFirst({ where: { key: data.key, OR: [{ orgId: null }, { orgId: ctx.orgId }] } });
  if (existing) throw conflict(`A framework with key ${data.key} already exists`);
  const f = await db.framework.create({ data: { ...data, orgId: ctx.orgId, isCustom: true, licenseNote: "Customer-defined framework. Content is owned by the customer.", createdAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, { type: "framework.created", subjectType: "framework", subjectId: f.id, payload: { key: f.key, name: f.name } });
  return f;
}

async function customFramework(db: TenantDb, ctx: OrgContext, frameworkId: string) {
  const f = await db.framework.findUnique({ where: { id: frameworkId } });
  if (!f) throw notFound("Framework");
  if (!f.isCustom || f.orgId !== ctx.orgId) throw validation("Shared catalog frameworks are read-only. Create a custom framework to add controls.");
  return f;
}

export async function addControl(db: TenantDb, ctx: OrgContext, frameworkId: string, input: ControlInput) {
  assertPermission(ctx, "audit:write");
  const f = await customFramework(db, ctx, frameworkId);
  const data = controlInputSchema.parse(input);
  const dup = await db.control.findUnique({ where: { frameworkId_code: { frameworkId: f.id, code: data.code } } });
  if (dup) throw conflict(`Control ${data.code} already exists in this framework`);
  const max = await db.control.aggregate({ where: { frameworkId: f.id }, _max: { sortOrder: true } });
  const c = await db.control.create({ data: { frameworkId: f.id, code: data.code, title: data.title, summary: data.summary, category: data.category, keywords: data.keywords, automatedEvidenceType: data.automatedEvidenceType ?? null, sortOrder: data.sortOrder ?? (max._max.sortOrder ?? 0) + 10 } });
  await appendEvidence(db, ctx, { type: "control.created", subjectType: "control", subjectId: c.id, payload: { frameworkKey: f.key, code: c.code } });
  return c;
}

export async function updateControl(db: TenantDb, ctx: OrgContext, controlId: string, patch: Partial<ControlInput>) {
  assertPermission(ctx, "audit:write");
  const c = await db.control.findUnique({ where: { id: controlId }, include: { framework: true } });
  if (!c) throw notFound("Control");
  if (!c.framework.isCustom || c.framework.orgId !== ctx.orgId) throw validation("Controls of shared catalog frameworks cannot be edited");
  const data = controlInputSchema.partial().parse(patch);
  if (data.code && data.code !== c.code) {
    const dup = await db.control.findUnique({ where: { frameworkId_code: { frameworkId: c.frameworkId, code: data.code } } });
    if (dup) throw conflict(`Control ${data.code} already exists in this framework`);
  }
  const updated = await db.control.update({ where: { id: controlId }, data: { ...data, automatedEvidenceType: data.automatedEvidenceType === undefined ? undefined : data.automatedEvidenceType } as Prisma.ControlUpdateInput });
  await appendEvidence(db, ctx, { type: "control.updated", subjectType: "control", subjectId: controlId, payload: { fields: Object.keys(data) } });
  return updated;
}

export async function deleteControl(db: TenantDb, ctx: OrgContext, controlId: string) {
  assertPermission(ctx, "audit:write");
  const c = await db.control.findUnique({ where: { id: controlId }, include: { framework: true } });
  if (!c) throw notFound("Control");
  if (!c.framework.isCustom || c.framework.orgId !== ctx.orgId) throw validation("Controls of shared catalog frameworks cannot be deleted");
  const findings = await db.finding.count({ where: { controlId } });
  if (findings > 0) throw conflict(`Control has ${findings} finding(s) in existing assessments and cannot be deleted`);
  await db.controlMapping.deleteMany({ where: { controlId, orgId: ctx.orgId } });
  await db.control.delete({ where: { id: controlId } });
  await appendEvidence(db, ctx, { type: "control.deleted", subjectType: "control", subjectId: controlId, payload: { code: c.code } });
}

export async function deleteCustomFramework(db: TenantDb, ctx: OrgContext, frameworkId: string) {
  assertPermission(ctx, "audit:write");
  const f = await customFramework(db, ctx, frameworkId);
  const assessments = await db.assessment.count({ where: { frameworkId: f.id } });
  if (assessments > 0) throw conflict(`Framework has ${assessments} assessment(s) and cannot be deleted`);
  await db.controlMapping.deleteMany({ where: { orgId: ctx.orgId, control: { frameworkId: f.id } } });
  await db.framework.delete({ where: { id: f.id } });
  await appendEvidence(db, ctx, { type: "framework.deleted", subjectType: "framework", subjectId: f.id, payload: { key: f.key } });
}

/**
 * Parses a CSV with header `code,title,summary,category,keywords` (keywords separated by `;` or
 * `|`). Pure: returns control inputs or throws a validation error with line numbers. Handles
 * quoted fields with embedded commas and doubled quotes.
 */
export function importControlsCsv(text: string): ControlInput[] {
  // eslint-disable-next-line no-irregular-whitespace -- strips a UTF-8 byte order mark
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length === 0) throw validation("CSV is empty");
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iCode = col("code");
  const iTitle = col("title");
  if (iCode < 0 || iTitle < 0) throw validation("CSV header must contain at least code and title");
  const iSummary = col("summary");
  const iCategory = col("category");
  const iKeywords = col("keywords");
  const iAuto = col("automated_evidence_type");
  const out: ControlInput[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, n) => {
    if (r.every((v) => v.trim() === "")) return;
    const code = (r[iCode] ?? "").trim();
    const title = (r[iTitle] ?? "").trim();
    if (!code || !title) throw validation(`Line ${n + 2}: code and title are required`);
    if (seen.has(code)) throw validation(`Line ${n + 2}: duplicate code ${code}`);
    seen.add(code);
    const keywords = iKeywords >= 0 ? (r[iKeywords] ?? "").split(/[;|]/).map((k) => k.trim()).filter(Boolean) : [];
    out.push(controlInputSchema.parse({ code, title, summary: iSummary >= 0 ? (r[iSummary] ?? "").trim() : "", category: iCategory >= 0 ? (r[iCategory] ?? "").trim() : "", keywords, automatedEvidenceType: iAuto >= 0 && (r[iAuto] ?? "").trim() ? (r[iAuto] ?? "").trim() : null, sortOrder: (n + 1) * 10 }));
  });
  return out;
}

/** Imports controls from CSV text into a custom framework; existing codes are updated. */
export async function importControls(db: TenantDb, ctx: OrgContext, frameworkId: string, csvText: string) {
  assertPermission(ctx, "audit:write");
  const f = await customFramework(db, ctx, frameworkId);
  const controls = importControlsCsv(csvText);
  let created = 0;
  let updated = 0;
  for (const c of controls) {
    const existing = await db.control.findUnique({ where: { frameworkId_code: { frameworkId: f.id, code: c.code } } });
    if (existing) {
      await db.control.update({ where: { id: existing.id }, data: { title: c.title, summary: c.summary, category: c.category, keywords: c.keywords, automatedEvidenceType: c.automatedEvidenceType ?? null, sortOrder: c.sortOrder ?? existing.sortOrder } });
      updated++;
    } else {
      await db.control.create({ data: { frameworkId: f.id, code: c.code, title: c.title, summary: c.summary, category: c.category, keywords: c.keywords, automatedEvidenceType: c.automatedEvidenceType ?? null, sortOrder: c.sortOrder ?? 0 } });
      created++;
    }
  }
  await appendEvidence(db, ctx, { type: "framework.controls_imported", subjectType: "framework", subjectId: f.id, payload: { created, updated } });
  return { created, updated, total: controls.length };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
