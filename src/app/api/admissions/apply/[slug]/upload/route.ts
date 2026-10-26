import { randomUUID, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { hit } from "@/server/access/rate-limit";
import { putObjectAt } from "@/server/documents/storage-core";
import { currentApplicant } from "@/server/admissions/applicant";
import { applySchoolBySlug } from "@/server/admissions/public-school";
import { loadSettings } from "@/server/admissions/settings";
import { docTypesFor, MAX_FILES_PER_APPLICATION, MAX_UPLOAD_BYTES } from "@/server/admissions/config";
import { checkUpload } from "@/server/admissions/files";
import { recordEvent } from "@/server/admissions/events";
import { BodyTooLargeError, readFormLimited } from "@/lib/http-body";
import { scanBytes, scanRefuses } from "@/server/files/scan";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A family uploads one document for their own application. The file is checked by content (documents and photos
 * only, never executables or active content), stored privately under the school's prefix, and only ever served
 * after an access check.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const school = await applySchoolBySlug(slug);
  if (!school) return json({ error: "not_found" }, 404);
  const applicant = await currentApplicant(school?.id);
  if (!applicant?.verified) return json({ error: "unauthorized" }, 401);
  const limit = await hit(`apply-upload:${applicant.userId}`, 60, 60 * 60);
  if (!limit.ok) return json({ error: "RATE_LIMITED" }, 429);
  let form: FormData | null;
  try {
    form = await readFormLimited(req, MAX_UPLOAD_BYTES + 64 * 1024);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: "TOO_LARGE" }, 413);
    throw e;
  }
  const file = form?.get("file");
  const applicationId = String(form?.get("applicationId") ?? "");
  const typeKey = String(form?.get("typeKey") ?? "");
  if (!(file instanceof File)) return json({ error: "NO_FILE" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(file.name, bytes);
  if (!check.ok) return json({ error: check.problem }, 415);
  if (scanRefuses(await scanBytes(bytes))) return json({ error: "ACTIVE_CONTENT" }, 415);

  const result = await tenantTx(school.id, async (tx) => {
    const app = await tx.admissionApplication.findFirst({ where: { id: applicationId, orgId: school.id, applicantUserId: applicant.userId } });
    if (!app) return { error: "NOT_FOUND" as const };
    if (["ENROLLED", "DECLINED", "WITHDRAWN"].includes(app.stage)) return { error: "LOCKED" as const };
    const s = await loadSettings(tx, school.id);
    if (!docTypesFor(s.docTypes, app.gradeLevel, app.nationality).some((d) => d.key === typeKey)) return { error: "TYPE_KEY" as const };
    if ((await tx.admissionDocument.count({ where: { orgId: school.id, applicationId: app.id } })) >= MAX_FILES_PER_APPLICATION) return { error: "TOO_MANY" as const };
    return { app };
  });
  if ("error" in result) return json({ error: result.error }, result.error === "NOT_FOUND" ? 404 : 400);

  const key = `${school.id}/admissions/${result.app.id}/${randomUUID()}-${check.fileName}`;
  const storageKey = await putObjectAt(key, Buffer.from(bytes), check.type.mime);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const doc = await tenantTx(school.id, async (tx) => {
    const d = await tx.admissionDocument.create({
      data: { orgId: school.id, applicationId: result.app.id, typeKey, fileName: check.fileName, mimeType: check.type.mime, sizeBytes: bytes.length, storageKey, checksum, uploadedByUserId: applicant.userId },
    });
    await recordEvent(tx, school.id, { applicationId: result.app.id, kind: "document", actorUserId: applicant.userId, data: { typeKey, status: "RECEIVED" } });
    await audit(tx, school.id, { actorUserId: applicant.userId, action: "admission.document_upload", entityType: "AdmissionDocument", entityId: d.id, meta: { typeKey, sizeBytes: bytes.length, mime: check.type.mime } });
    return d;
  });
  return json({ ok: true, doc: { id: doc.id, typeKey: doc.typeKey, fileName: doc.fileName, sizeBytes: doc.sizeBytes, status: doc.status, createdAt: doc.createdAt.toISOString() } });
}
