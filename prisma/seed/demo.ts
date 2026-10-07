// Demo tenant seed: Horizon International School Dubai.
// Re-runnable. Wipes every row of the demo organization (the organization row keeps its id)
// and rebuilds a bilingual school with months of history, all dates relative to now.
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";
import { encryptField } from "@/lib/crypto";
import type { FormSchema } from "@/server/forms/schema";
import { execCtx } from "@/server/db";
import { at, dateOnly, emailFor, id, isSchoolDay, rng, schoolDay, stableId, wipeTenant } from "./lib";
import { FAMILIES, STAFF, type Bi } from "./data/people";
import { ANNOUNCEMENTS, CALENDAR_EVENTS } from "./data/content";
import { SERVICES } from "./data/services";
import { FORM_TEMPLATES } from "./data/forms";
import { APPOINTMENT_TYPES, DEFAULT_AVAILABILITY } from "./data/scheduling";
import { seedHistory } from "./history";
import { seedCompliance } from "./compliance";
import { seedCareer } from "./career";
import { seedRegistration } from "./academics/registration";
import { seedTimetable } from "./academics/timetable";
import { seedGrades } from "./academics/grades";
import { seedTrips } from "./academics/trips";
import { seedCalendar } from "./academics/calendar";
import { seedPathways } from "./academics/pathways";
import { seedApplications } from "./academics/applications";
import { seedCareerEvents } from "./academics/career-events";
import { seedCurriculum } from "./academics/curriculum";
import { seedPathwayEngine } from "./academics/pathway-engine";
import { seedTranscripts } from "./academics/transcripts";
import { seedGlobalCatalog } from "./catalog";
import { seedAccess } from "./access";
import { seedGroupDemo } from "./groups";
import { academicStartYear, installStarterTemplate } from "./starter";

export const DEMO_SLUG = "horizon";
export const DEMO_PASSWORD = "Horizon2026!";

export type SeedPerson = {
  userId: string;
  membershipId: string;
  email: string;
  name: Bi;
  first: Bi;
  last: Bi;
  gender: "F" | "M";
};

export type SeedStaff = SeedPerson & {
  key: string;
  roles: string[];
  department: string | null;
  subjects: string[];
  gradeLevels: number[];
  jobTitle: Bi;
};

export type SeedStudent = {
  id: string;
  membershipId: string;
  userId: string;
  first: Bi;
  last: Bi;
  grade: number;
  section: string;
  gender: "F" | "M";
  nationality: Bi;
  familyIndex: number;
  classIds: string[];
  subjects: string[];
};

export type SeedGuardian = SeedPerson & { id: string; familyIndex: number; phone: string; studentIds: string[] };

export type SeedWorld = {
  db: PrismaClient;
  orgId: string;
  now: Date;
  staff: Map<string, SeedStaff>;
  students: SeedStudent[];
  guardians: SeedGuardian[];
  studentById: Map<string, SeedStudent>;
  services: Map<string, { id: string; key: string; formVersionId: string | null; schema: FormSchema | null; nameEn: string; nameAr: string; prefix: string; sensitivity: string; workflowVersionId: string | null }>;
  subjects: Map<string, { id: string; departmentId: string | null }>;
  departments: Map<string, string>;
  appointmentTypes: Map<string, { id: string; durationMin: number; locationEn: string; locationAr: string }>;
  careers: Map<string, string>;
  universities: Map<string, string>;
  categories: Map<string, string>;
  templates: Map<string, string>;
  classes: Array<{ id: string; grade: number; subject: string | null; section: string | null; teacherId: string | null; homeroom: boolean }>;
  personas: Record<string, string>; // persona key -> membership id
  adam: SeedStudent;
  yara: SeedStudent;
  rania: SeedGuardian;
  karim: SeedGuardian;
  log: (msg: string) => void;
};

const bi = (en: string, ar: string): Bi => ({ en, ar });

