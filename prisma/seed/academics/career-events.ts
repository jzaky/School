// Demo data: university fairs, visits and info sessions (dates relative to now), registrations and attendance,
// plus three clearly generic partner resource examples (no real company names; example.* domains).
// Safe to re-run: stable ids, skipped when present.
import type { CareerEventKind, PrismaClient } from "@prisma/client";
import type { SeedWorld } from "../demo";
import { at, schoolDay, stableId } from "../lib";

export async function seedCareerEvents(w: SeedWorld) {
  await seedCareerEventsData(w.db, w.orgId, w.now);
}

type Spec = {
  key: string;
  kind: CareerEventKind;
  titleEn: string;
  titleAr: string;
  descEn: string;
  descAr: string;
  unis: string[];
  others?: string[];
  day: number;
  start: [number, number];
  end: [number, number];
  locationEn?: string;
  locationAr?: string;
  onlineUrl?: string;
  grades: number[];
  capacity: number | null;
  deadlineDay: number | null;
  register: number;
  includeAdam?: boolean;
};

export async function seedCareerEventsData(db: PrismaClient, orgId: string, now: Date) {
  const personas = await db.demoPersona.findMany({ where: { orgId } });
  const persona = (k: string) => personas.find((p) => p.key === k)?.membershipId ?? null;
  const organizer = persona("career_advisor") ?? persona("counselor") ?? persona("admin");
  if (!organizer) return;
  const adamMid = persona("student");
  const raniaMid = persona("parent");
  const adam = adamMid ? await db.student.findFirst({ where: { orgId, membershipId: adamMid } }) : null;
  const unis = await db.university.findMany({ where: { orgId: null }, select: { id: true, key: true } });
  const uni = (keys: string[]) => keys.map((k) => unis.find((u) => u.key === k)?.id).filter((x): x is string => Boolean(x));

  const specs: Spec[] = [
    {
      key: "subjects_uni_g9",
      kind: "INFO_SESSION",
      titleEn: "Choosing GCSE options with university in mind",
      titleAr: "اختيار المواد الاختيارية مع التفكير في الجامعة",
      descEn: "Admissions staff from three UAE universities explain how the subjects you choose now open or close degree routes later. Bring your options form and your questions. Parents are welcome.",
      descAr: "يشرح موظفو القبول من ثلاث جامعات في الإمارات كيف تفتح المواد التي تختارها الآن مسارات جامعية لاحقًا أو تغلقها. أحضر نموذج المواد الاختيارية وأسئلتك. أولياء الأمور مرحب بهم.",
      unis: ["khalifa_university", "uae_university", "sorbonne_abu_dhabi"],
      others: ["Local college admissions office"],
      day: schoolDay(3, now),
      start: [13, 30],
      end: [14, 30],
      locationEn: "Auditorium, Main building",
      locationAr: "المسرح، المبنى الرئيسي",
      grades: [9, 10],
      capacity: 40,
      deadlineDay: schoolDay(2, now),
      register: 26,
      includeAdam: true,
    },
    {
      key: "nyuad_visit",
      kind: "UNIVERSITY_VISIT",
      titleEn: "NYU Abu Dhabi admissions visit",
      titleAr: "زيارة فريق القبول في جامعة نيويورك أبوظبي",
      descEn: "A small-group conversation with an admissions officer about the liberal arts model, financial aid and what makes a strong application. Places are limited.",
      descAr: "حوار في مجموعة صغيرة مع مسؤول قبول حول نموذج الفنون الحرة والمساعدات المالية وما يجعل الطلب قويًا. المقاعد محدودة.",
      unis: ["nyu_abu_dhabi"],
      day: schoolDay(5, now),
      start: [11, 0],
      end: [12, 0],
      locationEn: "Library seminar room",
      locationAr: "قاعة الندوات في المكتبة",
      grades: [11, 12],
      capacity: 30,
      deadlineDay: schoolDay(3, now),
      register: 28,
    },
    {
      key: "ucas_online",
      kind: "INFO_SESSION",
      titleEn: "Applying to UK universities through UCAS",
      titleAr: "التقديم إلى الجامعات البريطانية عبر UCAS",
      descEn: "An online session on the UCAS timeline, the personal statement, references and admissions tests, with time for questions at the end.",
      descAr: "جلسة عبر الإنترنت حول الجدول الزمني لنظام UCAS والبيان الشخصي والتوصيات واختبارات القبول، مع وقت للأسئلة في النهاية.",
      unis: ["kings_college_london", "manchester", "edinburgh", "warwick"],
      day: schoolDay(8, now),
      start: [18, 0],
      end: [19, 15],
      onlineUrl: "https://meet.example.org/horizon-ucas-evening",
      grades: [11, 12],
      capacity: null,
      deadlineDay: null,
      register: 34,
    },
    {
      key: "uae_fair",
      kind: "FAIR",
      titleEn: "UAE universities fair",
      titleAr: "معرض الجامعات في الإمارات",
      descEn: "Stands from universities across the UAE in the sports hall. Talk to admissions teams about programmes, scholarships and entry requirements for your curriculum.",
      descAr: "أجنحة لجامعات من مختلف أنحاء الإمارات في الصالة الرياضية. تحدث مع فرق القبول عن البرامج والمنح وشروط القبول لمنهجك.",
      unis: ["aud", "american_university_sharjah", "khalifa_university", "heriot_watt_dubai", "birmingham_dubai", "middlesex_dubai", "rit_dubai", "wollongong_dubai", "zayed_university"],
      day: schoolDay(14, now),
      start: [9, 30],
      end: [12, 30],
      locationEn: "Sports hall",
      locationAr: "الصالة الرياضية",
      grades: [10, 11, 12],
      capacity: 200,
      deadlineDay: schoolDay(12, now),
      register: 61,
    },
    {
      key: "canada_evening",
      kind: "INFO_SESSION",
      titleEn: "Studying in Canada: information evening",
      titleAr: "الدراسة في كندا: أمسية تعريفية",
      descEn: "Admissions representatives on applying to Canadian universities from the UAE, study permits and costs.",
      descAr: "ممثلو القبول يتحدثون عن التقديم إلى الجامعات الكندية من الإمارات وتصاريح الدراسة والتكاليف.",
      unis: ["university_of_toronto", "ubc", "mcgill", "waterloo"],
      day: -20,
      start: [17, 30],
      end: [19, 0],
      locationEn: "Auditorium, Main building",
      locationAr: "المسرح، المبنى الرئيسي",
      grades: [11, 12],
      capacity: 80,
      deadlineDay: null,
      register: 14,
    },
  ];
  for (const s of specs) {
    const id = stableId(orgId, "career_event", s.key);
    if (await db.careerEvent.findUnique({ where: { id } })) continue;
    const startsAt = at(s.day, s.start[0], s.start[1], now);
    const endsAt = at(s.day, s.end[0], s.end[1], now);
    const createdAt = new Date(Math.min(now.getTime(), startsAt.getTime()) - 18 * 86_400_000);
    const calId = stableId(orgId, "career_event_cal", s.key);
    await db.calendarEvent.create({
      data: {
        id: calId,
        orgId,
        kind: "EVENT",
        titleEn: s.titleEn,
        titleAr: s.titleAr,
        descEn: s.descEn,
        descAr: s.descAr,
        locationEn: s.locationEn ?? "Online",
        locationAr: s.locationAr ?? "عبر الإنترنت",
        startsAt,
        endsAt,
        allDay: false,
        audience: ["staff", "student", "parent"],
        gradeLevels: s.grades,
        published: true,
        ownerId: organizer,
        createdAt,
      },
    });
    await db.careerEvent.create({
      data: {
        id,
        orgId,
        kind: s.kind,
        titleEn: s.titleEn,
        titleAr: s.titleAr,
        descEn: s.descEn,
        descAr: s.descAr,
        universityIds: uni(s.unis),
        otherUniversities: s.others ?? [],
        startsAt,
        endsAt,
        locationEn: s.locationEn ?? null,
        locationAr: s.locationAr ?? null,
        onlineUrl: s.onlineUrl ?? null,
        gradeLevels: s.grades,
        capacity: s.capacity,
        registrationDeadline: s.deadlineDay === null ? null : at(s.deadlineDay, 23, 59, now),
        organizerId: organizer,
        calendarEventId: calId,
        createdAt,
      },
    });
    await db.auditEvent.create({ data: { orgId, actorId: organizer, action: "career_event.create", entityType: "CareerEvent", entityId: id, meta: { kind: s.kind, grades: s.grades, capacity: s.capacity }, createdAt } });

    // Registrations: a stable selection of students in the grades (Adam first when the session is for him).
    const pool = await db.student.findMany({ where: { orgId, status: "ACTIVE", gradeLevel: { in: s.grades } }, select: { id: true, membershipId: true }, orderBy: { studentNo: "asc" } });
    const chosen = pool.filter((p) => !adam || p.id !== adam.id).filter((_, i) => i % 2 === 0 || pool.length < s.register * 2).slice(0, s.register - (s.includeAdam && adam ? 1 : 0));
    if (s.includeAdam && adam) chosen.unshift({ id: adam.id, membershipId: adam.membershipId });
    const past = endsAt < now;
    const regs = chosen.map((p, i) => ({
      orgId,
      eventId: id,
      studentId: p.id,
      status: "REGISTERED" as const,
      registeredById: p.id === adam?.id && raniaMid ? raniaMid : (p.membershipId ?? organizer),
      registeredAt: new Date(createdAt.getTime() + (i + 1) * 3 * 3_600_000),
      attended: past ? i % 6 !== 5 : null,
      attendanceMarkedAt: past ? endsAt : null,
      attendanceMarkedById: past ? organizer : null,
    }));
    if (regs.length) await db.careerEventRegistration.createMany({ data: regs, skipDuplicates: true });
  }

  // Partner resources: generic examples only, marked as examples.
  const partners = [
    {
      key: "vr",
      nameEn: "Example: virtual career experiences",
      nameAr: "مثال: تجارب مهنية افتراضية",
      descEn: "Short virtual reality sessions that let students try a day in different jobs. Replace this example with your school's own partner.",
      descAr: "جلسات قصيرة بالواقع الافتراضي تتيح للطلاب تجربة يوم في وظائف مختلفة. استبدل هذا المثال بشريك مدرستك.",
      category: "career_experience",
      url: "https://example.com/career-experiences",
      audience: ["student"],
      clicks: 34,
    },
    {
      key: "advisor",
      nameEn: "Example: independent university advisor",
      nameAr: "مثال: مستشار جامعي مستقل",
      descEn: "One-to-one advice for families on applications abroad. Replace this example with a provider your school works with.",
      descAr: "استشارات فردية للأسر حول التقديم للجامعات في الخارج. استبدل هذا المثال بمقدم خدمة تتعامل معه مدرستك.",
      category: "advising",
      url: "https://example.org/university-advising",
      audience: ["student", "parent"],
      clicks: 12,
    },
    {
      key: "testprep",
      nameEn: "Example: admissions test preparation",
      nameAr: "مثال: التحضير لاختبارات القبول",
      descEn: "Practice courses for common admissions and English tests. Replace this example with your school's own partner.",
      descAr: "دورات تدريبية لاختبارات القبول واللغة الإنجليزية الشائعة. استبدل هذا المثال بشريك مدرستك.",
      category: "test_prep",
      url: "https://example.net/test-preparation",
      audience: ["student", "parent"],
      clicks: 21,
    },
  ];
  const admin = persona("admin");
  for (const p of partners) {
    const id = stableId(orgId, "partner", p.key);
    if (await db.partnerResource.findUnique({ where: { id } })) continue;
    await db.partnerResource.create({
      data: { id, orgId, nameEn: p.nameEn, nameAr: p.nameAr, descEn: p.descEn, descAr: p.descAr, category: p.category, url: p.url, audience: p.audience, active: true, isExample: true, clickCount: p.clicks, createdById: admin, createdAt: new Date(now.getTime() - 45 * 86_400_000) },
    });
  }
}
