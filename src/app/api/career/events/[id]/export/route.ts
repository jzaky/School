import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { canManageEvents } from "@/server/career-events/access";

export const runtime = "nodejs";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Attendee list for a university fair, visit or session. Career advisors and counselors only. Audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageEvents(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const ev = await ctx.db.careerEvent.findFirst({ where: { orgId: ctx.orgId, id }, include: { registrations: { where: { status: "REGISTERED" } } } });
  if (!ev) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const students = await ctx.db.student.findMany({ where: { id: { in: ev.registrations.map((r) => r.studentId) } } });
  const rows = ev.registrations
    .map((r) => ({ r, s: students.find((s) => s.id === r.studentId)! }))
    .filter((x) => x.s)
    .sort((a, b) => a.s.gradeLevel - b.s.gradeLevel || (a.s.section ?? "").localeCompare(b.s.section ?? "") || a.s.lastNameEn.localeCompare(b.s.lastNameEn));
  const lines = [["student_no", "student", "student_ar", "grade", "registered_at_utc", "registered_by", "attended"].join(",")];
  for (const { r, s } of rows) {
    const by = r.registeredById === s.membershipId ? "student" : "family_or_staff";
    lines.push([s.studentNo, `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`, `${s.gradeLevel}${s.section ?? ""}`, r.registeredAt.toISOString(), by, r.attended === null ? "" : r.attended ? "yes" : "no"].map(cell).join(","));
  }
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "career_event.export", entityType: "CareerEvent", entityId: ev.id, meta: { rows: rows.length } });
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="career-event-${ev.startsAt.toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
