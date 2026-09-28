"use server";

import { revalidatePath } from "next/cache";
import type { Sensitivity } from "@prisma/client";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { caseAccess } from "@/server/access/case-access";
import { canOpenDocument } from "@/server/access/document-access";
import { notify } from "@/server/notify/notify";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";

type FileRef = { key: string; name: string; size: number; type: string };

const RANK: Sensitivity[] = ["STANDARD", "CONFIDENTIAL", "MEDICAL", "WELLBEING", "SAFEGUARDING"];
const higher = (a: Sensitivity, b: Sensitivity) => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);

function ownKey(orgId: string, key: string) {
  return (key.startsWith("local:") || key.startsWith("r2:")) && key.split(":")[1].startsWith(`${orgId}/`);
}

/** Store an uploaded file as a document. Sensitivity follows the category and any linked case, whichever is stricter. */
export async function createDocumentAction(input: {
  file: FileRef;
  titleEn: string;
  titleAr?: string;
  categoryId?: string | null;
  studentId?: string | null;
  caseId?: string | null;
  visibleToFamily?: boolean;
  expiresAt?: string | null;
}) {
  const ctx = await getCtx();
  if (!ctx.isStaff || !(ctx.can("documents.manage") || ctx.can("documents.view"))) return { ok: false as const, error: "FORBIDDEN" };
  if (!ownKey(ctx.orgId, input.file.key)) return { ok: false as const, error: "BAD_FILE" };
  const title = input.titleEn.trim();
  if (!title) return { ok: false as const, error: "TITLE" };

  let sensitivity: Sensitivity = "STANDARD";
  const category = input.categoryId ? await ctx.db.documentCategory.findUnique({ where: { id: input.categoryId } }) : null;
  if (category) sensitivity = category.sensitivity;
  let studentId = input.studentId || null;
  if (input.caseId) {
    const c = await ctx.db.case.findUnique({ where: { id: input.caseId } });
    if (!c) return { ok: false as const, error: "NOT_FOUND" };
    const access = await caseAccess(ctx, c);
    if (access.level !== "full") return { ok: false as const, error: "FORBIDDEN" };
    sensitivity = higher(sensitivity, c.sensitivity);
    studentId = c.studentId;
  }
  // Families never see sensitive material through the documents list.
  const visibleToFamily = !!input.visibleToFamily && !!studentId && (sensitivity === "STANDARD");

  const titleAr = input.titleAr?.trim() || title;
  const effects: Effect[] = [];
  const id = await tenantTx(ctx.orgId, async (tx) => {
    const doc = await tx.document.create({
      data: {
        orgId: ctx.orgId,
        titleEn: title,
        titleAr,
        categoryId: category?.id ?? null,
        studentId,
        caseId: input.caseId || null,
        sensitivity,
        source: "UPLOAD",
        uploadedById: ctx.membershipId,
        visibleToFamily,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    const version = await tx.documentVersion.create({
      data: { orgId: ctx.orgId, documentId: doc.id, version: 1, storageKey: input.file.key, fileName: input.file.name, mimeType: input.file.type || "application/octet-stream", sizeBytes: input.file.size, createdById: ctx.membershipId },
    });
    await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "document.upload", entityType: "Document", entityId: doc.id, sensitivity });
    if (input.caseId) {
      await tx.timelineEvent.create({ data: { orgId: ctx.orgId, caseId: input.caseId, studentId, actorId: ctx.membershipId, kind: "document", titleEn: `Document added: ${title}`, titleAr: `تمت إضافة مستند: ${titleAr}`, staffOnly: true, sensitivity } });
    }
    if (visibleToFamily && studentId) {
      const student = await tx.student.findUnique({ where: { id: studentId }, select: { membershipId: true, guardians: { where: { receivesUpdates: true }, select: { guardian: { select: { membershipId: true } } } } } });
      const recipients = [student?.membershipId, ...(student?.guardians.map((g) => g.guardian.membershipId) ?? [])].filter(Boolean) as string[];
      await notify(execCtx(tx, ctx.orgId, { effects }), {
        recipients,
        templateKey: "document_ready",
        vars: { title: { en: title, ar: titleAr } },
        href: "/documents",
        idempotencyBase: `document:${doc.id}:shared`,
      });
    }
    return doc.id;
  });
  await flushEffects(effects);
  revalidatePath("/[locale]/documents", "page");
  return { ok: true as const, id };
}

/** Upload a new version of an existing document. Earlier versions stay available. */
export async function addVersionAction(input: { documentId: string; file: FileRef }) {
  const ctx = await getCtx();
  if (!ctx.isStaff) return { ok: false as const, error: "FORBIDDEN" };
  if (!ownKey(ctx.orgId, input.file.key)) return { ok: false as const, error: "BAD_FILE" };
  const doc = await ctx.db.document.findUnique({ where: { id: input.documentId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!doc || doc.source !== "UPLOAD") return { ok: false as const, error: "NOT_FOUND" };
  if (!(await canOpenDocument(ctx, doc)) || !(ctx.can("documents.manage") || doc.uploadedById === ctx.membershipId)) return { ok: false as const, error: "FORBIDDEN" };
  const next = (doc.versions[0]?.version ?? 0) + 1;
  const version = await ctx.db.documentVersion.create({
    data: { orgId: ctx.orgId, documentId: doc.id, version: next, storageKey: input.file.key, fileName: input.file.name, mimeType: input.file.type || "application/octet-stream", sizeBytes: input.file.size, createdById: ctx.membershipId },
  });
  await ctx.db.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "document.version", entityType: "Document", entityId: doc.id, sensitivity: doc.sensitivity, meta: { version: next } });
  revalidatePath("/[locale]/documents", "page");
  return { ok: true as const, version: next };
}

/** Share or unshare a standard document with the student's family. */
export async function setFamilyVisibilityAction(input: { documentId: string; visible: boolean }) {
  const ctx = await getCtx();
  if (!ctx.can("documents.manage")) return { ok: false as const, error: "FORBIDDEN" };
  const doc = await ctx.db.document.findUnique({ where: { id: input.documentId } });
  if (!doc || !doc.studentId) return { ok: false as const, error: "NOT_FOUND" };
  if (input.visible && doc.sensitivity !== "STANDARD") return { ok: false as const, error: "SENSITIVE" };
  await ctx.db.document.update({ where: { id: doc.id }, data: { visibleToFamily: input.visible } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: input.visible ? "document.share_family" : "document.unshare_family", entityType: "Document", entityId: doc.id, sensitivity: doc.sensitivity });
  revalidatePath("/[locale]/documents", "page");
  return { ok: true as const };
}