const PERSONA_STAFF: Array<{
  key: string;
  persona: string;
  first: Bi;
  last: Bi;
  gender: "F" | "M";
  roles: string[];
  jobTitle: Bi;
  department: string | null;
  subjects: string[];
  gradeLevels: number[];
}> = [
  {
    key: "aisha_rahman",
    persona: "admin",
    first: bi("Aisha", "عائشة"),
    last: bi("Rahman", "الرحمن"),
    gender: "F",
    roles: ["school_admin"],
    jobTitle: bi("School Administrator", "مسؤولة إدارة المدرسة"),
    department: "administration",
    subjects: [],
    gradeLevels: [],
  },
  {
    key: "omar_al_mansoori",
    persona: "principal",
    first: bi("Omar", "عمر"),
    last: bi("Al Mansoori", "المنصوري"),
    gender: "M",
    roles: ["principal"],
    jobTitle: bi("Principal", "مدير المدرسة"),
    department: "administration",
    subjects: [],
    gradeLevels: [],
  },
  {
    key: "sarah_ahmed",
    persona: "counselor",
    first: bi("Sarah", "سارة"),
    last: bi("Ahmed", "أحمد"),
    gender: "F",
    roles: ["counselor"],
    jobTitle: bi("School Counselor, Grades 6 to 10", "المرشدة الطلابية للصفوف من 6 إلى 10"),
    department: "student_services",
    subjects: [],
    gradeLevels: [6, 7, 8, 9, 10],
  },
  {
    key: "layla_hassan",
    persona: "career_advisor",
    first: bi("Layla", "ليلى"),
    last: bi("Hassan", "حسن"),
    gender: "F",
    roles: ["career_advisor"],
    jobTitle: bi("Career and University Advisor", "مستشارة التوجيه المهني والجامعي"),
    department: "student_services",
    subjects: [],
    gradeLevels: [8, 9, 10, 11, 12],
  },
  {
    key: "daniel_carter",
    persona: "teacher",
    first: bi("Daniel", "دانيال"),
    last: bi("Carter", "كارتر"),
    gender: "M",
    roles: ["teacher"],
    jobTitle: bi("Physics Teacher and Grade 9A Homeroom Tutor", "معلم الفيزياء ومربي الصف 9A"),
    department: "science",
    subjects: ["PHYS"],
    gradeLevels: [9],
  },
  {
    key: "khalid_yousef",
    persona: "dsl",
    first: bi("Khalid", "خالد"),
    last: bi("Yousef", "يوسف"),
    gender: "M",
    roles: ["dsl"],
    jobTitle: bi("Designated Safeguarding Lead", "مسؤول حماية الطفل المعيّن"),
    department: "student_services",
    subjects: [],
    gradeLevels: [],
  },
];

const SUBJECTS: Array<{ code: string; dept: string; name: Bi }> = [
  { code: "MATH", dept: "mathematics", name: bi("Mathematics", "الرياضيات") },
  { code: "PHYS", dept: "science", name: bi("Physics", "الفيزياء") },
  { code: "CHEM", dept: "science", name: bi("Chemistry", "الكيمياء") },
  { code: "BIO", dept: "science", name: bi("Biology", "الأحياء") },
  { code: "CS", dept: "computing", name: bi("Computer Science", "علوم الحاسوب") },
  { code: "ENG", dept: "english", name: bi("English", "اللغة الإنجليزية") },
  { code: "ARAB", dept: "arabic_islamic", name: bi("Arabic", "اللغة العربية") },
  { code: "ISL", dept: "arabic_islamic", name: bi("Islamic Education", "التربية الإسلامية") },
  { code: "SOC", dept: "arabic_islamic", name: bi("UAE Social Studies", "الدراسات الاجتماعية الإماراتية") },
  { code: "ECON", dept: "humanities", name: bi("Economics", "الاقتصاد") },
  { code: "BUS", dept: "humanities", name: bi("Business Studies", "إدارة الأعمال") },
  { code: "GEO", dept: "humanities", name: bi("Geography", "الجغرافيا") },
  { code: "HIST", dept: "humanities", name: bi("History", "التاريخ") },
  { code: "PSY", dept: "humanities", name: bi("Psychology", "علم النفس") },
  { code: "FR", dept: "humanities", name: bi("French", "اللغة الفرنسية") },
  { code: "ART", dept: "arts", name: bi("Art and Design", "الفنون والتصميم") },
  { code: "DT", dept: "arts", name: bi("Design and Technology", "التصميم والتكنولوجيا") },
  { code: "MUSIC", dept: "arts", name: bi("Music", "الموسيقى") },
  { code: "PE", dept: "pe", name: bi("Physical Education", "التربية الرياضية") },
];

/** Core subjects every student in a grade band takes. Seniors add electives. */
const LOWER_CORE = ["MATH", "ENG", "ARAB", "ISL", "SOC", "BIO", "PE", "ART"];
const UPPER_CORE = ["MATH", "ENG", "ARAB", "ISL", "PE"];
const UPPER_ELECTIVES = ["PHYS", "CHEM", "BIO", "CS", "ECON", "BUS", "ART", "PSY", "GEO", "FR"];

