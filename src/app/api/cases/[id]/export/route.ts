import { NextResponse } from "next/server";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { renderChronologyPdf } from "@/server/documents/pdf";
import { caseAccess } from "@/server/access/case-access";
import { userName } from "@/lib/i18n-data";

export const runtime = "nodejs";

/** Chronology export. Safeguarding exports are DSL only and audited. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const c = await ctx.db.case.findUnique({ where: { id }, include: { student: true, notes: { include: { versions: { orderBy: { version: "desc" } } }, orderBy: { occurredAt: "asc" } } } });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const access = await caseAccess(ctx, c);
  const allowed = c.sensitivity === "SAFEGUARDING" ? ctx.can("safeguarding.export") : access.level === "full" && (ctx.can("cases.manage") || access.via === "assignee");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "case.export", entityType: "Case", entityId: c.id, sensitivity: c.sensitivity });
  const [events, referrals, decisions] = await Promise.all([
    ctx.db.timelineEvent.findMany({ where: { caseId: c.id }, orderBy: { createdAt: "asc" } }),
    ctx.db.externalReferral.findMany({ where: { caseId: c.id } }),
    ctx.db.parentNotificationDecision.findMany({ where: { caseId: c.id } }),
  ]);
  const ids = [...new Set([...c.notes.map((n) => n.authorId), ...events.map((e) => e.actorId).filter(Boolean), ...decisions.map((d) => d.decidedById)])] as string[];
  const people = await ctx.db.membership.findMany({ where: { id: { in: ids } }, include: { user: true } });
  const who = (mid: string | null) => (mid ? userName(people.find((p) => p.id === mid)?.user, "en") : "System");
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }).format(d);
  const rows = [
    ...c.notes.map((n) => ({ at: n.occurredAt, when: fmt(n.occurredAt), who: who(n.authorId), kind: `${n.kind}${n.currentVersion > 1 ? ` (amended, v${n.currentVersion})` : ""}`, text: n.versions[0]?.body ?? "" })),
    ...events.filter((e) => !e.kind.startsWith("note")).map((e) => ({ at: e.createdAt, when: fmt(e.createdAt), who: who(e.actorId), kind: "EVENT", text: [e.titleEn, e.bodyEn].filter(Boolean).join(": ") })),
    ...referrals.map((r) => ({ at: r.referredAt, when: fmt(r.referredAt), who: who(r.createdById), kind: "EXTERNAL REFERRAL", text: `${r.agencyEn}${r.referenceNo ? `, ref ${r.referenceNo}` : ""}${r.contactName ? `, contact ${r.contactName}` : ""}` })),
    ...decisions.map((d) => ({ at: d.createdAt, when: fmt(d.createdAt), who: who(d.decidedById), kind: `PARENT NOTIFICATION: ${d.decision}`, text: d.reason })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const pdf = await renderChronologyPdf({
    title: `Case chronology ${c.number}`,
    subtitle: `${c.student.firstNameEn} ${c.student.lastNameEn} · ${c.type} · ${c.sensitivity} · exported ${fmt(new Date())} by ${ctx.user.nameEn}`,
    rows: rows.map(({ when, who: w, kind, text }) => ({ when, who: w, kind, text })),
    footer: "Restricted. This export is recorded in the audit log. Do not share outside authorised staff.",
  });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${c.number}-chronology.pdf"`, "Cache-Control": "private, no-store" } });
}
