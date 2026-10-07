// Demo school group: Horizon Education Group runs the demo school plus two small fictional schools.
// Everyone here is fictional. Re-runnable: the two extra schools are wiped and rebuilt with light data on
// every demo reset; group rows keep stable ids. All dates are relative to `now`.
//
// Each extra school also holds a wellbeing request, a wellbeing case, a safeguarding case and a sensitive
// task. They exist so the group dashboard can be shown (and tested) to leave them out entirely.
import type { Prisma, PrismaClient } from "@prisma/client";
import { installStarterTemplate } from "./starter";
import { at, dateOnly, emailFor, rng, stableId, wipeTenant } from "./lib";
import type { SeedWorld } from "./demo";

type Bi = { en: string; ar: string };
const bi = (en: string, ar: string): Bi => ({ en, ar });
const DAY = 86_400_000;

export const GROUP_SLUG = "horizon-education-group";
export const GROUP_DIRECTOR_EMAIL = "noura.alsuwaidi@group.horizon.example";
export const GROUP_VIEWER_EMAIL = "faisal.alhammadi@group.horizon.example";
export const EXTRA_SCHOOL_SLUGS = ["horizon-academy-abu-dhabi", "horizon-primary-sharjah"] as const;

type StaffDef = { first: Bi; last: Bi; roles: string[]; title: Bi };
type SchoolDef = {
  slug: string;
  name: Bi;
  short: Bi;
  emirate: string;
  regulator: "ADEK" | "SPEA";
  curricula: Array<"AMERICAN" | "BRITISH">;
  domain: string;
  grades: number[];
  students: number;
  requests: number;
  completedSetup: boolean;
  joinedDaysAgo: number;
  via: "platform" | "invite";
  staff: StaffDef[];
  primaryColor: string;
  seed: number;
};

const SCHOOLS: SchoolDef[] = [
  {
    slug: EXTRA_SCHOOL_SLUGS[0],
    name: bi("Horizon Academy Abu Dhabi", "أكاديمية هورايزن في أبوظبي"),
    short: bi("Horizon Abu Dhabi", "هورايزن أبوظبي"),
    emirate: "Abu Dhabi",
    regulator: "ADEK",
    curricula: ["AMERICAN"],
    domain: "abudhabi.horizon.example",
    grades: [9, 10, 11, 12],
    students: 24,
    requests: 30,
    completedSetup: true,
    joinedDaysAgo: 210,
    via: "platform",
    primaryColor: "#0E5A56",
    seed: 4101,
    staff: [
      { first: bi("Mariam", "مريم"), last: bi("Al Dhaheri", "الظاهري"), roles: ["school_admin"], title: bi("School Administrator", "مسؤولة إدارة المدرسة") },
      { first: bi("Ahmed", "أحمد"), last: bi("Al Nuaimi", "النعيمي"), roles: ["principal"], title: bi("Principal", "مدير المدرسة") },
      { first: bi("Hessa", "حصة"), last: bi("Al Mazrouei", "المزروعي"), roles: ["counselor", "career_advisor"], title: bi("Counselor and University Advisor", "المرشدة الطلابية ومستشارة القبول الجامعي") },
      { first: bi("James", "جيمس"), last: bi("Whitfield", "ويتفيلد"), roles: ["teacher"], title: bi("Mathematics Teacher", "معلم الرياضيات") },
    ],
  },
  {
    slug: EXTRA_SCHOOL_SLUGS[1],
    name: bi("Horizon Primary School Sharjah", "مدرسة هورايزن الابتدائية في الشارقة"),
    short: bi("Horizon Sharjah", "هورايزن الشارقة"),
    emirate: "Sharjah",
    regulator: "SPEA",
    curricula: ["BRITISH"],
    domain: "sharjah.horizon.example",
    grades: [1, 2, 3, 4, 5, 6],
    students: 18,
    requests: 16,
    completedSetup: false,
    joinedDaysAgo: 41,
    via: "invite",
    primaryColor: "#7A3E9D",
    seed: 4202,
    staff: [
      { first: bi("Fatima", "فاطمة"), last: bi("Al Shamsi", "الشامسي"), roles: ["school_admin"], title: bi("School Administrator", "مسؤولة إدارة المدرسة") },
      { first: bi("Rashid", "راشد"), last: bi("Al Qasimi", "القاسمي"), roles: ["principal"], title: bi("Head Teacher", "مدير المدرسة") },
      { first: bi("Salma", "سلمى"), last: bi("Haddad", "حداد"), roles: ["counselor"], title: bi("School Counselor", "المرشدة الطلابية") },
      { first: bi("Priya", "بريا"), last: bi("Menon", "مينون"), roles: ["teacher"], title: bi("Year 4 Class Teacher", "معلمة الصف الرابع") },
    ],
  },
];