export async function seedDemo(db: PrismaClient, opts: { log?: (m: string) => void; now?: Date; slug?: string } = {}) {
  const slug = opts.slug ?? DEMO_SLUG;
  const isDemoTenant = slug === DEMO_SLUG;
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  const started = Date.now();
  const r = rng(20260928);

  // Global reference catalog first (universities, programmes, requirements). Fast when unchanged.
  await seedGlobalCatalog(db, { now, log });

  // --- Organization (stable id) -------------------------------------------------
  const org = await db.organization.upsert({
    where: { slug },
    create: {
      slug,
      nameEn: "Horizon International School Dubai",
      nameAr: "مدرسة هورايزن الدولية - دبي",
      shortNameEn: "Horizon",
      shortNameAr: "هورايزن",
      isDemo: true,
    },
    update: {},
  });
  await db.organization.update({
    where: { id: org.id },
    data: {
      nameEn: "Horizon International School Dubai",
      nameAr: "مدرسة هورايزن الدولية في دبي",
      shortNameEn: "Horizon",
      shortNameAr: "هورايزن",
      isDemo: isDemoTenant,
      defaultLocale: "en",
      timezone: "Asia/Dubai",
      currency: "AED",
      weekDays: [1, 2, 3, 4, 5],
      regulator: "KHDA",
      emirate: "Dubai",
      dataRegion: "me-central-1",
      hijriEnabled: true,
      numerals: "WESTERN",
      aiEnabled: true,
      aiSensitiveDataEnabled: false,
      emiratesIdPolicy: "OPTIONAL",
      passportPolicy: "OPTIONAL",
      crossBorderAllowed: false,
      primaryColor: "#123A63",
      accentColor: "#C8A24A",
      lastResetAt: now,
      curricula: ["BRITISH", "AMERICAN"],
      enabledModules: [],
      onboardingCompletedAt: now,
    },
  });
  const orgId = org.id;
  await wipeTenant(db, orgId);
  log(`wiped tenant in ${Date.now() - started}ms`);

  // --- Starter template: roles, catalogs, templates, year, holidays, bell schedule, compliance defaults -------------
  // The same configuration every new school gets at sign-up; the demo adds people and months of history on top.
  await installStarterTemplate(db, orgId, { curricula: ["BRITISH", "AMERICAN"], locale: "en", now, installCourses: false, backdate: true });
  log(`starter template in ${Date.now() - started}ms`);
  const roleIds = new Map((await db.role.findMany({ where: { orgId }, select: { id: true, key: true } })).map((r) => [r.key, r.id]));

  // --- Users (global) and memberships ----------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 8);
  const taken = new Set<string>();
  type PendingUser = { email: string; nameEn: string; nameAr: string; locale: "en" | "ar" };
  const pendingUsers: PendingUser[] = [];

  const staffDefs = [
    ...PERSONA_STAFF.map((p) => ({ ...p })),
    ...STAFF.map((s) => ({
      key: s.key,
      persona: s.key === "registrar_main" ? "registrar" : s.key === "hod_computing" ? "hod_computing" : s.key === "deputy_dsl_main" ? "deputy_dsl" : "",
      first: s.firstName,
      last: s.lastName,
      gender: s.gender,
      roles: s.roles,
      jobTitle: s.jobTitle,
      department: s.department,
      subjects: s.subjects,
      gradeLevels: s.key === "counselor_second" ? [11, 12] : s.key === "wellbeing_lead_main" ? [6, 7, 8, 9, 10, 11, 12] : [],
    })),
  ];
  const staffEmails = staffDefs.map((s) => {
    const email = emailFor(s.first.en, s.last.en, "horizon.example", taken);
    pendingUsers.push({ email, nameEn: `${s.first.en} ${s.last.en}`, nameAr: `${s.first.ar} ${s.last.ar}`, locale: s.first.ar && /^(عائشة|عمر|خالد|منى)$/.test(s.first.ar) ? "ar" : "en" });
    return email;
  });

  // The Nasser family: Rania (mother), Karim (father), Adam (Grade 9) and Yara (Grade 6).
  const families = [
    {
      lastName: bi("Nasser", "ناصر"),
      nationality: bi("Jordanian", "أردني"),
      guardians: [
        { firstName: bi("Rania", "رانيا"), relationship: bi("Mother", "الأم"), gender: "F" as const, occupation: "Architect", phone: "+971 50 555 0100" },
        { firstName: bi("Karim", "كريم"), relationship: bi("Father", "الأب"), gender: "M" as const, occupation: "Civil engineer", phone: "+971 50 555 0099" },
      ],
      children: [
        { firstName: bi("Adam", "آدم"), gender: "M" as const, grade: 9 },
        { firstName: bi("Yara", "يارا"), gender: "F" as const, grade: 6 },
      ],
    },
    ...FAMILIES,
  ];
  const guardianEmails: string[][] = families.map((f) =>
    f.guardians.map((g) => {
      const email = emailFor(g.firstName.en, f.lastName.en, "family.horizon.example", taken);
      pendingUsers.push({ email, nameEn: `${g.firstName.en} ${f.lastName.en}`, nameAr: `${g.firstName.ar} ${f.lastName.ar}`, locale: /Emirati|Jordanian|Egyptian|Lebanese|Syrian|Palestinian|Saudi|Moroccan|Sudanese/.test(f.nationality.en) ? "ar" : "en" });
      return email;
    }),
  );
  const studentEmails: string[][] = families.map((f) =>
    f.children.map((c) => {
      const email = emailFor(c.firstName.en, f.lastName.en, "students.horizon.example", taken);
      pendingUsers.push({ email, nameEn: `${c.firstName.en} ${f.lastName.en}`, nameAr: `${c.firstName.ar} ${f.lastName.ar}`, locale: "en" });
      return email;
    }),
  );

  await db.user.createMany({
    data: pendingUsers.map((u) => ({ email: u.email, nameEn: u.nameEn, nameAr: u.nameAr, passwordHash, locale: null })),
    skipDuplicates: true,
  });
  const users = await db.user.findMany({ where: { email: { in: pendingUsers.map((u) => u.email) } }, select: { id: true, email: true } });
  const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));
  // Reset names and passwords in case they drifted during a demo.
  if (isDemoTenant) await db.user.updateMany({ where: { email: { in: pendingUsers.map((u) => u.email) } }, data: { passwordHash, lastActiveOrgId: orgId, locale: null } });

  const membershipRows: Prisma.MembershipCreateManyInput[] = [];
  const membershipRoleRows: Prisma.MembershipRoleCreateManyInput[] = [];
  const addMembership = (email: string, roles: string[], title?: Bi) => {
    const mid = stableId("membership", orgId, email);
    membershipRows.push({ id: mid, orgId, userId: userIdByEmail.get(email)!, status: "ACTIVE", titleEn: title?.en ?? null, titleAr: title?.ar ?? null, createdAt: at(-400, 8, 0, now) });
    for (const rk of roles) membershipRoleRows.push({ id: id(), orgId, membershipId: mid, roleId: roleIds.get(rk)! });
    return mid;
  };

  const staff = new Map<string, SeedStaff>();
  const personas: Record<string, string> = {};
  staffDefs.forEach((s, i) => {
    const email = staffEmails[i];
    const membershipId = addMembership(email, s.roles, s.jobTitle);
    staff.set(s.key, {
      key: s.key,
      userId: userIdByEmail.get(email)!,
      membershipId,
      email,
      name: bi(`${s.first.en} ${s.last.en}`, `${s.first.ar} ${s.last.ar}`),
      first: s.first,
      last: s.last,
      gender: s.gender,
      roles: s.roles,
      department: s.department,
      subjects: s.subjects,
      gradeLevels: s.gradeLevels,
      jobTitle: s.jobTitle,
    });
    if (s.persona) personas[s.persona] = membershipId;
  });

  const guardians: SeedGuardian[] = [];
  const students: SeedStudent[] = [];
  families.forEach((f, fi) => {
    f.guardians.forEach((g, gi) => {
      const email = guardianEmails[fi][gi];
      const membershipId = addMembership(email, ["parent"], g.relationship);
      guardians.push({
        id: id(),
        userId: userIdByEmail.get(email)!,
        membershipId,
        email,
        name: bi(`${g.firstName.en} ${f.lastName.en}`, `${g.firstName.ar} ${f.lastName.ar}`),
        first: g.firstName,
        last: f.lastName,
        gender: g.gender,
        familyIndex: fi,
        phone: g.phone,
        studentIds: [],
      });
    });
    f.children.forEach((c, ci) => {
      const email = studentEmails[fi][ci];
      const membershipId = addMembership(email, ["student"]);
      students.push({
        id: id(),
        membershipId,
        userId: userIdByEmail.get(email)!,
        first: c.firstName,
        last: f.lastName,
        grade: c.grade,
        section: "A",
        gender: c.gender,
        nationality: f.nationality,
        familyIndex: fi,
        classIds: [],
        subjects: [],
      });
    });
  });
  await db.membership.createMany({ data: membershipRows });
  await db.membershipRole.createMany({ data: membershipRoleRows });
  log(`people: ${staff.size} staff, ${students.length} students, ${guardians.length} guardians`);

  // Sections: split each grade into A and B, keeping Adam in 9A.
  const adam = students[0];
  const yara = students[1];
  for (const g of [6, 7, 8, 9, 10, 11, 12]) {
    const inGrade = students.filter((s) => s.grade === g);
    inGrade.forEach((s, i) => (s.section = i % 2 === 0 ? "A" : "B"));
  }
  adam.section = "A";
  yara.section = "A";

  // --- Structure ------------------------------------------------------------------
  const mainCampus = await db.campus.findFirstOrThrow({ where: { orgId, isMain: true } });
  const campusId = mainCampus.id;
  await db.campus.update({ where: { id: campusId }, data: { nameEn: "Al Barsha Campus", nameAr: "حرم البرشاء", addressEn: "Al Barsha South, Dubai", addressAr: "البرشاء جنوب، دبي" } });
  const startYear = academicStartYear(now);
  const yearId = (await db.academicYear.findFirstOrThrow({ where: { orgId, isCurrent: true } })).id;

  const headFor = (dept: string) => {
    if (dept === "student_services") return staff.get("sarah_ahmed")!.membershipId;
    if (dept === "administration") return staff.get("omar_al_mansoori")!.membershipId;
    return staff.get(`hod_${dept}`)?.membershipId ?? null;
  };
  const departments = new Map((await db.department.findMany({ where: { orgId }, select: { id: true, key: true } })).map((d) => [d.key, d.id]));
  for (const [key, did] of departments) {
    const head = headFor(key);
    if (head) await db.department.update({ where: { id: did }, data: { headMembershipId: head } });
  }
  const subjects = new Map((await db.subject.findMany({ where: { orgId }, select: { id: true, code: true, departmentId: true } })).map((s) => [s.code, { id: s.id, departmentId: s.departmentId }]));

  // Staff profiles
  await db.staffProfile.createMany({
    data: [...staff.values()].map((s, i) => ({
      orgId,
      membershipId: s.membershipId,
      departmentId: s.department ? departments.get(s.department) ?? null : null,
      employeeNo: `HIS-${String(1001 + i)}`,
      jobTitleEn: s.jobTitle.en,
      jobTitleAr: s.jobTitle.ar,
      phone: `+971 50 555 ${String(200 + i).padStart(4, "0")}`,
      officeEn: s.roles.includes("teacher") ? "Staff room, Block B" : "Administration, Block A",
      officeAr: s.roles.includes("teacher") ? "غرفة المعلمين، المبنى B" : "الإدارة، المبنى A",
      gradeLevels: s.gradeLevels,
    })),
  });

  // Teachers per subject (Daniel teaches Grade 9 Physics, Sana teaches Grade 9 Computer Science).
  const teachersBySubject = new Map<string, SeedStaff[]>();
  for (const s of staff.values()) for (const code of s.subjects) {
    if (!teachersBySubject.has(code)) teachersBySubject.set(code, []);
    teachersBySubject.get(code)!.push(s);
  }
  const homeroomTutors = r.shuffle([...staff.values()].filter((s) => s.roles.includes("teacher") && !s.roles.includes("department_head") && s.key !== "daniel_carter" && s.key !== "deputy_dsl_main"));
  const classes: SeedWorld["classes"] = [];
  const classRows: Prisma.SchoolClassCreateManyInput[] = [];
  let tutorIdx = 0;
  for (const g of [6, 7, 8, 9, 10, 11, 12]) {
    for (const section of ["A", "B"]) {
      const tutor = g === 9 && section === "A" ? staff.get("daniel_carter")! : homeroomTutors[tutorIdx++ % homeroomTutors.length];
      const cid = id();
      classes.push({ id: cid, grade: g, subject: null, section, teacherId: tutor.membershipId, homeroom: true });
      classRows.push({ id: cid, orgId, academicYearId: yearId, campusId, nameEn: `Homeroom ${g}${section}`, nameAr: `الفصل ${g}${section}`, gradeLevel: g, section, isHomeroom: true, teacherMembershipId: tutor.membershipId, room: `${g}${section === "A" ? "01" : "02"}` });
    }
    const subjectList = g <= 8 ? LOWER_CORE : [...UPPER_CORE, ...UPPER_ELECTIVES];
    for (const code of subjectList) {
      const pool = teachersBySubject.get(code) ?? [];
      let teacher = pool[(g + code.length) % Math.max(pool.length, 1)];
      if (code === "PHYS" && g === 9) teacher = staff.get("daniel_carter")!;
      if (code === "PHYS" && g !== 9) teacher = staff.get("physics_teacher") ?? teacher;
      if (code === "CS" && g === 9) teacher = staff.get("cs_teacher") ?? teacher;
      const cid = id();
      const subject = SUBJECTS.find((s) => s.code === code)!;
      classes.push({ id: cid, grade: g, subject: code, section: null, teacherId: teacher?.membershipId ?? null, homeroom: false });
      classRows.push({ id: cid, orgId, academicYearId: yearId, campusId, subjectId: subjects.get(code)!.id, nameEn: `${subject.name.en} ${g}`, nameAr: `${subject.name.ar} ${g}`, gradeLevel: g, isHomeroom: false, teacherMembershipId: teacher?.membershipId ?? null, room: `${code}-${g}` });
    }
  }
  await db.schoolClass.createMany({ data: classRows });

  // Students, guardians, links, enrollments
  const enrolledOnFor = (s: SeedStudent) => new Date(Date.UTC(startYear - (s.grade - 5) + (s.familyIndex % 3), 7, 25));
  const studentRows: Prisma.StudentCreateManyInput[] = students.map((s, i) => ({
    id: s.id,
    orgId,
    membershipId: s.membershipId,
    campusId,
    studentNo: `HIS-${String(24001 + i)}`,
    firstNameEn: s.first.en,
    lastNameEn: s.last.en,
    firstNameAr: s.first.ar,
    lastNameAr: s.last.ar,
    gradeLevel: s.grade,
    section: s.section,
    dateOfBirth: new Date(Date.UTC(startYear - s.grade - 5, (i * 7) % 12, 1 + ((i * 11) % 27))),
    gender: s.gender,
    nationalityEn: s.nationality.en,
    nationalityAr: s.nationality.ar,
    ...(() => {
      const eid = `784-${startYear - s.grade - 5}-${String(1000000 + ((i * 7919) % 8999999)).slice(0, 7)}-${i % 10}`;
      const passport = `${["N", "P", "A", "K"][i % 4]}${String(10000000 + ((i * 104729) % 89999999)).slice(0, 8)}`;
      return { emiratesIdEnc: encryptField(eid), emiratesIdLast4: eid.slice(-9, -2).slice(-4), passportEnc: encryptField(passport), passportLast4: passport.slice(-4) };
    })(),
    status: "ACTIVE",
    enrolledOn: enrolledOnFor(s),
    houseEn: ["Falcon", "Oryx", "Dhow", "Ghaf"][i % 4],
    houseAr: ["الصقر", "المها", "الداو", "الغاف"][i % 4],
    hasSen: i % 17 === 5,
  }));
  await db.student.createMany({ data: studentRows });

  await db.guardian.createMany({
    data: guardians.map((g) => ({
      id: g.id,
      orgId,
      membershipId: g.membershipId,
      firstNameEn: g.first.en,
      lastNameEn: g.last.en,
      firstNameAr: g.first.ar,
      lastNameAr: g.last.ar,
      email: g.email,
      phone: g.phone,
      preferredLoc: "en",
    })),
  });
  const linkRows: Prisma.GuardianLinkCreateManyInput[] = [];
  for (const g of guardians) {
    const fam = families[g.familyIndex];
    const gIndex = fam.guardians.findIndex((x) => x.firstName.en === g.first.en);
    const rel = fam.guardians[gIndex].relationship;
    for (const s of students.filter((x) => x.familyIndex === g.familyIndex)) {
      g.studentIds.push(s.id);
      linkRows.push({ orgId, guardianId: g.id, studentId: s.id, relationshipEn: rel.en, relationshipAr: rel.ar, isPrimary: gIndex === 0, canApprove: true, receivesUpdates: true, livesWith: true });
    }
  }
  await db.guardianLink.createMany({ data: linkRows });

  const enrollRows: Prisma.EnrollmentCreateManyInput[] = [];
  for (const s of students) {
    const homeroom = classes.find((c) => c.homeroom && c.grade === s.grade && c.section === s.section)!;
    s.classIds.push(homeroom.id);
    let subjectsTaken: string[];
    if (s.grade <= 8) subjectsTaken = LOWER_CORE;
    else if (s === adam) subjectsTaken = [...UPPER_CORE, "PHYS", "CHEM", "ECON", "ART"];
    else subjectsTaken = [...UPPER_CORE, ...r.shuffle(UPPER_ELECTIVES).slice(0, 4)];
    s.subjects = subjectsTaken;
    for (const code of subjectsTaken) {
      const c = classes.find((x) => !x.homeroom && x.grade === s.grade && x.subject === code);
      if (c) s.classIds.push(c.id);
    }
    for (const cid of s.classIds) enrollRows.push({ orgId, studentId: s.id, classId: cid, status: "ACTIVE" });
  }
  await db.enrollment.createMany({ data: enrollRows });
  log("structure and enrollments ready");

  // --- Catalogs (installed by the starter template): read back what the demo story needs ----------------------------
  const author = staff.get("aisha_rahman")!.membershipId;
  // The demo's admin authored the catalog. Two forms carry an earlier version to show version history.
  await db.form.updateMany({ where: { orgId }, data: { createdById: author } });
  await db.formVersion.updateMany({ where: { orgId }, data: { publishedById: author } });
  await db.workflow.updateMany({ where: { orgId }, data: { createdById: author } });
  await db.workflowVersion.updateMany({ where: { orgId }, data: { publishedById: author } });
  const forms = await db.form.findMany({ where: { orgId }, select: { id: true, key: true, publishedVersionId: true } });
  const formVersionByKey = new Map<string, { formId: string; versionId: string; schema: FormSchema }>();
  for (const f of FORM_TEMPLATES) {
    const row = forms.find((x) => x.key === f.key);
    if (!row?.publishedVersionId) continue;
    formVersionByKey.set(f.key, { formId: row.id, versionId: row.publishedVersionId, schema: f.schema });
    if (f.key === "subject_change" || f.key === "document_request") {
      const firstStep = f.schema.steps[0];
      const older: FormSchema = { ...f.schema, steps: [{ ...firstStep, sections: firstStep.sections.map((sec) => ({ ...sec, fields: sec.fields.filter((fld) => !fld.showIf) })) }] };
      await db.formVersion.update({ where: { id: row.publishedVersionId }, data: { version: 2, publishedAt: at(-60, 9, 0, now) } });
      await db.formVersion.create({ data: { id: id(), orgId, formId: row.id, version: 1, schema: older as never, publishedAt: at(-190, 9, 0, now), publishedById: author } });
    }
  }
  const workflowVersionByKey = new Map((await db.workflow.findMany({ where: { orgId }, select: { id: true, key: true, publishedVersionId: true } })).map((w) => [w.key, { workflowId: w.id, versionId: w.publishedVersionId! }]));

  // Appointment types: hosts and availability come from the demo staff.
  const appointmentTypes = new Map<string, { id: string; durationMin: number; locationEn: string; locationAr: string }>();
  const typeRows = await db.appointmentType.findMany({ where: { orgId } });
  const hostRows: Prisma.AppointmentTypeHostCreateManyInput[] = [];
  const staffWithRole = (role: string) => [...staff.values()].filter((s) => s.roles.includes(role));
  for (const t of APPOINTMENT_TYPES) {
    const row = typeRows.find((x) => x.key === t.key);
    if (!row) continue;
    appointmentTypes.set(t.key, { id: row.id, durationMin: row.durationMin, locationEn: row.locationEn ?? "", locationAr: row.locationAr ?? "" });
    const hosts = new Set<string>();
    for (const role of t.hostRoles) for (const s of staffWithRole(role)) hosts.add(s.membershipId);
    for (const h of hosts) hostRows.push({ orgId, typeId: row.id, membershipId: h });
  }
  await db.appointmentTypeHost.createMany({ data: hostRows });
  const availRows: Prisma.AvailabilityRuleCreateManyInput[] = [];
  for (const s of staff.values()) {
    const key = s.roles.includes("career_advisor")
      ? "career_advisor"
      : s.roles.includes("counselor")
        ? "counselor"
        : s.roles.includes("wellbeing_lead")
          ? "wellbeing_lead"
          : s.roles.includes("teacher")
            ? "teacher"
            : null;
    if (!key) continue;
    for (const [weekday, start, end] of DEFAULT_AVAILABILITY[key]) availRows.push({ orgId, membershipId: s.membershipId, weekday, startMinute: start, endMinute: end });
  }
  await db.availabilityRule.createMany({ data: availRows });
  // Layla is at a university fair next Thursday afternoon.
  const fairOffset = (() => {
    for (let d = 3; d < 14; d++) if (new Date(at(d, 12, 0, now)).getUTCDay() === 4) return d;
    return 5;
  })();
  await db.availabilityOverride.create({
    data: { orgId, membershipId: staff.get("layla_hassan")!.membershipId, date: dateOnly(fairOffset, now), isUnavailable: false, startMinute: 8 * 60, endMinute: 11 * 60, reasonEn: "University fair in the afternoon", reasonAr: "معرض الجامعات بعد الظهر" },
  });

  const services: SeedWorld["services"] = new Map();
  const serviceRows = await db.serviceDefinition.findMany({ where: { orgId } });
  for (const s of SERVICES) {
    const row = serviceRows.find((x) => x.key === s.key);
    if (!row) continue;
    const fv = s.formKey ? formVersionByKey.get(s.formKey) : undefined;
    const wv = s.workflowKey ? workflowVersionByKey.get(s.workflowKey) : undefined;
    services.set(s.key, { id: row.id, key: s.key, formVersionId: fv?.versionId ?? null, schema: fv?.schema ?? null, nameEn: row.nameEn, nameAr: row.nameAr, prefix: row.requestPrefix, sensitivity: row.sensitivity, workflowVersionId: wv?.versionId ?? null });
  }

  const categories = new Map((await db.documentCategory.findMany({ where: { orgId }, select: { id: true, key: true } })).map((c) => [c.key, c.id]));
  const templates = new Map((await db.documentTemplate.findMany({ where: { orgId }, select: { id: true, key: true } })).map((t) => [t.key, t.id]));
  const careers = new Map((await db.career.findMany({ where: { orgId }, select: { id: true, key: true } })).map((c) => [c.key, c.id]));

  // Universities live in the global catalog (orgId null, seeded by seedGlobalCatalog). Schools no longer get copies.
  const universities = new Map((await db.university.findMany({ where: { orgId: null }, select: { id: true, key: true } })).map((u) => [u.key, u.id]));

  // Announcements and calendar
  await db.announcement.createMany({
    data: ANNOUNCEMENTS.map((a) => ({ orgId, titleEn: a.title.en, titleAr: a.title.ar, bodyEn: a.body.en, bodyAr: a.body.ar, audience: a.audience, publishedAt: at(-a.daysAgo, 8, 30, now), authorId: staff.get("omar_al_mansoori")!.membershipId })),
  });
  await db.calendarEvent.createMany({
    data: CALENDAR_EVENTS.map((e) => {
      const allDay = e.startHour === undefined;
      const startsAt = allDay ? at(e.dayOffset, 0, 0, now) : at(e.dayOffset, e.startHour!, 0, now);
      const endsAt = allDay ? at(e.dayOffset + (e.durationDays ?? 1), 0, 0, now) : new Date(startsAt.getTime() + (e.durationHours ?? 1) * 3600_000);
      return { orgId, kind: e.kind, titleEn: e.title.en, titleAr: e.title.ar, descEn: e.description?.en ?? null, descAr: e.description?.ar ?? null, startsAt, endsAt, allDay, audience: e.audience };
    }),
  });

  // Attendance for the last 30 school days
  const attendanceRows: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (let back = 1; back <= 45; back++) {
    if (!isSchoolDay(-back, now)) continue;
    const date = dateOnly(-back, now);
    for (const s of students) {
      const roll = r.next();
      const status = roll < 0.035 ? "ABSENT" : roll < 0.065 ? "LATE" : roll < 0.075 ? "EXCUSED" : "PRESENT";
      attendanceRows.push({ orgId, studentId: s.id, date, status, minutesLate: status === "LATE" ? r.int(5, 25) : null });
    }
  }
  await db.attendanceRecord.createMany({ data: attendanceRows });
  log("catalogs, calendar and attendance ready");

  const studentById = new Map(students.map((s) => [s.id, s]));
  const nasserGuardians = guardians.filter((g) => g.familyIndex === 0);
  const world: SeedWorld = {
    db,
    orgId,
    now,
    staff,
    students,
    guardians,
    studentById,
    services,
    subjects,
    departments,
    appointmentTypes,
    careers,
    universities,
    categories,
    templates,
    classes,
    personas: {
      ...personas,
      student: adam.membershipId,
      parent: nasserGuardians[0].membershipId,
    },
    adam,
    yara,
    rania: nasserGuardians[0],
    karim: nasserGuardians[1],
    log,
  };

  // Personas
  const personaDefs: Array<{ key: string; label: Bi; blurb: Bi; home: string }> = [
    { key: "admin", label: bi("School Administrator", "مسؤولة إدارة المدرسة"), blurb: bi("Runs services, forms, workflows and compliance.", "تدير الخدمات والنماذج ومسارات العمل والامتثال."), home: "/home" },
    { key: "principal", label: bi("Principal", "مدير المدرسة"), blurb: bi("Sees the whole school at a glance and approves what matters.", "يرى المدرسة كلها بنظرة واحدة ويعتمد ما يهم."), home: "/home" },
    { key: "teacher", label: bi("Teacher", "معلم"), blurb: bi("Refers students, approves requests and meets parents.", "يحيل الطلاب ويعتمد الطلبات ويلتقي أولياء الأمور."), home: "/home" },
    { key: "counselor", label: bi("Counselor", "المرشدة الطلابية"), blurb: bi("Supports students with cases, meetings and action plans.", "تدعم الطلاب عبر الحالات والمواعيد وخطط العمل."), home: "/home" },
    { key: "career_advisor", label: bi("Career Advisor", "مستشارة التوجيه المهني"), blurb: bi("Guides students from interests to universities.", "توجّه الطلاب من الميول إلى الجامعات."), home: "/home" },
    { key: "dsl", label: bi("Safeguarding Lead", "مسؤول حماية الطفل"), blurb: bi("Handles restricted child protection cases.", "يتولى ملفات حماية الطفل المقيّدة."), home: "/home" },
    { key: "student", label: bi("Student, Grade 9", "طالب في الصف التاسع"), blurb: bi("Books meetings, explores careers and tracks requests.", "يحجز المواعيد ويستكشف المهن ويتابع طلباته."), home: "/home" },
    { key: "parent", label: bi("Parent of two", "ولية أمر لطفلين"), blurb: bi("Follows both children, approves and books meetings.", "تتابع طفليها وتعتمد الطلبات وتحجز المواعيد."), home: "/home" },
    { key: "registrar", label: bi("Registrar", "المسجلة"), blurb: bi("Approves documents and timetable changes.", "تعتمد المستندات وتغييرات الجدول."), home: "/home" },
    { key: "hod_computing", label: bi("Head of Computing", "رئيس قسم الحوسبة"), blurb: bi("Approves students joining Computer Science.", "يعتمد انضمام الطلاب إلى علوم الحاسوب."), home: "/home" },
    { key: "deputy_dsl", label: bi("Deputy Safeguarding Lead", "نائب مسؤول الحماية"), blurb: bi("Covers child protection with the DSL.", "يساند مسؤول الحماية في ملفات حماية الطفل."), home: "/home" },
  ];
  await db.demoPersona.createMany({
    data: personaDefs
      .filter((p) => world.personas[p.key])
      .map((p, i) => ({ orgId, key: p.key, membershipId: world.personas[p.key], roleLabelEn: p.label.en, roleLabelAr: p.label.ar, blurbEn: p.blurb.en, blurbAr: p.blurb.ar, homePath: p.home, order: i })),
  });
  // Personas start in their natural language.
  await db.membership.updateMany({ where: { id: { in: [world.personas.principal, world.personas.dsl] } }, data: { locale: null } });

  await seedHistory(world, execCtx(db as unknown as Prisma.TransactionClient, orgId, { now, quiet: true }));
  await seedCareer(world);
  await seedCompliance(world);
  // Academic modules, in dependency order.
  await seedRegistration(world);
  await seedTimetable(world);
  await seedGrades(world);
  await seedTrips(world);
  await seedCalendar(world);
  await seedPathways(world);
  await seedApplications(world);
  await seedCareerEvents(world);
  await seedPathwayEngine(world);
  await seedTranscripts(world);
  await seedCurriculum(world);
  await seedAccess(world);
  // School group: Horizon Education Group with two small extra schools (demo tenant only).
  if (isDemoTenant) await seedGroupDemo(world);
  // Requirement pipeline examples (after the global catalog seed; programs are looked up at runtime).
  // The catalog review and change monitor show real data only: changes found between archived and
  // current official pages (see prisma/seed/catalog/official.ts). No example drafts or changes are seeded.

  log(`demo seed finished in ${Date.now() - started}ms`);
  return { orgId, ms: Date.now() - started };
}

export { at, schoolDay };
