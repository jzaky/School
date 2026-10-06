"use server";

import { revalidatePath } from "next/cache";
import type { DsrType } from "@prisma/client";
import { getCtx, type Ctx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { tenantTx } from "@/lib/tenant-db";
import { queue } from "@/server/queue";
import { deleteObject } from "@/server/documents/storage-core";
import { isSubjectKind, resolveSubject, type SubjectKind } from "./subject";
import { applyErasure, displayPlan, planErasure, summarise, type ErasurePlan } from "./erase";
import { anonymiseAccountIfUnused } from "./account";
import { PRIVACY_QUEUE, SCHOOL_EXPORT_JOB, requestSchoolExport, runSchoolExport } from "./school-export";
import { BASIS_VALUES, CATEGORY_VALUES } from "./purposes";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function managerCtx(): Promise<Ctx | null> {
  const ctx = await getCtx();
  return ctx.can("compliance.manage") ? ctx : null;
}
const done = () => {
  revalidatePath("/[locale]/admin/compliance", "page");
  revalidatePath("/[locale]/admin/compliance/person", "page");
  revalidatePath("/[locale]/admin/compliance/exit", "page");
};

// ---------------------------------------------------------------------------
// Finding a person
// ---------------------------------------------------------------------------

export type SubjectHit = { kind: SubjectKind; id: string; nameEn: string; nameAr: string; reference: string; detail: string };

export async function searchSubjectsAction(input: { q: string }): Promise<Res<{ hits: SubjectHit[] }>> {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const q = (input.q ?? "").trim().slice(0, 60);
  if (q.length < 2) return { ok: true, hits: [] };
  const { db, orgId } = ctx;
  const like = { contains: q, mode: "insensitive" as const };
  const [students, guardians, staff] = await Promise.all([
    db.student.findMany({ where: { orgId, OR: [{ firstNameEn: like }, { lastNameEn: like }, { firstNameAr: like }, { lastNameAr: like }, { studentNo: like }] }, take: 6, orderBy: { lastNameEn: "asc" } }),
    db.guardian.findMany({ where: { orgId, OR: [{ firstNameEn: like }, { lastNameEn: like }, { firstNameAr: like }, { lastNameAr: like }, { email: like }] }, take: 6, orderBy: { lastNameEn: "asc" } }),
    db.membership.findMany({ where: { orgId, student: { is: null }, guardian: { is: null }, user: { OR: [{ nameEn: like }, { nameAr: like }, { email: like }] } }, include: { user: true, staffProfile: true }, take: 6 }),
  ]);
  const hits: SubjectHit[] = [
    ...students.map((s) => ({ kind: "student" as const, id: s.id, nameEn: `${s.firstNameEn} ${s.lastNameEn}`, nameAr: `${s.firstNameAr} ${s.lastNameAr}`, reference: s.studentNo, detail: String(s.gradeLevel) })),
    ...guardians.map((g) => ({ kind: "guardian" as const, id: g.id, nameEn: `${g.firstNameEn} ${g.lastNameEn}`, nameAr: `${g.firstNameAr} ${g.lastNameAr}`, reference: `G-${g.id.slice(-6).toUpperCase()}`, detail: "" })),
    ...staff.map((m) => ({ kind: "staff" as const, id: m.id, nameEn: m.user.nameEn, nameAr: m.user.nameAr ?? m.user.nameEn, reference: m.staffProfile?.employeeNo || `M-${m.id.slice(-6).toUpperCase()}`, detail: m.staffProfile?.jobTitleEn ?? "" })),
  ];
  return { ok: true, hits };
}

// ---------------------------------------------------------------------------
// Logging a data subject request
// ---------------------------------------------------------------------------

export async function createDsrAction(input: { type: DsrType; kind: SubjectKind; subjectId: string; requesterName: string; details?: string }): Promise<Res<{ id: string; number: string }>> {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  if (!["ACCESS", "CORRECTION", "DELETION"].includes(input.type)) return { ok: false, error: "TYPE" };
  if (!isSubjectKind(input.kind)) return { ok: false, error: "SUBJECT" };
  const requester = (input.requesterName ?? "").trim().slice(0, 120);
  if (requester.length < 2) return { ok: false, error: "REQUESTER" };
  const subject = await resolveSubject(ctx.db, ctx.orgId, { kind: input.kind, id: input.subjectId });
  if (!subject) return { ok: false, error: "SUBJECT" };
  const now = new Date();
  const year = now.getUTCFullYear();
  let created: { id: string; number: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const n = (await ctx.db.dataSubjectRequest.count({ where: { orgId: ctx.orgId, number: { startsWith: `DSR-${year}-` } } })) + 1 + attempt;
    const number = `DSR-${year}-${String(n).padStart(3, "0")}`;
    const res = await ctx.db.dataSubjectRequest.createMany({
      data: [
        {
          orgId: ctx.orgId,
          number,
          type: input.type,
          subjectName: subject.name.en,
          requesterName: requester,
          studentId: subject.kind === "student" ? subject.id : null,
          guardianId: subject.kind === "guardian" ? subject.id : null,
          membershipId: subject.kind === "staff" ? subject.id : null,
          detailsEn: input.details?.trim().slice(0, 1000) || null,
          receivedAt: now,
          dueAt: new Date(now.getTime() + 30 * 86_400_000),
          handledById: ctx.membershipId,
        },
      ],
      skipDuplicates: true,
    });
    if (res.count === 1) {
      const row = await ctx.db.dataSubjectRequest.findUniqueOrThrow({ where: { orgId_number: { orgId: ctx.orgId, number } } });
      created = { id: row.id, number };
    }
  }
  if (!created) return { ok: false, error: "generic" };
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "dsr.create", entityType: "DataSubjectRequest", entityId: created.id, sensitivity: "CONFIDENTIAL", meta: { type: input.type, kind: subject.kind } });
  done();
  return { ok: true, ...created };
}