const FIRST_M = [bi("Omar", "عمر"), bi("Yousef", "يوسف"), bi("Hamad", "حمد"), bi("Zayed", "زايد"), bi("Ali", "علي"), bi("Rayan", "ريان"), bi("Ethan", "إيثان"), bi("Kareem", "كريم"), bi("Saif", "سيف"), bi("Arjun", "أرجون")];
const FIRST_F = [bi("Noor", "نور"), bi("Aya", "آية"), bi("Mira", "ميرا"), bi("Hind", "هند"), bi("Lina", "لينا"), bi("Sara", "سارة"), bi("Maya", "مايا"), bi("Dana", "دانة"), bi("Reem", "ريم"), bi("Ananya", "أنانيا")];
const LAST = [bi("Al Marri", "المري"), bi("Saleh", "صالح"), bi("Khoury", "خوري"), bi("Al Hosani", "الحوسني"), bi("Barakat", "بركات"), bi("Rahimi", "رحيمي"), bi("Thompson", "تومسون"), bi("Al Zaabi", "الزعابي"), bi("Nair", "ناير"), bi("Farouk", "فاروق")];
const GUARDIAN_F = [bi("Huda", "هدى"), bi("Amal", "أمل"), bi("Laila", "ليلى"), bi("Rasha", "رشا"), bi("Emma", "إيما")];
const GUARDIAN_M = [bi("Tariq", "طارق"), bi("Majid", "ماجد"), bi("Samir", "سمير"), bi("Daniel", "دانيال"), bi("Vikram", "فيكرام")];

const REQUEST_SERVICES = ["document_request", "absence_request", "it_support", "parent_meeting", "transport_request", "id_card_replacement", "activity_registration", "locker_request", "feedback"];
const SENIOR_SERVICES = ["recommendation_letter", "subject_change", "career_guidance"];

