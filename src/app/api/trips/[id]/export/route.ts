import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { canManageTrip } from "@/server/trips/access";

export const runtime = "nodejs";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Trip-day list: every participant with consent status and a guardian contact. Organisers only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const trip = await ctx.db.trip.findUnique({ where: { id }, include: { participants: true } });
  if (!trip) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canManageTrip(ctx, trip)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const studentIds = trip.participants.map((p) => p.studentId);
  const [students, links, deciders] = await Promise.all([
    ctx.db.student.findMany({ where: { id: { in: studentIds } } }),
    ctx.db.guardianLink.findMany({ where: { studentId: { in: studentIds } }, include: { guardian: true }, orderBy: { isPrimary: "desc" } }),
    ctx.db.membership.findMany({ where: { id: { in: trip.participants.map((p) => p.decidedById).filter(Boolean) as string[] } }, include: { user: true } }),
  ]);
  const lines = [["student_no", "student", "grade", "consent", "decided_by", "decided_at_utc", "note", "guardian", "guardian_phone"].join(",")];
  const rows = trip.participants
    .map((p) => ({ p, s: students.find((s) => s.id === p.studentId)! }))
    .filter((r) => r.s)
    .sort((a, b) => a.s.gradeLevel - b.s.gradeLevel || (a.s.section ?? "").localeCompare(b.s.section ?? "") || a.s.lastNameEn.localeCompare(b.s.lastNameEn));
  for (const { p, s } of rows) {
    const g = links.find((l) => l.studentId === s.id)?.guardian;
    const d = deciders.find((m) => m.id === p.decidedById);
    lines.push([s.studentNo, `${s.firstNameEn} ${s.lastNameEn}`, `${s.gradeLevel}${s.section ?? ""}`, p.consent, d?.user.nameEn ?? "", p.decidedAt?.toISOString() ?? "", p.noteEn ?? "", g ? `${g.firstNameEn} ${g.lastNameEn}` : "", g?.phone ?? ""].map(cell).join(","));
  }
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "trip.export", entityType: "Trip", entityId: trip.id, meta: { rows: rows.length } });
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trip-${trip.startsAt.toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
