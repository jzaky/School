// Exam timetable publishing: sittings go on the calendar for the grade's students and parents (and the
// invigilators' own calendars), and everyone concerned is notified once per publish.
import { createHash } from "node:crypto";
import type { ExecCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { audit } from "@/server/audit/audit";
import { ensureCalendarTemplates } from "@/server/trips/templates";

const fmtDay = (d: Date, locale: "en" | "ar") =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" }).format(d);

export function sittingEventData(s: { titleEn: string; titleAr: string; gradeLevel: number; startsAt: Date; endsAt: Date; room: string | null }) {
  return {
    kind: "EXAM" as const,
    titleEn: `Grade ${s.gradeLevel} exam: ${s.titleEn}`,
    titleAr: `امتحان الصف ${s.gradeLevel}: ${s.titleAr}`,
    descEn: s.room ? `Room ${s.room}` : null,
    descAr: s.room ? `القاعة ${s.room}` : null,
    locationEn: s.room,
    locationAr: s.room,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    allDay: false,
    audience: ["student", "parent"],
    gradeLevels: [s.gradeLevel],
    published: true,
  };
}

/** Publish draft sittings. Returns how many were published and how many people were notified. */
export async function publishSittings(ec: ExecCtx, input: { sittingIds: string[]; actorId: string }) {
  const { tx, orgId } = ec;
  await ensureCalendarTemplates(tx, orgId);
  const drafts = await tx.examSitting.findMany({ where: { orgId, id: { in: input.sittingIds }, status: "DRAFT" }, orderBy: { startsAt: "asc" } });
  if (!drafts.length) return { published: 0, notified: 0 };
  for (const s of drafts) {
    const ev = await tx.calendarEvent.create({ data: { orgId, ...sittingEventData(s), ownerId: input.actorId, createdAt: ec.now } });
    await tx.examSitting.update({ where: { id: s.id }, data: { status: "PUBLISHED", calendarEventId: ev.id } });
  }
  const terms = await tx.term.findMany({ where: { orgId, id: { in: drafts.map((d) => d.termId).filter(Boolean) as string[] } } });
  let notified = 0;
  const grades = [...new Set(drafts.map((d) => d.gradeLevel))];
  for (const g of grades) {
    const list = drafts.filter((d) => d.gradeLevel === g);
    const students = await tx.student.findMany({ where: { orgId, gradeLevel: g, status: "ACTIVE" }, select: { id: true, membershipId: true } });
    const links = await tx.guardianLink.findMany({ where: { orgId, studentId: { in: students.map((s) => s.id) }, receivesUpdates: true }, include: { guardian: { select: { membershipId: true } } } });
    const recipients = [...students.map((s) => s.membershipId), ...links.map((l) => l.guardian.membershipId), ...list.flatMap((s) => s.invigilatorIds)].filter(Boolean) as string[];
    const term = terms.find((t) => t.id === list[0].termId);
    const batch = createHash("sha1").update(list.map((s) => s.id).sort().join(",")).digest("hex").slice(0, 16);
    const r = await notify(ec, {
      recipients,
      templateKey: "exam_timetable_published",
      kind: "exam_timetable",
      vars: {
        grade: String(g),
        term: { en: term?.nameEn ?? "End of term", ar: term?.nameAr ?? "نهاية الفصل" },
        count: String(list.length),
        from: { en: fmtDay(list[0].startsAt, "en"), ar: fmtDay(list[0].startsAt, "ar") },
      },
      href: "/exams",
      idempotencyBase: `exams:${g}:${batch}`,
    });
    notified += r.inApp;
  }
  await audit(tx, orgId, { actorId: input.actorId, action: "exam.publish", entityType: "ExamSitting", meta: { count: drafts.length, grades } });
  return { published: drafts.length, notified };
}
