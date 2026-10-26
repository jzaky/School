import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { currentYear } from "@/server/registration/service";
import { windowCohort } from "@/server/registration/selection";

export const runtime = "nodejs";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Progress for one course selection window as CSV: one row per student. registration.manage only. Audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ctx.can("registration.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const out = await tenantTx(
    ctx.orgId,
    async (tx) => {
      const w = await tx.courseSelectionWindow.findFirst({ where: { orgId: ctx.orgId, id } });
      if (!w) return null;
      const cohort = await windowCohort(tx, ctx.orgId, w);
      const ids = cohort.map((s) => s.id);
      const year = await currentYear(tx, ctx.orgId);
      const [homerooms, regs, offerings] = await Promise.all([
        year ? tx.enrollment.findMany({ where: { orgId: ctx.orgId, studentId: { in: ids }, class: { academicYearId: year.id, isHomeroom: true } }, include: { class: { select: { nameEn: true } } } }) : [],
        tx.subjectRegistration.findMany({ where: { orgId: ctx.orgId, academicYearId: w.academicYearId, studentId: { in: ids }, status: { in: ["REQUESTED", "ALLOCATED", "WAITLISTED"] } }, select: { studentId: true, subjectId: true } }),
        tx.subjectOffering.findMany({ where: { orgId: ctx.orgId, academicYearId: w.academicYearId, kind: "OPTION" }, select: { subjectId: true } }),
      ]);
      const optionIds = new Set(offerings.map((o) => o.subjectId));
      const subjects = new Map((await tx.subject.findMany({ where: { orgId: ctx.orgId, id: { in: [...optionIds] } }, select: { id: true, code: true } })).map((s) => [s.id, s.code]));
      const room = new Map(homerooms.map((h) => [h.studentId, h.class.nameEn]));
      const lines = [["student_no", "student", "student_ar", "grade", "homeroom", "status", "blocks_chosen", "blocks_total", "options", "last_change_by", "on_behalf", "changed_after_closing", "submitted_at_utc", "signed_off_at_utc"].join(",")];
      for (const s of [...cohort].sort((a, b) => a.gradeLevel - b.gradeLevel || (room.get(a.id) ?? "").localeCompare(room.get(b.id) ?? "") || a.lastNameEn.localeCompare(b.lastNameEn))) {
        const sub = s.progress.submission;
        const options = regs.filter((r) => r.studentId === s.id && optionIds.has(r.subjectId)).map((r) => subjects.get(r.subjectId) ?? "").filter(Boolean);
        lines.push(
          [
            s.studentNo,
            `${s.firstNameEn} ${s.lastNameEn}`,
            `${s.firstNameAr} ${s.lastNameAr}`,
            s.gradeLevel,
            room.get(s.id) ?? "",
            s.progress.status,
            s.progress.chosen,
            s.progress.blocks,
            options.join(" "),
            sub?.lastSource ? sub.lastSource.toLowerCase() : "",
            sub ? (sub.onBehalf ? "yes" : "no") : "",
            sub ? (sub.afterClose ? "yes" : "no") : "",
            sub?.submittedAt?.toISOString() ?? "",
            sub?.signedOffAt?.toISOString() ?? "",
          ]
            .map(cell)
            .join(","),
        );
      }
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "registration.window_export", entityType: "CourseSelectionWindow", entityId: w.id, meta: { rows: cohort.length } });
      return { lines, day: w.closesAt.toISOString().slice(0, 10) };
    },
    { timeout: 60_000 },
  );
  if (!out) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse("﻿" + out.lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="course-selection-${out.day}.csv"`, "Cache-Control": "private, no-store" },
  });
}