export async function seedGroupDemo(world: SeedWorld) {
  const { db, now, log } = world;
  const started = Date.now();
  const passwordHash = (await db.user.findFirst({ where: { id: world.staff.get("aisha_rahman")!.userId }, select: { passwordHash: true } }))?.passwordHash ?? null;

  // --- Group people: a director (also on Horizon's staff) and a board viewer with no school membership. ---
  const [director, viewer] = await Promise.all([
    db.user.upsert({ where: { email: GROUP_DIRECTOR_EMAIL }, create: { email: GROUP_DIRECTOR_EMAIL, nameEn: "Noura Al Suwaidi", nameAr: "نورة السويدي", passwordHash }, update: { nameEn: "Noura Al Suwaidi", nameAr: "نورة السويدي", passwordHash, lastActiveOrgId: world.orgId, locale: null } }),
    db.user.upsert({ where: { email: GROUP_VIEWER_EMAIL }, create: { email: GROUP_VIEWER_EMAIL, nameEn: "Faisal Al Hammadi", nameAr: "فيصل الحمادي", passwordHash }, update: { nameEn: "Faisal Al Hammadi", nameAr: "فيصل الحمادي", passwordHash, locale: null } }),
  ]);
  // Faisal belongs to no school: remove any membership a demo session may have created.
  await db.membership.deleteMany({ where: { userId: viewer.id } });

  const horizonRoles = new Map((await db.role.findMany({ where: { orgId: world.orgId }, select: { id: true, key: true } })).map((r) => [r.key, r.id]));
  const directorMembershipId = stableId("membership", world.orgId, GROUP_DIRECTOR_EMAIL);
  await db.membership.create({ data: { id: directorMembershipId, orgId: world.orgId, userId: director.id, status: "ACTIVE", titleEn: "Group Director of Schools", titleAr: "مديرة المدارس في المجموعة", createdAt: at(-300, 8, 0, now) } });
  await db.membershipRole.create({ data: { orgId: world.orgId, membershipId: directorMembershipId, roleId: horizonRoles.get("school_admin")! } });
  const adminDept = await db.department.findFirst({ where: { orgId: world.orgId, key: "administration" }, select: { id: true } });
  await db.staffProfile.create({ data: { orgId: world.orgId, membershipId: directorMembershipId, departmentId: adminDept?.id ?? null, jobTitleEn: "Group Director of Schools", jobTitleAr: "مديرة المدارس في المجموعة" } });
  await db.demoPersona.create({
    data: {
      orgId: world.orgId,
      key: "group_admin",
      membershipId: directorMembershipId,
      roleLabelEn: "Group Director",
      roleLabelAr: "مديرة مجموعة المدارس",
      blurbEn: "Compares three schools side by side and shares templates across the group.",
      blurbAr: "تقارن ثلاث مدارس جنبًا إلى جنب وتشارك القوالب بين مدارس المجموعة.",
      homePath: "/group",
      order: 50,
    },
  });

  // --- The group (stable id) ---
  const groupId = stableId("school-group", GROUP_SLUG);
  await db.schoolGroup.upsert({
    where: { slug: GROUP_SLUG },
    create: { id: groupId, slug: GROUP_SLUG, nameEn: "Horizon Education Group", nameAr: "مجموعة هورايزن التعليمية", createdAt: at(-320, 9, 0, now) },
    update: { nameEn: "Horizon Education Group", nameAr: "مجموعة هورايزن التعليمية", logoUrl: null },
  });
  const group = await db.schoolGroup.findUniqueOrThrow({ where: { slug: GROUP_SLUG } });
  await db.groupInvite.deleteMany({ where: { groupId: group.id } });
  await db.groupTemplatePush.deleteMany({ where: { groupId: group.id } });
  await db.groupMember.deleteMany({ where: { groupId: group.id } });
  await db.groupMember.createMany({
    data: [
      { groupId: group.id, userId: director.id, role: "ADMIN", titleEn: "Group Director of Schools", titleAr: "مديرة المدارس في المجموعة", createdAt: at(-300, 9, 0, now) },
      { groupId: group.id, userId: viewer.id, role: "VIEWER", titleEn: "Board Member", titleAr: "عضو مجلس الإدارة", createdAt: at(-120, 9, 0, now) },
    ],
  });
  // Horizon's own link was removed by the tenant wipe; add it back.
  await db.schoolGroupSchool.deleteMany({ where: { orgId: world.orgId } });
  await db.schoolGroupSchool.create({ data: { groupId: group.id, orgId: world.orgId, via: "platform", joinedAt: at(-300, 10, 0, now) } });

  // --- Two small schools ---
  const orgIds: string[] = [];
  for (const def of SCHOOLS) {
    const orgId = await seedSmallSchool(db, def, now, passwordHash);
    orgIds.push(orgId);
    await db.schoolGroupSchool.deleteMany({ where: { orgId } });
    await db.schoolGroupSchool.create({ data: { groupId: group.id, orgId, via: def.via, joinedAt: at(-def.joinedDaysAgo, 10, 0, now) } });
    if (def.via === "invite") {
      // The code itself is never stored; this used invite only shows in the group's history.
      await db.groupInvite.create({
        data: { groupId: group.id, codeHash: stableId("seed-invite", orgId), codeHint: "7KQM", createdById: director.id, expiresAt: at(-def.joinedDaysAgo + 12, 9, 0, now), usedAt: at(-def.joinedDaysAgo, 10, 0, now), usedByOrgId: orgId, createdAt: at(-def.joinedDaysAgo - 2, 9, 0, now) },
      });
      await db.auditEvent.create({ data: { orgId, actorUserId: null, action: "group.joined", entityType: "SchoolGroup", entityId: group.id, meta: { via: "invite", groupNameEn: group.nameEn }, createdAt: at(-def.joinedDaysAgo, 10, 0, now) } });
    } else {
      await db.auditEvent.create({ data: { orgId, actorUserId: null, action: "group.school_added", entityType: "SchoolGroup", entityId: group.id, meta: { via: "platform", groupNameEn: group.nameEn }, createdAt: at(-def.joinedDaysAgo, 10, 0, now) } });
    }
  }

  // --- Push history: Horizon's enrollment letter was shared with Abu Dhabi three weeks ago. ---
  const letter = await db.documentTemplate.findFirst({ where: { orgId: world.orgId }, orderBy: { nameEn: "asc" } });
  const target = await db.documentTemplate.findFirst({ where: { orgId: orgIds[0], key: letter?.key ?? "" } });
  if (letter && target) {
    const pushedAt = at(-21, 11, 15, now);
    await db.documentTemplate.update({ where: { id: target.id }, data: { bodyEn: letter.bodyEn, bodyAr: letter.bodyAr, signatoryEn: letter.signatoryEn, signatoryAr: letter.signatoryAr } });
    await db.auditEvent.create({
      data: { orgId: orgIds[0], actorUserId: director.id, action: "group.template_pushed", entityType: "DocumentTemplate", entityId: target.id, meta: { groupId: group.id, sourceOrgId: world.orgId, kind: "letter", sourceKey: letter.key, key: letter.key, mode: "replace", status: "replaced", warnings: [] }, createdAt: pushedAt },
    });
    await db.groupTemplatePush.create({
      data: { groupId: group.id, sourceOrgId: world.orgId, kind: "letter", sourceId: letter.id, labelEn: letter.nameEn, labelAr: letter.nameAr, targetOrgIds: [orgIds[0]], results: [{ orgId: orgIds[0], status: "replaced", key: letter.key, entityId: target.id, warnings: [] }], pushedById: director.id, createdAt: pushedAt },
    });
  }

  // --- Last visits, so "active users" shows real figures: a stable spread over the last six weeks. ---
  await db.$executeRaw`UPDATE "Membership" SET "lastSeenAt" = ${now}::timestamp - ((abs(hashtext("id")) % 42) * interval '1 day') - ((abs(hashtext("userId")) % 9) * interval '1 hour')
    WHERE "orgId" = ANY(${[world.orgId, ...orgIds]}::text[]) AND "status" = 'ACTIVE'`;
  log(`school group: 3 schools in ${Date.now() - started}ms`);
  return { groupId: group.id, orgIds };
}

