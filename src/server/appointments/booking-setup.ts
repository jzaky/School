import type { Ctx } from "@/server/context";
import { initials, pick, userName } from "@/lib/i18n-data";

export type BookingHost = { id: string; name: string; title: string; initials: string; detail?: string };
export type BookingSetup = {
  type: { id: string; key: string; name: string; description: string; durationMin: number; location: string; hostMode: "SPECIFIC" | "ROUND_ROBIN"; color: string };
  hosts: BookingHost[];
  studentId: string | null;
};

/** Everything the booking picker needs: the appointment type and who can be booked. */
export async function loadBookingSetup(ctx: Ctx, typeKey: string, studentId: string | null): Promise<BookingSetup | null> {
  const { db, orgId, locale } = ctx;
  const type = await db.appointmentType.findUnique({ where: { orgId_key: { orgId, key: typeKey } }, include: { hosts: true } });
  if (!type || !type.isActive) return null;
  let hostIds = type.hosts.map((h) => h.membershipId);
  const detail = new Map<string, string>();
  if (type.key === "parent_teacher_meeting" && studentId) {
    const enrollments = await db.enrollment.findMany({ where: { orgId, studentId }, include: { class: { include: { subject: true } } } });
    const teacherIds = new Set<string>();
    for (const e of enrollments) {
      const tid = e.class.teacherMembershipId;
      if (!tid || !hostIds.includes(tid)) continue;
      teacherIds.add(tid);
      const label = e.class.isHomeroom ? (locale === "ar" ? "مربي الفصل" : "Homeroom tutor") : pick(locale, e.class.subject?.nameEn, e.class.subject?.nameAr);
      detail.set(tid, [detail.get(tid), label].filter(Boolean).join(" · "));
    }
    hostIds = [...teacherIds];
  }
  const members = await db.membership.findMany({ where: { id: { in: hostIds }, status: "ACTIVE" }, include: { user: true, staffProfile: true } });
  const hosts = members
    .map((m) => ({
      id: m.id,
      name: userName(m.user, locale),
      title: pick(locale, m.staffProfile?.jobTitleEn, m.staffProfile?.jobTitleAr),
      initials: initials(m.user.nameEn),
      detail: detail.get(m.id),
    }))
    .sort((a, b) => (a.detail ?? "").localeCompare(b.detail ?? "") || a.name.localeCompare(b.name));
  return {
    type: {
      id: type.id,
      key: type.key,
      name: pick(locale, type.nameEn, type.nameAr),
      description: pick(locale, type.descEn, type.descAr),
      durationMin: type.durationMin,
      location: pick(locale, type.locationEn, type.locationAr),
      hostMode: type.hostMode,
      color: type.color,
    },
    hosts,
    studentId,
  };
}