// ---------------------------------------------------------------------------
// Erasure: preview, then confirm with the plan's hash and the person's reference
// ---------------------------------------------------------------------------

async function isDemoPersona(ctx: Ctx, membershipId: string | null) {
  if (!ctx.org.isDemo || !membershipId) return false;
  return (await ctx.db.demoPersona.count({ where: { orgId: ctx.orgId, membershipId } })) > 0;
}

export async function previewErasureAction(input: { kind: SubjectKind; id: string }): Promise<Res<{ plan: ErasurePlan }>> {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const subject = await resolveSubject(ctx.db, ctx.orgId, input);
  if (!subject) return { ok: false, error: "SUBJECT" };
  if (subject.anonymisedAt) return { ok: false, error: "ALREADY" };
  if (subject.membershipId === ctx.membershipId) return { ok: false, error: "SELF" };
  if (await isDemoPersona(ctx, subject.membershipId)) return { ok: false, error: "DEMO_PERSONA" };
  const plan = await planErasure(ctx.db, ctx.orgId, subject);
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "dsr.erase_preview", entityType: subject.kind === "student" ? "Student" : subject.kind === "guardian" ? "Guardian" : "Membership", entityId: subject.id, sensitivity: "CONFIDENTIAL", meta: summarise(plan.items) });
  return { ok: true, plan: displayPlan(plan, ctx.can("safeguarding.view")) };
}

export async function eraseSubjectAction(input: { kind: SubjectKind; id: string; hash: string; confirm: string; dsrId?: string | null }): Promise<Res<{ summary: Record<string, number>; files: number; account: string }>> {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const subject = await resolveSubject(ctx.db, ctx.orgId, input);
  if (!subject) return { ok: false, error: "SUBJECT" };
  if (subject.anonymisedAt) return { ok: false, error: "ALREADY" };
  if (subject.membershipId === ctx.membershipId) return { ok: false, error: "SELF" };
  if (await isDemoPersona(ctx, subject.membershipId)) return { ok: false, error: "DEMO_PERSONA" };
  if ((input.confirm ?? "").trim() !== subject.reference) return { ok: false, error: "CONFIRM" };
  const dsr = input.dsrId ? await ctx.db.dataSubjectRequest.findFirst({ where: { id: input.dsrId, orgId: ctx.orgId } }) : null;
  const result = await tenantTx(ctx.orgId, (tx) => applyErasure(tx, ctx.orgId, subject, { expectHash: input.hash }), { timeout: 120_000 });
  if (!result) return { ok: false, error: "PLAN_CHANGED" };
  let filesRemoved = 0;
  for (const k of result.fileKeys) if (await deleteObject(k)) filesRemoved++;
  const account = await anonymiseAccountIfUnused(subject.userId, ctx.orgId);
  const summary = summarise(result.done);
  const totals = { deleted: 0, anonymised: 0, kept: 0 };
  for (const i of result.done) totals[i.action === "delete" ? "deleted" : i.action === "anonymise" ? "anonymised" : "kept"] += i.count;
  if (dsr) {
    await ctx.db.dataSubjectRequest.update({
      where: { id: dsr.id },
      data: { status: "COMPLETED", completedAt: new Date(), handledById: ctx.membershipId, resolution: `Erasure completed: ${totals.deleted} records deleted, ${totals.anonymised} anonymised, ${totals.kept} kept under retention rules, ${filesRemoved} files removed.` },
    });
  }
  await audit(ctx.db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: "dsr.erase",
    entityType: subject.kind === "student" ? "Student" : subject.kind === "guardian" ? "Guardian" : "Membership",
    entityId: subject.id,
    sensitivity: "CONFIDENTIAL",
    meta: { dsr: dsr?.number ?? null, summary, filesRemoved, account },
  });
  done();
  return { ok: true, summary, files: filesRemoved, account };
}

