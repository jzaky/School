import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { letterheadFor } from "@/server/documents/letterhead";
import { gradeLevelValues } from "@/lib/grade-levels";
import { attViewer } from "@/server/attendance/registers";
import { resolveRange, studentSummary } from "@/server/attendance/reports";
import { localClock } from "@/server/attendance/settings";
import { renderCertificatePdf } from "@/server/attendance/certificate-pdf";

export const runtime = "nodejs";

/** Attendance certificate PDF for one student and period (attendance.view_all or attendance.manage). Audited. */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.isStaff || !(ctx.can("attendance.view_all") || ctx.can("attendance.manage"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const studentId = q.get("student") ?? "";
  const student = studentId ? await ctx.db.student.findUnique({ where: { id: studentId }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, studentNo: true, gradeLevel: true } }) : null;
  if (!student) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const v = attViewer(ctx);
  const today = localClock(new Date(), v.timezone).dateKey;
  const { range } = await resolveRange(ctx.db, { termId: q.get("term"), from: q.get("from"), to: q.get("to") }, today);
  const lang = q.get("lang") === "ar" ? "ar" : "en";
  const [summary, homeroom, tEn, tAr] = await Promise.all([
    studentSummary(ctx.db, studentId, range),
    ctx.db.enrollment.findFirst({ where: { studentId, status: "ACTIVE", class: { isHomeroom: true, academicYear: { isCurrent: true } } }, select: { class: { select: { nameEn: true, nameAr: true } } } }),
    getTranslations({ locale: "en", namespace: "gradeLevel" }),
    getTranslations({ locale: "ar", namespace: "gradeLevel" }),
  ]);
  const reference = `ATT-${student.studentNo}-${range.to.replace(/-/g, "")}`;
  const pdf = await renderCertificatePdf(
    {
      lang,
      reference,
      student: {
        en: `${student.firstNameEn} ${student.lastNameEn}`,
        ar: `${student.firstNameAr || student.firstNameEn} ${student.lastNameAr || student.lastNameEn}`,
        studentNo: student.studentNo,
        grade: { en: tEn("label", gradeLevelValues(student.gradeLevel)), ar: tAr("label", gradeLevelValues(student.gradeLevel)) },
        homeroom: homeroom ? { en: homeroom.class.nameEn, ar: homeroom.class.nameAr } : null,
      },
      from: range.from,
      to: range.to,
      tally: summary.tally,
      issuedAt: new Date(),
      issuer: { en: ctx.user.nameEn, ar: ctx.user.nameAr ?? ctx.user.nameEn, titleEn: ctx.membership.titleEn ?? ctx.membership.staffProfile?.jobTitleEn ?? null, titleAr: ctx.membership.titleAr ?? ctx.membership.staffProfile?.jobTitleAr ?? null },
    },
    await letterheadFor(ctx.db, ctx.org),
  );
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "attendance.certificate", entityType: "Student", entityId: student.id, meta: { from: range.from, to: range.to, lang, reference } });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="attendance-certificate-${student.studentNo}-${lang}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
