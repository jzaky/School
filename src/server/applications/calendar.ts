import "server-only";
import type { Ctx } from "@/server/context";
import type { CalItem } from "@/server/calendar/items";
import { tenantTx } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { deadlinesFor, appHref } from "./service";
import { CLOSED_STAGES, type Stage } from "./types";

/** Application deadlines for the calendar: a student's own (or a parent's children's) and a counselor's caseload. */
export async function applicationCalendarItems(ctx: Ctx, from: Date, to: Date, scope: { studentIds: string[]; counselorIds: string[] }): Promise<CalItem[]> {
  if (!scope.studentIds.length && !scope.counselorIds.length) return [];
  if (!ctx.can("pathways.view") && !ctx.can("applications.manage")) return [];
  const OR = [...(scope.studentIds.length ? [{ studentId: { in: scope.studentIds } }] : []), ...(scope.counselorIds.length && ctx.can("applications.manage") ? [{ counselorId: { in: scope.counselorIds } }] : [])];
  if (!OR.length) return [];
  return tenantTx(ctx.orgId, async (tx) => {
    const apps = await tx.application.findMany({ where: { orgId: ctx.orgId, OR, stage: { notIn: CLOSED_STAGES as Stage[] } }, take: 300 });
    if (!apps.length) return [];
    const [dl, unis] = await Promise.all([deadlinesFor(tx, apps), tx.university.findMany({ where: { id: { in: [...new Set(apps.map((a) => a.universityId))] } }, select: { id: true, nameEn: true, nameAr: true } })]);
    const items: CalItem[] = [];
    for (const a of apps) {
      // Only the deadline that matters for this application; submitted ones are done with it.
      const d = dl.get(a.id)?.primary;
      if (!d || ["SUBMITTED", "INTERVIEW", "OFFER", "WAITLISTED"].includes(a.stage)) continue;
      if (d.date < from || d.date >= to) continue;
      const u = unis.find((x) => x.id === a.universityId);
      const title = pick(ctx.locale, `Application deadline: ${u?.nameEn ?? ""}`, `موعد التقديم: ${u?.nameAr ?? u?.nameEn ?? ""}`);
      items.push({ id: `app-${a.id}`, kind: "deadline", title, start: d.date.toISOString(), end: d.date.toISOString(), allDay: true, href: appHref(a.id), color: "#7C3AED" });
    }
    return items;
  });
}
