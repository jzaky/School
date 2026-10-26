import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { threadAccess } from "@/server/requests/conversation";
import { absencePrivacy, canSeeAbsenceReason } from "@/server/access/absence-access";
import { localFileHeaders, readLocal, signedUrl } from "@/server/documents/storage";
import { ownsStoredKey } from "@/server/documents/storage-core";
import { contentDisposition } from "@/lib/files/check";
import { renderSamplePdf } from "@/server/documents/pdf";
import type { FormSchema } from "@/server/forms/schema";

export const runtime = "nodejs";

/**
 * A file attached to a request form (for example a doctor's note). Same access as the request page: the request
 * must be visible and not restricted, a linked sensitive case must be open to the viewer, and private absence
 * fields follow src/server/access/absence-access.ts. Every opening is audited.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const field = new URL(req.url).searchParams.get("field") ?? "";
  const access = await threadAccess(ctx, id);
  if (!access) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const submission = access.request.submissionId ? await ctx.db.submission.findUnique({ where: { id: access.request.submissionId }, include: { formVersion: true } }) : null;
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const schema = submission.formVersion.schema as unknown as FormSchema;
  const def = schema.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields)).find((f) => f.id === field);
  const data = submission.data as Record<string, unknown>;
  const value = data[field] as { key?: string; name?: string; type?: string } | undefined;
  if (!def || def.type !== "file" || !value?.key) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // The key arrives with the form, so only files stored under this school's prefix are served.
  if (!value.key.startsWith("sample:") && !ownsStoredKey(ctx.orgId, value.key)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const privacy = absencePrivacy(access.request.service.key);
  const isPrivate = Boolean(privacy?.privateFields.includes(field));
  if (isPrivate) {
    const approver = (await ctx.db.approvalAssignee.count({ where: { membershipId: ctx.membershipId, approval: { requestId: id } } })) > 0;
    if (!canSeeAbsenceReason(ctx, access.request, data, { approver })) {
      await ctx.db.auditEvent.create({ data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "request.file.denied", entityType: "Request", entityId: id, sensitivity: "MEDICAL", meta: { field } as never } });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  await ctx.db.auditEvent.create({
    data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "request.file.view", entityType: "Request", entityId: id, sensitivity: isPrivate ? "MEDICAL" : access.sensitivity, meta: { field } as never },
  });
  const name = String(value.name ?? "attachment").slice(0, 150);
  if (value.key.startsWith("sample:")) {
    const pdf = await renderSamplePdf({ en: "Attachment", ar: "مرفق" }, { en: name, ar: name });
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Disposition": contentDisposition("inline", name), "Cache-Control": "private, no-store", "Content-Type": "application/pdf" } });
  }
  // The content type comes from the stored name (set by the upload check), never from the submitted form data.
  const signed = await signedUrl(value.key, name);
  if (signed) return NextResponse.redirect(signed, 302);
  const local = await readLocal(value.key);
  if (local) return new NextResponse(new Uint8Array(local), { headers: localFileHeaders(value.key, name, true) });
  return NextResponse.json({ error: "file_missing" }, { status: 404 });
}
