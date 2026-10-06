import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { visibleStudentIds } from "@/server/access/student-access";
import { audit } from "@/server/audit/audit";
import { buildCareerReport, careerReportAudience } from "@/server/career/report";
import { renderCareerReportPdf } from "@/server/career/report-pdf";
import { letterheadFor } from "@/server/documents/letterhead";

export const runtime = "nodejs";

/** Bilingual career guidance report for one student: the student, their parents and advising staff. Audited. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const studentId = new URL(req.url).searchParams.get("student") ?? (ctx.isStudent ? ctx.membership.student?.id : null);
  if (!studentId) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const audience = careerReportAudience({ isStudent: ctx.isStudent, isParent: ctx.isParent, isStaff: ctx.isStaff, can: ctx.can, visibleStudentIds: await visibleStudentIds(ctx) }, studentId);
  // Same answer for "not yours" and "does not exist", so ids cannot be probed.
  if (!audience) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const data = await buildCareerReport(ctx.db, ctx.orgId, studentId, audience);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const pdf = await renderCareerReportPdf(data, await letterheadFor(ctx.db, ctx.org));
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "career.report_download", entityType: "Student", entityId: studentId, meta: { audience } });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="career-report-${data.student.studentNo}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
