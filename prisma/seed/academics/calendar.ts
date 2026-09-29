// Demo data for the calendar module: the academic year and terms, UAE holidays, a few events and
// deadlines, and a published end of term exam timetable for Grades 9 to 12 in the coming weeks.
// Safe to re-run: rows have stable ids or are skipped when they already exist.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SeedWorld } from "../demo";
import { at, schoolDay, stableId } from "../lib";
import { execCtx } from "../../../src/server/db";
import { proposeUaeHolidays } from "../../../src/server/calendar/uae-holidays";
import { addDays, dayKey, instant, suggestSchedule } from "../../../src/server/exams/schedule";
import { publishSittings } from "../../../src/server/exams/service";

export async function seedCalendar(w: SeedWorld) {
  await seedCalendarData(w.db, w.orgId, w.now, w.log);
}

const EXAM_SUBJECTS = ["MATH", "ENG", "ARAB", "PHYS", "CHEM", "BIO", "ISL", "CS"];
const EXAM_ROOMS = ["Exam Hall A", "Exam Hall B", "Sports Hall", "Library"];

export async function seedCalendarData(db: PrismaClient, orgId: string, now: Date, log: (m: string) => void = () => {}) {
  const tx = db as unknown as Prisma.TransactionClient;
  const personas = await db.demoPersona.findMany({ where: { orgId } });
  const admin = personas.find((p) => p.key === "admin")?.membershipId ?? null;
  const teacher = personas.find((p) => p.key === "teacher")?.membershipId ?? null;

  // Academic year and three terms (the core seed normally creates them already).
  let year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true } });
  if (!year) {
    const shifted = new Date(now.getTime() + 4 * 3600_000);
    const startYear = shifted.getUTCMonth() >= 7 ? shifted.getUTCFullYear() : shifted.getUTCFullYear() - 1;
    const d = (y: number, m: number, day: number) => instant(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`, 0);
    year = await db.academicYear.create({ data: { orgId, nameEn: `${startYear}-${startYear + 1}`, nameAr: `${startYear}-${startYear + 1}`, startsOn: d(startYear, 8, 24), endsOn: d(startYear + 1, 7, 2), isCurrent: true } });
    await db.term.createMany({
      data: [
        { orgId, academicYearId: year.id, nameEn: "Autumn term", nameAr: "الفصل الأول", startsOn: d(startYear, 8, 24), endsOn: d(startYear, 12, 12) },
        { orgId, academicYearId: year.id, nameEn: "Spring term", nameAr: "الفصل الثاني", startsOn: d(startYear + 1, 1, 5), endsOn: d(startYear + 1, 3, 27) },
        { orgId, academicYearId: year.id, nameEn: "Summer term", nameAr: "الفصل الثالث", startsOn: d(startYear + 1, 4, 13), endsOn: d(startYear + 1, 7, 2) },
      ],
    });
  }
  const terms = await db.term.findMany({ where: { orgId, academicYearId: year.id }, orderBy: { startsOn: "asc" } });

  // UAE public holidays for the year. Skip any the school already has on the calendar around that date.
  const holidays = proposeUaeHolidays(dayKey(year.startsOn), dayKey(year.endsOn));
  const existingHolidays = await db.calendarEvent.findMany({ where: { orgId, kind: "HOLIDAY" } });
  const holidayRows: Prisma.CalendarEventCreateManyInput[] = [];
  for (const h of holidays) {
    const startsAt = instant(h.startKey, 0);
    const endsAt = instant(addDays(h.startKey, h.days), 0);
    const near = existingHolidays.some((e) => e.startsAt.getTime() < endsAt.getTime() + 2 * 86400_000 && e.endsAt.getTime() > startsAt.getTime() - 2 * 86400_000);
    if (near) continue;
    holidayRows.push({
      id: stableId(orgId, "holiday", h.key),
      orgId,
      kind: "HOLIDAY",
      titleEn: h.titleEn,
      titleAr: h.titleAr,
      descEn: h.estimated ? "Estimated date. The final date depends on the moon sighting and the official announcement." : "UAE public holiday. School closed.",
      descAr: h.estimated ? "تاريخ تقديري. يعتمد التاريخ النهائي على رؤية الهلال والإعلان الرسمي." : "عطلة رسمية في دولة الإمارات. المدرسة مغلقة.",
      startsAt,
      endsAt,
      allDay: true,
      audience: ["staff", "student", "parent"],
      gradeLevels: [],
      published: true,
      ownerId: admin,
      createdAt: at(-40, 10, 0, now),
    });
  }
  // Winter and spring breaks from the term dates.
  for (let i = 1; i < terms.length; i++) {
    const from = addDays(dayKey(terms[i - 1].endsOn), 1);
    const to = dayKey(terms[i].startsOn);
    if (to <= from) continue;
    holidayRows.push({
      id: stableId(orgId, "break", terms[i].id),
      orgId,
      kind: "HOLIDAY",
      titleEn: i === 1 ? "Winter break" : "Spring break",
      titleAr: i === 1 ? "عطلة الشتاء" : "عطلة الربيع",
      descEn: "School closed for students and staff.",
      descAr: "المدرسة مغلقة للطلاب والموظفين.",
      startsAt: instant(from, 0),
      endsAt: instant(to, 0),
      allDay: true,
      audience: ["staff", "student", "parent"],
      gradeLevels: [],
      published: true,
      ownerId: admin,
      createdAt: at(-40, 10, 0, now),
    });
  }

  // Events and deadlines, some for one grade only, and one draft still being prepared.
  const ev = (key: string, e: Omit<Prisma.CalendarEventCreateManyInput, "orgId" | "id">): Prisma.CalendarEventCreateManyInput => ({ id: stableId(orgId, "cal", key), orgId, ownerId: admin, createdAt: at(-20, 11, 0, now), ...e });
  const d1 = schoolDay(4, now);
  const d2 = schoolDay(12, now);
  const d3 = schoolDay(24, now);
  const d4 = schoolDay(30, now);
  const events: Prisma.CalendarEventCreateManyInput[] = [
    ev("g9_info", { kind: "EVENT", titleEn: "Grade 9 parents' information evening", titleAr: "أمسية تعريفية لأولياء أمور الصف التاسع", descEn: "Meet the Grade 9 team, hear about the IGCSE pathway and the end of term exams.", descAr: "تعرّفوا على فريق الصف التاسع ومسار شهادة IGCSE وامتحانات نهاية الفصل.", locationEn: "Main auditorium", locationAr: "المسرح الرئيسي", startsAt: at(d1, 18, 0, now), endsAt: at(d1, 19, 30, now), allDay: false, audience: ["parent", "staff"], gradeLevels: [9], published: true }),
    ev("g11_coursework", { kind: "DEADLINE", titleEn: "Grade 11 IGCSE coursework submission", titleAr: "الموعد النهائي لتسليم أعمال IGCSE للصف الحادي عشر", descEn: "Final drafts of science and computing coursework are due to subject teachers.", descAr: "تُسلَّم النسخ النهائية لأعمال العلوم والحوسبة إلى معلمي المواد.", startsAt: at(d2, 0, 0, now), endsAt: at(d2 + 1, 0, 0, now), allDay: true, audience: ["student", "parent", "staff"], gradeLevels: [11], published: true }),
    ev("term2_fees", { kind: "DEADLINE", titleEn: "Term 2 fee payment deadline", titleAr: "الموعد النهائي لسداد رسوم الفصل الثاني", descEn: "Fees can be paid online or at the finance office.", descAr: "يمكن سداد الرسوم إلكترونياً أو في مكتب الشؤون المالية.", startsAt: at(d3, 0, 0, now), endsAt: at(d3 + 1, 0, 0, now), allDay: true, audience: ["parent", "staff"], gradeLevels: [], published: true }),
    ev("book_week", { kind: "EVENT", titleEn: "Arabic and English book week", titleAr: "أسبوع الكتاب العربي والإنجليزي", descEn: "Author visits, a book swap and reading challenges for every grade.", descAr: "زيارات لمؤلفين وتبادل للكتب وتحديات قراءة لجميع الصفوف.", locationEn: "Library", locationAr: "المكتبة", startsAt: at(d2 + 2, 0, 0, now), endsAt: at(d2 + 5, 0, 0, now), allDay: true, audience: ["staff", "student", "parent"], gradeLevels: [], published: true }),
    ev("winter_concert", { kind: "EVENT", titleEn: "Winter concert", titleAr: "الحفل الموسيقي الشتوي", descEn: "Choir, orchestra and the Grade 7 drama showcase. Programme to be confirmed.", descAr: "الجوقة والأوركسترا وعرض مسرحي لطلاب الصف السابع. سيتم تأكيد البرنامج لاحقاً.", locationEn: "Main auditorium", locationAr: "المسرح الرئيسي", startsAt: at(d4, 17, 0, now), endsAt: at(d4, 19, 0, now), allDay: false, audience: ["staff", "student", "parent"], gradeLevels: [], published: false }),
    ev("reports_deadline", { kind: "DEADLINE", titleEn: "End of term reports due", titleAr: "الموعد النهائي لتقارير نهاية الفصل", descEn: "Teachers submit report comments and grades for review.", descAr: "يسلّم المعلمون ملاحظات التقارير والدرجات للمراجعة.", startsAt: at(d4 + 4, 0, 0, now), endsAt: at(d4 + 5, 0, 0, now), allDay: true, audience: ["staff"], gradeLevels: [], published: true }),
  ];
  await db.calendarEvent.createMany({ data: [...holidayRows, ...events], skipDuplicates: true });

  // End of term exams for Grades 9 to 12, starting about three weeks from now.
  const windowStart = dayKey(at(schoolDay(15, now), 12, 0, now));
  const term = terms.find((t) => dayKey(t.startsOn) <= windowStart && dayKey(t.endsOn) >= windowStart) ?? terms[0] ?? null;
  const already = await db.examSitting.count({ where: { orgId, termId: term?.id ?? null } });
  if (!already) {
    const windowEnd = addDays(windowStart, 13);
    const allHolidays = await db.calendarEvent.findMany({ where: { orgId, kind: "HOLIDAY", published: true } });
    const blocked: string[] = [];
    for (const h of allHolidays) for (let k = dayKey(h.startsAt); k < dayKey(h.endsAt); k = addDays(k, 1)) blocked.push(k);
    const subjects = await db.subject.findMany({ where: { orgId, code: { in: EXAM_SUBJECTS } } });
    const ordered = EXAM_SUBJECTS.map((c) => subjects.find((s) => s.code === c)).filter(Boolean) as typeof subjects;
    const staff = await db.staffProfile.findMany({ where: { orgId, departmentId: { not: null }, membership: { status: "ACTIVE", roles: { some: { role: { key: "teacher" } } } } }, orderBy: { membershipId: "asc" }, take: 10 });
    const pool = [...new Set([...(teacher ? [teacher] : []), ...staff.map((s) => s.membershipId)])];
    const plan = suggestSchedule({
      windowStart,
      windowEnd,
      grades: [9, 10, 11, 12].map((g) => ({ gradeLevel: g, subjects: ordered.map((s) => ({ subjectId: s.id, durationMin: g >= 11 ? 120 : 90 })) })),
      maxPerDay: 2,
      sessions: [8 * 60 + 30, 11 * 60 + 30],
      blockedDays: blocked,
      rooms: EXAM_ROOMS,
      invigilators: pool,
      invigilatorsPerSitting: 2,
    });
    const created = await Promise.all(
      plan.sittings.map((s) => {
        const sub = ordered.find((x) => x.id === s.subjectId)!;
        return db.examSitting.create({ data: { orgId, termId: term?.id ?? null, subjectId: s.subjectId, gradeLevel: s.gradeLevel, titleEn: sub.nameEn, titleAr: sub.nameAr, startsAt: instant(s.dateKey, s.startMinute), endsAt: instant(s.dateKey, s.endMinute), room: s.room, invigilatorIds: s.invigilatorIds, createdAt: at(-5, 10, 0, now) } });
      }),
    );
    await publishSittings(execCtx(tx, orgId, { now: at(-2, 14, 0, now), quiet: true, actorId: admin }), { sittingIds: created.map((c) => c.id), actorId: admin ?? teacher ?? "" });
    log(`calendar: ${created.length} exam sittings published for Grades 9 to 12`);
  }
  log(`calendar: ${holidayRows.length + events.length} holidays, events and deadlines`);
}