// ---------------------------------------------------------------------------
// School exit export
// ---------------------------------------------------------------------------

export async function requestSchoolExportAction(input: { confirm: string }): Promise<Res<{ id: string; created: boolean }>> {
  const ctx = await getCtx();
  if (!ctx.can("compliance.manage") || !ctx.can("school.manage")) return { ok: false, error: "FORBIDDEN" };
  if ((input.confirm ?? "").trim() !== ctx.org.slug) return { ok: false, error: "CONFIRM" };
  const includeRestricted = ctx.can("safeguarding.view");
  const { export: exp, created } = await requestSchoolExport(ctx.orgId, { requestedById: ctx.membershipId, includeRestricted });
  if (created) {
    await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "school_export.request", entityType: "DataExport", entityId: exp.id, sensitivity: "CONFIDENTIAL", meta: { includeRestricted } });
    const q = queue(PRIVACY_QUEUE);
    let queued = false;
    if (q) {
      try {
        await q.add(SCHOOL_EXPORT_JOB, { orgId: ctx.orgId, exportId: exp.id }, { jobId: `school-export:${exp.id}`, attempts: 3 });
        queued = true;
      } catch {
        queued = false;
      }
    }
    // Without Redis (local development) the export runs in this process; it is idempotent either way.
    if (!queued) void runSchoolExport({ orgId: ctx.orgId, exportId: exp.id }).catch(() => undefined);
  }
  done();
  return { ok: true, id: exp.id, created };
}

// ---------------------------------------------------------------------------
// Processing purposes
// ---------------------------------------------------------------------------

export type PurposeInput = {
  id?: string | null;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  basis: string;
  categories: string[];
  requiresConsent: boolean;
  retentionPolicyId: string | null;
};

export async function savePurposeAction(input: PurposeInput): Promise<Res<{ id: string }>> {
  const ctx = await managerCtx();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const nameEn = (input.nameEn ?? "").trim().slice(0, 120);
  const nameAr = (input.nameAr ?? "").trim().slice(0, 120);
  if (nameEn.length < 2 || nameAr.length < 2) return { ok: false, error: "NAME" };
  const lawfulBasis = BASIS_VALUES[input.basis as keyof typeof BASIS_VALUES];
  if (!lawfulBasis) return { ok: false, error: "BASIS" };
  const categories = [...new Set((input.categories ?? []).map((c) => CATEGORY_VALUES[c as keyof typeof CATEGORY_VALUES]).filter(Boolean))];
  if (!categories.length) return { ok: false, error: "CATEGORIES" };
  if (input.retentionPolicyId && !(await ctx.db.retentionPolicy.findFirst({ where: { id: input.retentionPolicyId, orgId: ctx.orgId } }))) return { ok: false, error: "RETENTION" };
  const data = {
    nameEn,
    nameAr,
    descEn: (input.descEn ?? "").trim().slice(0, 500),
    descAr: (input.descAr ?? "").trim().slice(0, 500),
    lawfulBasis,
    dataCategories: categories,
    requiresConsent: Boolean(input.requiresConsent),
    retentionPolicyId: input.retentionPolicyId || null,
  };
  if (input.id) {
    const row = await ctx.db.processingPurpose.findFirst({ where: { id: input.id, orgId: ctx.orgId } });
    if (!row) return { ok: false, error: "NOT_FOUND" };
    await ctx.db.processingPurpose.update({ where: { id: row.id }, data });
    const changed = Object.keys(data).filter((k) => JSON.stringify((row as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k]));
    await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "purpose.update", entityType: "ProcessingPurpose", entityId: row.id, meta: { key: row.key, changed } });
    done();
    return { ok: true, id: row.id };
  }
  const base = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "purpose";
  let key = base;
  for (let i = 2; await ctx.db.processingPurpose.findFirst({ where: { orgId: ctx.orgId, key } }); i++) key = `${base}_${i}`;
  const row = await ctx.db.processingPurpose.create({ data: { orgId: ctx.orgId, key, ...data } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "purpose.create", entityType: "ProcessingPurpose", entityId: row.id, meta: { key } });
  done();
  return { ok: true, id: row.id };
}
