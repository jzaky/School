// Demo tenant seed: Horizon International School Dubai.
// Re-runnable. Wipes every row of the demo organization (the organization row keeps its id)
// and rebuilds a bilingual school with months of history, all dates relative to now.
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES, STAFF_ROLE_KEYS } from "@/server/identity/permissions";
import type { FormSchema } from "@/server/forms/schema";
import { execCtx } from "@/server/db";
import { at, dateOnly, emailFor, id, isSchoolDay, rng, schoolDay, wipeTenant } from "./lib";
import { FAMILIES, STAFF, type Bi } from "./data/people";
import { ANNOUNCEMENTS, CALENDAR_EVENTS } from "./data/content";
import { SERVICES, SERVICE_CATEGORIES } from "./data/services";
import { FORM_TEMPLATES } from "./data/forms";
import { WORKFLOW_TEMPLATES } from "./data/workflows";
import { APPOINTMENT_TYPES, DEFAULT_AVAILABILITY } from "./data/scheduling";
import { DOCUMENT_CATEGORIES, DOCUMENT_TEMPLATES } from "./data/documents";
import { MESSAGE_TEMPLATES } from "./data/notifications";
import { CAREERS } from "./data/careers";
import { APTITUDE_QUESTIONS } from "./data/aptitude";
import { UNIVERSITIES } from "./data/universities";
import { seedHistory } from "./history";
import { seedCompliance } from "./compliance";

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

const DEPARTMENTS: Array<{ key: string; name: Bi }> = [
  { key: "science", name: bi("Science", "العلوم") },
  { key: "mathematics", name: bi("Mathematics", "الرياضيات") },
  { key: "computing", name: bi("Computing", "الحوسبة") },
  { key: "english", name: bi("English", "اللغة الإنجليزية") },
  { key: "arabic_islamic", name: bi("Arabic and Islamic Studies", "اللغة العربية والدراسات الإسلامية") },
  { key: "humanities", name: bi("Humanities", "العلوم الإنسانية") },
  { key: "arts", name: bi("Arts", "الفنون") },
  { key: "pe", name: bi("Physical Education", "التربية الرياضية") },
  { key: "student_services", name: bi("Student Services", "خدمات الطلاب") },
  { key: "administration", name: bi("Administration", "الإدارة") },
];

/** Core subjects every student in a grade band takes. Seniors add electives. */
const LOWER_CORE = ["MATH", "ENG", "ARAB", "ISL", "SOC", "BIO", "PE", "ART"];
const UPPER_CORE = ["MATH", "ENG", "ARAB", "ISL", "PE"];
const UPPER_ELECTIVES = ["PHYS", "CHEM", "BIO", "CS", "ECON", "BUS", "ART", "PSY", "GEO", "FR"];