async function seedSmallSchool(db: PrismaClient, def: SchoolDef, now: Date, passwordHash: string | null): Promise<string> {
  const r = rng(def.seed);
  const org = await db.organization.upsert({ where: { slug: def.slug }, create: { slug: def.slug, nameEn: def.name.en, nameAr: def.name.ar }, update: {} });
  const orgId = org.id;
  await wipeTenant(db, orgId);
  await db.organization.update({
    where: { id: orgId },
    data: {
      nameEn: def.name.en,
      nameAr: def.name.ar,
      shortNameEn: def.short.en,
      shortNameAr: def.short.ar,
      isDemo: false,
      emirate: def.emirate,
      regulator: def.regulator,
      curricula: def.curricula,
      primaryColor: def.primaryColor,
      hijriEnabled: true,
      enabledModules: [],
      onboardingSteps: def.completedSetup ? ["profile", "year", "curricula", "modules", "people", "invite"] : ["profile", "year", "curricula"],
      onboardingCompletedAt: def.completedSetup ? at(-def.joinedDaysAgo + 20, 12, 0, now) : null,
      createdAt: at(-def.joinedDaysAgo - 10, 9, 0, now),
    },
  });
  await installStarterTemplate(db, orgId, { curricula: def.curricula, locale: "en", now, installCourses: false, backdate: true });
  const roleIds = new Map((await db.role.findMany({ where: { orgId }, select: { id: true, key: true } })).map((x) => [x.key, x.id]));
  const taken = new Set<string>();

  // People
  type Person = { email: string; name: Bi };
  const staffPeople: Array<Person & StaffDef> = def.staff.map((s) => ({ ...s, email: emailFor(s.first.en, s.last.en, def.domain, taken), name: bi(`${s.first.en} ${s.last.en}`, `${s.first.ar} ${s.last.ar}`) }));
  const studentDefs = Array.from({ length: def.students }, (_, i) => {
    const female = i % 2 === 1;
    const first = (female ? FIRST_F : FIRST_M)[(i * 3 + def.seed) % 10];
    const last = LAST[(i * 7 + def.seed) % LAST.length];
    const grade = def.grades[i % def.grades.length];
    const guardianFemale = i % 3 !== 0;
    const gFirst = guardianFemale ? GUARDIAN_F[(i + def.seed) % 5] : GUARDIAN_M[(i + def.seed) % 5];
    return {
      first,
      last,
      grade,
      gender: female ? "F" : "M",
      email: emailFor(first.en, `${last.en} ${i}`, `students.${def.domain}`, taken),
      guardian: { first: gFirst, female: guardianFemale, email: emailFor(gFirst.en, `${last.en} ${i}`, `family.${def.domain}`, taken) },
    };
  });
  const allUsers = [
    ...staffPeople.map((s) => ({ email: s.email, nameEn: s.name.en, nameAr: s.name.ar })),
    ...studentDefs.map((s) => ({ email: s.email, nameEn: `${s.first.en} ${s.last.en}`, nameAr: `${s.first.ar} ${s.last.ar}` })),
    ...studentDefs.map((s) => ({ email: s.guardian.email, nameEn: `${s.guardian.first.en} ${s.last.en}`, nameAr: `${s.guardian.first.ar} ${s.last.ar}` })),
  ];
  await db.user.createMany({ data: allUsers.map((u) => ({ ...u, passwordHash })), skipDuplicates: true });
  const users = new Map((await db.user.findMany({ where: { email: { in: allUsers.map((u) => u.email) } }, select: { id: true, email: true } })).map((u) => [u.email, u.id]));
  await db.user.updateMany({ where: { email: { in: allUsers.map((u) => u.email) } }, data: { passwordHash, lastActiveOrgId: orgId } });

  const mid = (email: string) => stableId("membership", orgId, email);
  const memberships: Prisma.MembershipCreateManyInput[] = [];
  const memberRoles: Prisma.MembershipRoleCreateManyInput[] = [];
  const add = (email: string, roles: string[], title?: Bi) => {
    memberships.push({ id: mid(email), orgId, userId: users.get(email)!, status: "ACTIVE", titleEn: title?.en ?? null, titleAr: title?.ar ?? null, createdAt: at(-def.joinedDaysAgo - 5, 8, 0, now) });
    for (const rk of roles) if (roleIds.get(rk)) memberRoles.push({ orgId, membershipId: mid(email), roleId: roleIds.get(rk)! });
  };
  for (const s of staffPeople) add(s.email, s.roles, s.title);
  for (const s of studentDefs) {
    add(s.email, ["student"]);
    add(s.guardian.email, ["parent"], s.guardian.female ? bi("Mother", "الأم") : bi("Father", "الأب"));
  }
  await db.membership.createMany({ data: memberships });
  await db.membershipRole.createMany({ data: memberRoles });
  await db.staffProfile.createMany({ data: staffPeople.map((s) => ({ orgId, membershipId: mid(s.email), jobTitleEn: s.title.en, jobTitleAr: s.title.ar, gradeLevels: def.grades })) });
  const studentRows = studentDefs.map((s, i) => ({
    id: stableId("student", orgId, String(i)),
    orgId,
    membershipId: mid(s.email),
    studentNo: `${def.short.en.split(" ")[1].slice(0, 2).toUpperCase()}${String(2400 + i)}`,
    firstNameEn: s.first.en,
    lastNameEn: s.last.en,
    firstNameAr: s.first.ar,
    lastNameAr: s.last.ar,
    gradeLevel: s.grade,
    section: "A",
    gender: s.gender,
    curriculum: def.curricula[0],
    enrolledOn: dateOnly(-def.joinedDaysAgo - 30, now),
  }));
  await db.student.createMany({ data: studentRows });
  const guardianRows = studentDefs.map((s, i) => ({ id: stableId("guardian", orgId, String(i)), orgId, membershipId: mid(s.guardian.email), firstNameEn: s.guardian.first.en, lastNameEn: s.last.en, firstNameAr: s.guardian.first.ar, lastNameAr: s.last.ar, email: s.guardian.email }));
  await db.guardian.createMany({ data: guardianRows });
  await db.guardianLink.createMany({ data: studentRows.map((st, i) => ({ orgId, guardianId: guardianRows[i].id, studentId: st.id, isPrimary: true, relationshipEn: studentDefs[i].guardian.female ? "Mother" : "Father", relationshipAr: studentDefs[i].guardian.female ? "الأم" : "الأب" })) });

  const staffId = (role: string) => mid(staffPeople.find((s) => s.roles.includes(role))!.email);
  const admin = staffId("school_admin");
  const counselor = staffId("counselor");
  const teacher = staffId("teacher");

  // Requests (standard services only, plus one wellbeing request that the group never sees)
  const services = new Map((await db.serviceDefinition.findMany({ where: { orgId }, select: { id: true, key: true, nameEn: true, nameAr: true, requestPrefix: true, slaHours: true, sensitivity: true } })).map((s) => [s.key, s]));
  const keys = [...REQUEST_SERVICES, ...(def.grades.some((g) => g >= 9) ? SENIOR_SERVICES : [])].filter((k) => services.get(k)?.sensitivity === "STANDARD");
  const year = now.getUTCFullYear();
  const counters = new Map<string, number>();
  const number = (prefix: string) => {
    const k = `${prefix}-${year}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  };
  const requests: Prisma.RequestCreateManyInput[] = [];
  for (let i = 0; i < def.requests; i++) {
    const svc = services.get(keys[i % keys.length])!;
    const si = r.int(0, studentRows.length - 1);
    const daysAgo = i < 4 ? r.int(1, 6) : r.int(2, 58);
    const submittedAt = new Date(at(-daysAgo, 8 + (i % 6), (i * 13) % 60, now).getTime());
    const slaDueAt = new Date(submittedAt.getTime() + svc.slaHours * 3600_000);
    const done = daysAgo > 9 ? r.chance(0.85) : r.chance(0.3);
    const completedAt = done ? new Date(Math.min(now.getTime() - 3600_000, submittedAt.getTime() + r.int(5, Math.max(8, svc.slaHours + 30)) * 3600_000)) : null;
    const status = done ? "COMPLETED" : r.pick(["SUBMITTED", "IN_REVIEW", "PENDING_APPROVAL", "IN_PROGRESS"] as const);
    requests.push({
      orgId,
      number: number(svc.requestPrefix),
      serviceId: svc.id,
      requesterId: svc.key === "it_support" ? teacher : mid(studentDefs[si].guardian.email),
      studentId: svc.key === "it_support" ? null : studentRows[si].id,
      status,
      sensitivity: "STANDARD",
      titleEn: svc.nameEn,
      titleAr: svc.nameAr,
      progress: done ? 100 : r.pick([20, 40, 60]),
      assigneeId: admin,
      slaDueAt,
      submittedAt,
      completedAt,
      createdAt: submittedAt,
    });
  }
  const wellbeing = services.get("talk_to_someone");
  if (wellbeing) {
    const submittedAt = at(-3, 10, 0, now);
    requests.push({ orgId, number: number(wellbeing.requestPrefix), serviceId: wellbeing.id, requesterId: mid(studentDefs[0].email), studentId: studentRows[0].id, status: "IN_REVIEW", sensitivity: "WELLBEING", titleEn: wellbeing.nameEn, titleAr: wellbeing.nameAr, progress: 20, assigneeId: counselor, slaDueAt: new Date(submittedAt.getTime() - DAY), submittedAt, createdAt: submittedAt });
  }
  await db.request.createMany({ data: requests });
  for (const [key, value] of counters) await db.sequence.create({ data: { orgId, key, value } });

  // Sensitive cases and a sensitive overdue task: never part of any group figure.
  const wbCase = await db.case.create({ data: { orgId, number: `WB-${year}-0001`, type: "WELLBEING", sensitivity: "WELLBEING", studentId: studentRows[1].id, titleEn: "Wellbeing check-in follow up", titleAr: "متابعة جلسة الرفاه", assigneeId: counselor, status: "OPEN", openedAt: at(-12, 9, 0, now) } });
  const sgCase = await db.case.create({ data: { orgId, number: `SG-${year}-0001`, type: "SAFEGUARDING", sensitivity: "SAFEGUARDING", studentId: studentRows[2].id, titleEn: "Safeguarding concern", titleAr: "بلاغ حماية", assigneeId: counselor, status: "IN_PROGRESS", openedAt: at(-6, 9, 0, now) } });
  await db.task.createMany({
    data: [
      { orgId, titleEn: "Call the family back", titleAr: "معاودة الاتصال بالأسرة", status: "TODO", dueAt: at(-2, 12, 0, now), assigneeId: counselor, caseId: sgCase.id, sensitivity: "SAFEGUARDING" },
      { orgId, titleEn: "Plan the next check-in", titleAr: "تخطيط الجلسة التالية", status: "TODO", dueAt: at(-1, 12, 0, now), assigneeId: counselor, caseId: wbCase.id, sensitivity: "WELLBEING" },
      { orgId, titleEn: "Update the transport list", titleAr: "تحديث قائمة النقل", status: "TODO", dueAt: at(-3, 12, 0, now), assigneeId: admin },
      { orgId, titleEn: "Send the term calendar to families", titleAr: "إرسال تقويم الفصل إلى الأسر", status: "IN_PROGRESS", dueAt: at(-1, 15, 0, now), assigneeId: admin },
      { orgId, titleEn: "Order replacement ID cards", titleAr: "طلب بطاقات هوية بديلة", status: "TODO", dueAt: at(4, 12, 0, now), assigneeId: admin },
    ],
  });

  // Parent meetings: some held, some coming up; plus a wellbeing check-in that never counts.
  const types = new Map((await db.appointmentType.findMany({ where: { orgId }, select: { id: true, key: true } })).map((t) => [t.key, t.id]));
  const ptm = types.get("parent_teacher_meeting");
  const appts: Prisma.AppointmentCreateManyInput[] = [];
  if (ptm) {
    const offsets = def.completedSetup ? [-26, -19, -15, -11, -8, -4, -2, 2, 3, 6, 9, 13] : [-20, -9, -3, 4, 8];
    offsets.forEach((d, i) => {
      const startsAt = at(d, 13 + (i % 3), 0, now);
      const si = (i * 5) % studentRows.length;
      appts.push({ orgId, typeId: ptm, hostId: i % 2 ? teacher : counselor, bookedById: mid(studentDefs[si].guardian.email), studentId: studentRows[si].id, guardianId: guardianRows[si].id, startsAt, endsAt: new Date(startsAt.getTime() + 20 * 60_000), status: d < 0 ? (i === 1 ? "NO_SHOW" : "COMPLETED") : "CONFIRMED", locationEn: "Meeting room 2", locationAr: "قاعة الاجتماعات 2" });
    });
  }
  const checkin = types.get("wellbeing_checkin");
  if (checkin) {
    const startsAt = at(-5, 10, 0, now);
    appts.push({ orgId, typeId: checkin, hostId: counselor, bookedById: counselor, studentId: studentRows[1].id, caseId: wbCase.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), status: "COMPLETED" });
  }
  await db.appointment.createMany({ data: appts });

  // Career guidance (secondary school only): plans and university applications.
  if (def.grades.some((g) => g >= 11)) {
    const seniors = studentRows.filter((s) => s.gradeLevel >= 10);
    const statuses = ["APPROVED", "APPROVED", "APPROVED", "APPROVED", "APPROVED", "PROPOSED", "PROPOSED", "DRAFT"] as const;
    await db.studentCoursePlan.createMany({
      data: seniors.slice(0, statuses.length).map((s, i) => ({ orgId, studentId: s.id, name: "University plan", status: statuses[i], targetCountries: i % 2 ? ["GB", "AE"] : ["US", "CA"], proposedById: counselor, approvedById: statuses[i] === "APPROVED" ? counselor : null, approvedAt: statuses[i] === "APPROVED" ? at(-r.int(5, 60), 11, 0, now) : null, createdAt: at(-r.int(60, 120), 9, 0, now) })),
    });
    const unis = await db.university.findMany({ where: { orgId: null }, orderBy: { key: "asc" }, take: 8, select: { id: true } });
    const g12 = studentRows.filter((s) => s.gradeLevel === 12);
    const stages = ["RESEARCHING", "SHORTLISTED", "PREPARING", "PREPARING", "SUBMITTED", "SUBMITTED", "SUBMITTED", "INTERVIEW", "OFFER", "OFFER", "ACCEPTED", "REJECTED"] as const;
    if (unis.length) {
      await db.application.createMany({
        data: stages.map((stage, i) => ({ orgId, studentId: g12[i % g12.length].id, universityId: unis[i % unis.length].id, intakeYear: year + 1, stage, counselorId: counselor, submittedAt: ["SUBMITTED", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED"].includes(stage) ? at(-r.int(3, 40), 10, 0, now) : null, createdAt: at(-r.int(40, 100), 10, 0, now) })),
      });
    }
  }
  return orgId;
}
