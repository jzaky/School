// School KPIs. Wellbeing and safeguarding cases and requests are never included (rule 6).
import type { Ctx } from "@/server/context";
import { listableCaseWhere } from "@/server/access/case-access";
import { pick } from "@/lib/i18n-data";

const EXCLUDED = ["WELLBEING", "SAFEGUARDING"] as const;

export async function schoolKpis(ctx: Ctx, days = 30) {
  const { db, orgId, locale } = ctx;
  const now = new Date();
  const since = new Date(now.getTime() - days * 86400_000);
  const prevSince = new Date(since.getTime() - days * 86400_000);
  const reqBase = { orgId, sensitivity: { notIn: [...EXCLUDED] } };
  const [thisPeriod, prevPeriod, closed, openCount, byService, services, cases, departments, appts, openCases, weekly] = await Promise.all([
    db.request.count({ where: { ...reqBase, submittedAt: { gte: since } } }),
    db.request.count({ where: { ...reqBase, submittedAt: { gte: prevSince, lt: since } } }),
    db.request.findMany({ where: { ...reqBase, completedAt: { gte: since }, status: { in: ["COMPLETED", "REJECTED"] } }, select: { submittedAt: true, completedAt: true, slaDueAt: true, serviceId: true } }),
    db.request.count({ where: { ...reqBase, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } } }),
    db.request.groupBy({ by: ["serviceId"], where: { ...reqBase, submittedAt: { gte: since } }, _count: { _all: true } }),
    db.serviceDefinition.findMany({ where: { orgId }, select: { id: true, nameEn: true, nameAr: true } }),
    db.case.groupBy({ by: ["departmentId"], where: { AND: [listableCaseWhere(ctx, "analytics"), { openedAt: { gte: new Date(now.getTime() - 120 * 86400_000) } }] }, _count: { _all: true } }),
    db.department.findMany({ where: { orgId } }),
    db.appointment.findMany({ where: { orgId, startsAt: { gte: since, lt: now } }, select: { status: true, typeId: true } }),
    db.case.count({ where: { AND: [listableCaseWhere(ctx, "analytics"), { status: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING"] } }] } }),
    db.request.findMany({ where: { ...reqBase, completedAt: { gte: new Date(now.getTime() - 12 * 7 * 86400_000) }, status: "COMPLETED" }, select: { submittedAt: true, completedAt: true } }),
  ]);
  const hours = closed.filter((c) => c.completedAt).map((c) => (c.completedAt!.getTime() - c.submittedAt.getTime()) / 3600_000);
  const avgHours = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0;
  const withSla = closed.filter((c) => c.slaDueAt && c.completedAt);
  const onTime = withSla.filter((c) => c.completedAt! <= c.slaDueAt!).length;
  const sla = withSla.length ? Math.round((onTime / withSla.length) * 100) : 100;
  const held = appts.filter((a) => a.status === "COMPLETED").length;
  const booked = appts.filter((a) => a.status !== "CANCELLED").length;
  const utilization = booked ? Math.round((held / booked) * 100) : 0;

  // Slowest services: average hours to close in the period.
  const perService = new Map<string, number[]>();
  for (const c of closed) if (c.completedAt) perService.set(c.serviceId, [...(perService.get(c.serviceId) ?? []), (c.completedAt.getTime() - c.submittedAt.getTime()) / 3600_000]);
  const slowest = [...perService.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([id, v]) => ({ id, avg: v.reduce((a, b) => a + b, 0) / v.length, count: v.length }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)
    .map((s) => {
      const svc = services.find((x) => x.id === s.id);
      return { label: svc ? pick(locale, svc.nameEn, svc.nameAr) : "", value: Math.round(s.avg), count: s.count };
    });

  // Weekly average resolution (hours) for the last 12 weeks.
  const weeks: Array<{ label: string; value: number }> = [];
  for (let w = 11; w >= 0; w--) {
    const end = new Date(now.getTime() - w * 7 * 86400_000);
    const start = new Date(end.getTime() - 7 * 86400_000);
    const inWeek = weekly.filter((r) => r.completedAt! > start && r.completedAt! <= end);
    const avg = inWeek.length ? inWeek.reduce((s, r) => s + (r.completedAt!.getTime() - r.submittedAt.getTime()) / 3600_000, 0) / inWeek.length : 0;
    weeks.push({
      label: new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" }).format(end),
      value: Math.round(avg),
    });
  }

  return {
    requests: { thisPeriod, prevPeriod, open: openCount, delta: prevPeriod ? Math.round(((thisPeriod - prevPeriod) / prevPeriod) * 100) : 0 },
    avgResolutionHours: Math.round(avgHours),
    sla,
    utilization,
    openCases,
    byService: byService
      .map((b) => {
        const svc = services.find((s) => s.id === b.serviceId);
        return { label: svc ? pick(locale, svc.nameEn, svc.nameAr) : "", value: b._count._all };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
    byDepartment: cases
      .map((c) => {
        const d = departments.find((x) => x.id === c.departmentId);
        return { label: d ? pick(locale, d.nameEn, d.nameAr) : locale === "ar" ? "غير محدد" : "Unassigned", value: c._count._all };
      })
      .sort((a, b) => b.value - a.value),
    slowest,
    weeks,
  };
}