export async function seedDemo(db: PrismaClient, opts: { log?: (m: string) => void; now?: Date } = {}) {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  const started = Date.now();
  const r = rng(20260928);

  // --- Organization (stable id) -------------------------------------------------
  const org = await db.organization.upsert({
    where: { slug: DEMO_SLUG },
    create: {
      slug: DEMO_SLUG,
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
      isDemo: true,
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
    },
  });
  const orgId = org.id;
  await wipeTenant(db, orgId);
  log(`wiped tenant in ${Date.now() - started}ms`);

  // --- Roles -----------------------------------------------------------------
  const roleIds = new Map<string, string>();
  await db.role.createMany({
    data: SYSTEM_ROLES.map((role) => {
      const rid = id();
      roleIds.set(role.key, rid);
      return { id: rid, orgId, key: role.key, nameEn: role.nameEn, nameAr: role.nameAr, descEn: role.descEn, descAr: role.descAr, permissions: role.permissions, isSystem: true };
    }),
  });

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
  await db.user.updateMany({ where: { email: { in: pendingUsers.map((u) => u.email) } }, data: { passwordHash, lastActiveOrgId: orgId, locale: null } });

  const membershipRows: Prisma.MembershipCreateManyInput[] = [];
  const membershipRoleRows: Prisma.MembershipRoleCreateManyInput[] = [];
  const addMembership = (email: string, roles: string[], title?: Bi) => {
    const mid = id();
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
  const campusId = id();
  await db.campus.create({
    data: {
      id: campusId,
      orgId,
      nameEn: "Al Barsha Campus",
      nameAr: "حرم البرشاء",
      addressEn: "Al Barsha South, Dubai",
      addressAr: "البرشاء جنوب، دبي",
      isMain: true,
    },
  });
  const nowY = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? nowY : nowY - 1;
  const yearId = id();
  await db.academicYear.create({
    data: {
      id: yearId,
      orgId,
      nameEn: `${startYear}-${startYear + 1}`,
      nameAr: `${startYear}-${startYear + 1}`,
      startsOn: new Date(Date.UTC(startYear, 7, 24)),
      endsOn: new Date(Date.UTC(startYear + 1, 6, 2)),
      isCurrent: true,
    },
  });
  await db.term.createMany({
    data: [
      { orgId, academicYearId: yearId, nameEn: "Autumn term", nameAr: "الفصل الأول", startsOn: new Date(Date.UTC(startYear, 7, 24)), endsOn: new Date(Date.UTC(startYear, 11, 12)) },
      { orgId, academicYearId: yearId, nameEn: "Spring term", nameAr: "الفصل الثاني", startsOn: new Date(Date.UTC(startYear + 1, 0, 5)), endsOn: new Date(Date.UTC(startYear + 1, 2, 27)) },
      { orgId, academicYearId: yearId, nameEn: "Summer term", nameAr: "الفصل الثالث", startsOn: new Date(Date.UTC(startYear + 1, 3, 13)), endsOn: new Date(Date.UTC(startYear + 1, 6, 2)) },
    ],
  });

  const headFor = (dept: string) => {
    if (dept === "student_services") return staff.get("sarah_ahmed")!.membershipId;
    if (dept === "administration") return staff.get("omar_al_mansoori")!.membershipId;
    return staff.get(`hod_${dept}`)?.membershipId ?? null;
  };
  const departments = new Map<string, string>();
  await db.department.createMany({
    data: DEPARTMENTS.map((d) => {
      const did = id();
      departments.set(d.key, did);
      return { id: did, orgId, key: d.key, nameEn: d.name.en, nameAr: d.name.ar, headMembershipId: headFor(d.key) };
    }),
  });
  const subjects = new Map<string, { id: string; departmentId: string | null }>();
  await db.subject.createMany({
    data: SUBJECTS.map((s) => {
      const sid = id();
      subjects.set(s.code, { id: sid, departmentId: departments.get(s.dept) ?? null });
      return { id: sid, orgId, code: s.code, nameEn: s.name.en, nameAr: s.name.ar, departmentId: departments.get(s.dept) ?? null };
    }),
  });

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
    emiratesIdLast4: String(1000 + ((i * 7919) % 9000)),
    passportLast4: String(2000 + ((i * 104729) % 7000)),
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

  // --- Catalogs: categories, forms, workflows, services ----------------------------------
  const categoryIds = new Map<string, string>();
  await db.serviceCategory.createMany({
    data: SERVICE_CATEGORIES.map((c) => {
      const cid = id();
      categoryIds.set(c.key, cid);
      return { id: cid, orgId, key: c.key, nameEn: c.name.en, nameAr: c.name.ar, icon: c.icon, sortOrder: c.sortOrder };
    }),
  });

  const formVersionByKey = new Map<string, { formId: string; versionId: string; schema: FormSchema }>();
  const formRows: Prisma.FormCreateManyInput[] = [];
  const formVersionRows: Prisma.FormVersionCreateManyInput[] = [];
  const author = staff.get("aisha_rahman")!.membershipId;
  for (const f of FORM_TEMPLATES) {
    const formId = id();
    const versionId = id();
    formRows.push({
      id: formId,
      orgId,
      key: f.key,
      nameEn: f.name.en,
      nameAr: f.name.ar,
      descEn: f.description.en,
      descAr: f.description.ar,
      categoryEn: f.category.en,
      categoryAr: f.category.ar,
      isTemplate: true,
      status: "PUBLISHED",
      draftSchema: f.schema as never,
      publishedVersionId: versionId,
      createdById: author,
      createdAt: at(-200, 10, 0, now),
    });
    // Two forms carry an earlier version to show version history.
    if (f.key === "subject_change" || f.key === "document_request") {
      const firstStep = f.schema.steps[0];
      const older: FormSchema = { ...f.schema, steps: [{ ...firstStep, sections: firstStep.sections.map((sec) => ({ ...sec, fields: sec.fields.filter((fld) => !fld.showIf) })) }] };
      formVersionRows.push({ id: id(), orgId, formId, version: 1, schema: older as never, publishedAt: at(-190, 9, 0, now), publishedById: author });
      formVersionRows.push({ id: versionId, orgId, formId, version: 2, schema: f.schema as never, publishedAt: at(-60, 9, 0, now), publishedById: author });
    } else {
      formVersionRows.push({ id: versionId, orgId, formId, version: 1, schema: f.schema as never, publishedAt: at(-190, 9, 0, now), publishedById: author });
    }
    formVersionByKey.set(f.key, { formId, versionId, schema: f.schema });
  }
  await db.form.createMany({ data: formRows });
  await db.formVersion.createMany({ data: formVersionRows });

  const workflowVersionByKey = new Map<string, { workflowId: string; versionId: string }>();
  const wfRows: Prisma.WorkflowCreateManyInput[] = [];
  const wfvRows: Prisma.WorkflowVersionCreateManyInput[] = [];
  for (const w of WORKFLOW_TEMPLATES) {
    const workflowId = id();
    const versionId = id();
    wfRows.push({ id: workflowId, orgId, key: w.key, nameEn: w.name.en, nameAr: w.name.ar, descEn: w.description.en, descAr: w.description.ar, isTemplate: true, status: "PUBLISHED", draftGraph: w.graph as never, publishedVersionId: versionId, createdById: author, createdAt: at(-200, 11, 0, now) });
    wfvRows.push({ id: versionId, orgId, workflowId, version: 1, graph: w.graph as never, publishedAt: at(-190, 11, 0, now), publishedById: author });
    workflowVersionByKey.set(w.key, { workflowId, versionId });
  }
  await db.workflow.createMany({ data: wfRows });
  await db.workflowVersion.createMany({ data: wfvRows });

  // Appointment types with hosts and availability
  const appointmentTypes = new Map<string, { id: string; durationMin: number; locationEn: string; locationAr: string }>();
  const hostRows: Prisma.AppointmentTypeHostCreateManyInput[] = [];
  const staffWithRole = (role: string) => [...staff.values()].filter((s) => s.roles.includes(role));
  for (const t of APPOINTMENT_TYPES) {
    const tid = id();
    appointmentTypes.set(t.key, { id: tid, durationMin: t.durationMin, locationEn: t.location.en, locationAr: t.location.ar });
    await db.appointmentType.create({
      data: {
        id: tid,
        orgId,
        key: t.key,
        nameEn: t.name.en,
        nameAr: t.name.ar,
        descEn: t.description.en,
        descAr: t.description.ar,
        durationMin: t.durationMin,
        bufferBeforeMin: t.bufferBeforeMin,
        bufferAfterMin: t.bufferAfterMin,
        minNoticeMin: t.minNoticeMin,
        dailyMax: t.dailyMax,
        locationType: t.locationType,
        locationEn: t.location.en,
        locationAr: t.location.ar,
        intakeFormId: t.intakeFormKey ? formVersionByKey.get(t.intakeFormKey)?.formId ?? null : null,
        hostMode: t.hostMode,
        audience: t.audience,
        color: t.color,
      },
    });
    const hosts = new Set<string>();
    for (const role of t.hostRoles) for (const s of staffWithRole(role)) hosts.add(s.membershipId);
    for (const h of hosts) hostRows.push({ orgId, typeId: tid, membershipId: h });
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
  const serviceRows: Prisma.ServiceDefinitionCreateManyInput[] = [];
  for (const s of SERVICES) {
    const sid = id();
    const audience = s.audience.flatMap((a) => (a === "staff" ? STAFF_ROLE_KEYS : [a]));
    const fv = s.formKey ? formVersionByKey.get(s.formKey) : undefined;
    const wv = s.workflowKey ? workflowVersionByKey.get(s.workflowKey) : undefined;
    serviceRows.push({
      id: sid,
      orgId,
      key: s.key,
      categoryId: categoryIds.get(s.category)!,
      nameEn: s.name.en,
      nameAr: s.name.ar,
      descEn: s.description.en,
      descAr: s.description.ar,
      icon: s.icon,
      audience: [...new Set(audience)],
      formId: fv?.formId ?? null,
      workflowId: wv?.workflowId ?? null,
      appointmentTypeId: s.appointmentTypeKey ? appointmentTypes.get(s.appointmentTypeKey)?.id ?? null : null,
      slaHours: s.slaHours,
      sensitivity: s.sensitivity,
      requestPrefix: s.requestPrefix,
      requiresStudent: s.requiresStudent,
      createsCase: s.createsCase,
      caseType: s.caseType,
      isActive: true,
      isFeatured: s.featured,
      sortOrder: s.sortOrder,
      createdAt: at(-200, 12, 0, now),
    });
    services.set(s.key, {
      id: sid,
      key: s.key,
      formVersionId: fv?.versionId ?? null,
      schema: fv?.schema ?? null,
      nameEn: s.name.en,
      nameAr: s.name.ar,
      prefix: s.requestPrefix,
      sensitivity: s.sensitivity,
      workflowVersionId: wv?.versionId ?? null,
    });
  }
  await db.serviceDefinition.createMany({ data: serviceRows });

  // Documents catalog and templates
  const categories = new Map<string, string>();
  await db.documentCategory.createMany({
    data: DOCUMENT_CATEGORIES.map((c) => {
      const cid = id();
      categories.set(c.key, cid);
      return { id: cid, orgId, key: c.key, nameEn: c.name.en, nameAr: c.name.ar, sensitivity: c.sensitivity };
    }),
  });
  const templates = new Map<string, string>();
  await db.documentTemplate.createMany({
    data: DOCUMENT_TEMPLATES.map((t) => {
      const tid = id();
      templates.set(t.key, tid);
      return { id: tid, orgId, key: t.key, nameEn: t.name.en, nameAr: t.name.ar, descEn: t.description.en, descAr: t.description.ar, bodyEn: t.bodyEn, bodyAr: t.bodyAr, output: t.output, mergeFields: t.mergeFields, signatoryEn: t.signatory.en, signatoryAr: t.signatory.ar };
    }),
  });
  await db.messageTemplate.createMany({
    data: MESSAGE_TEMPLATES.flatMap((t) => [
      { orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar },
      ...(t.sms ? [{ orgId, key: t.key, channel: "SMS" as const, subjectEn: null, subjectAr: null, bodyEn: t.sms.en, bodyAr: t.sms.ar }] : []),
    ]),
  });

  // Career catalogs
  await db.aptitudeQuestion.createMany({
    data: APTITUDE_QUESTIONS.map((q, i) => ({ orgId, dimension: q.dimension, textEn: q.text.en, textAr: q.text.ar, order: i + 1, reverse: Boolean(q.reverse) })),
  });
  const careers = new Map<string, string>();
  await db.career.createMany({
    data: CAREERS.map((c) => {
      const cid = id();
      careers.set(c.key, cid);
      return {
        id: cid,
        orgId,
        key: c.key,
        titleEn: c.title.en,
        titleAr: c.title.ar,
        clusterEn: c.cluster.en,
        clusterAr: c.cluster.ar,
        summaryEn: c.summary.en,
        summaryAr: c.summary.ar,
        dayInLifeEn: c.dayInLife.en,
        dayInLifeAr: c.dayInLife.ar,
        weights: c.weights as never,
        subjects: c.subjects,
        skillsEn: c.skills.en,
        skillsAr: c.skills.ar,
        educationEn: c.education.en,
        educationAr: c.education.ar,
        salaryMinAed: c.salaryMinAed,
        salaryMaxAed: c.salaryMaxAed,
        outlook: c.outlook,
        uaeDemand: c.uaeDemand,
      };
    }),
  });
  const universities = new Map<string, string>();
  await db.university.createMany({
    data: UNIVERSITIES.map((u) => {
      const uid = id();
      universities.set(u.key, uid);
      return { id: uid, orgId, key: u.key, nameEn: u.name.en, nameAr: u.name.ar, countryCode: u.countryCode, cityEn: u.city.en, cityAr: u.city.ar, worldRank: u.worldRank ?? null, acceptanceRate: u.acceptanceRate ?? null, minAverage: u.minAverage ?? null, programsEn: u.programs, website: u.website, deadlineMonth: u.deadlineMonth };
    }),
  });

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
  await seedCompliance(world);

  log(`demo seed finished in ${Date.now() - started}ms`);
  return { orgId, ms: Date.now() - started };
}

export { at, schoolDay };
