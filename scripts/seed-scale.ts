// Synthetic full-size school for capacity testing: "Scale Test School, Sharjah" (slug scale-test).
// 1,554 students KG1 to Grade 12, about 2,500 guardians with sibling links, 180 staff, sections, a timetable,
// last year's and this year's attendance (daily and per-lesson marks, about 2 million rows), gradebook,
// report cards, requests and messages, notifications, audit events, fees through the real billing services,
// admissions applications and course choices.
//
// It is NEVER part of the demo seed and must never run against a production database. Run it only against a
// local or staging copy:  npx tsx scripts/seed-scale.ts
// Options (environment): SCALE_STUDENTS (default 1554), SCALE_SEED (default 20261026), SCALE_SKIP_LESSONS=1.
// Re-runnable: the scale-test school is wiped first. Users are global and kept (same emails each run).
// Everything comes from a fixed random seed and dates relative to today, so runs on the same day match.
// All people are fictional. Every account's password is SCALE_PASSWORD below (test data only).
import bcrypt from "bcryptjs";
import { PrismaClient, type FeeItemKind, type FeePaymentMethod, type Prisma, type VatTreatment } from "@prisma/client";
import { at, dateOnly, rng, stableId, wipeTenant } from "../prisma/seed/lib";
import { academicStartYear, installHolidays, installStarterTemplate } from "../prisma/seed/starter";
import { DEFAULT_CODES, statusOf } from "../src/server/attendance/codes";
import { execCtx, type Tx } from "../src/server/db";
import type { Actor } from "../src/server/fees/ledger";
import { balanceOf, recordPayment } from "../src/server/fees/ledger";
import { createBillingRun, processBillingBatch } from "../src/server/fees/billing";
import { DEFAULT_BEHAVIOUR, saveFeeItem, savePlan, suggestParts } from "../src/server/fees/schedule";
import { syncFamilyAccounts } from "../src/server/fees/accounts";
import { createReturn } from "../src/server/govreports/service";

export const SCALE_SLUG = "scale-test";
export const SCALE_PASSWORD = "ScaleTest2026!";
const DAY = 86_400_000;
const TARGET_STUDENTS = Number(process.env.SCALE_STUDENTS ?? 1554);
const SEED = Number(process.env.SCALE_SEED ?? 20261026);
const SKIP_LESSONS = process.env.SCALE_SKIP_LESSONS === "1";

type Bi = { en: string; ar: string };
const bi = (s: string): Bi => {
  const [en, ar] = s.split("|");
  return { en, ar };
};

// --- Fictional name pools (English | Arabic) -------------------------------------------------------------------
const ARAB_M = "Ahmed|أحمد,Mohammed|محمد,Omar|عمر,Ali|علي,Hamad|حمد,Khalid|خالد,Saeed|سعيد,Rashid|راشد,Sultan|سلطان,Faisal|فيصل,Yousef|يوسف,Ibrahim|إبراهيم,Hassan|حسن,Hussain|حسين,Abdullah|عبدالله,Majid|ماجد,Tariq|طارق,Karim|كريم,Nabil|نبيل,Sami|سامي,Fadi|فادي,Ziad|زياد,Rami|رامي,Waleed|وليد,Bilal|بلال,Hamza|حمزة,Mustafa|مصطفى,Adel|عادل,Jamal|جمال,Anas|أنس,Yazan|يزن,Laith|ليث,Qais|قيس,Marwan|مروان,Ayman|أيمن,Adam|آدم,Elias|إلياس,Rayan|ريان,Ammar|عمار,Mahmoud|محمود,Salem|سالم,Obaid|عبيد,Mansour|منصور,Eisa|عيسى,Musa|موسى,Idris|إدريس,Hadi|هادي,Taim|تيم,Zain|زين,Fares|فارس,Nasser|ناصر,Saif|سيف,Humaid|حميد,Khalifa|خليفة,Jassim|جاسم,Badr|بدر".split(",").map(bi);
const ARAB_F = "Fatima|فاطمة,Mariam|مريم,Aisha|عائشة,Noor|نور,Sara|سارة,Layla|ليلى,Hessa|حصة,Shamma|شما,Moza|موزة,Latifa|لطيفة,Reem|ريم,Dana|دانة,Lina|لينا,Rana|رنا,Hala|هالة,Huda|هدى,Salma|سلمى,Yasmin|ياسمين,Amal|أمل,Nadia|نادية,Rania|رانيا,Dalia|داليا,Farah|فرح,Jana|جنى,Joud|جود,Lujain|لجين,Malak|ملاك,Rahaf|رهف,Zainab|زينب,Khadija|خديجة,Asma|أسماء,Hind|هند,Maitha|ميثاء,Alia|علياء,Ghada|غادة,Tala|تالا,Yara|يارا,Leen|لين,Hana|هناء,Iman|إيمان,Bushra|بشرى,Afra|عفراء,Sheikha|شيخة,Mira|ميرا,Lama|لمى,Razan|رزان,Dima|ديما,Sama|سما,Rawan|روان,Aseel|أسيل,Nouf|نوف,Wafa|وفاء,Basma|بسمة,Ruba|ربى".split(",").map(bi);
const INTL_M = "Arjun|أرجون,Rohan|روهان,Aarav|آراف,Vikram|فيكرام,Imran|عمران,Zubair|زبير,Daniel|دانيال,Ethan|إيثان,Lucas|لوكاس,Noah|نوح,James|جيمس,Leo|ليو,Marco|ماركو,Jose|خوسيه,Miguel|ميغيل,Kwame|كوامي,David|ديفيد,Samuel|صموئيل,Ryan|رايان,Aryan|آريان".split(",").map(bi);
const INTL_F = "Priya|بريا,Ananya|أنانيا,Kavya|كافيا,Ayesha|عائشة,Emma|إيما,Sofia|صوفيا,Chloe|كلوي,Maria|ماريا,Grace|غريس,Hannah|هانا,Olivia|أوليفيا,Isabel|إيزابيل,Meera|ميرا,Zara|زارا,Anna|آنا,Camille|كاميل,Abena|أبينا,Diya|ديا,Mia|ميا,Ella|إيلا".split(",").map(bi);
type Origin = { last: Bi; nat: Bi; arab: boolean };
const ORIGINS: Origin[] = [
  ...["Al Hammadi|الحمادي", "Al Mazrouei|المزروعي", "Al Shamsi|الشامسي", "Al Suwaidi|السويدي", "Al Nuaimi|النعيمي", "Al Ketbi|الكتبي", "Al Marri|المري", "Al Zaabi|الزعابي", "Al Dhaheri|الظاهري", "Al Kaabi|الكعبي", "Al Hosani|الحوسني", "Al Ali|العلي", "Al Blooshi|البلوشي", "Al Ameri|العامري", "Al Shehhi|الشحي", "Al Naqbi|النقبي", "Al Tunaiji|الطنيجي", "Al Mheiri|المهيري", "Al Sharqi|الشرقي", "Al Hajeri|الهاجري"].map((x) => ({ last: bi(x), nat: bi("Emirati|إماراتي"), arab: true })),
  ...["Haddad|حداد", "Khoury|خوري", "Nassar|نصار", "Saleh|صالح", "Hamdan|حمدان", "Darwish|درويش", "Khalil|خليل", "Barakat|بركات", "Haddadin|حدادين", "Odeh|عودة", "Qasem|قاسم", "Hijazi|حجازي", "Sabbagh|صباغ", "Ghanem|غانم", "Shaheen|شاهين", "Awad|عوض", "Jaber|جابر", "Salameh|سلامة", "Kanaan|كنعان", "Halabi|الحلبي", "Omari|العمري", "Zoubi|الزعبي", "Khatib|الخطيب", "Najjar|النجار", "Kurdi|الكردي"].map((x, i) => ({ last: bi(x), nat: bi(["Jordanian|أردني", "Syrian|سوري", "Lebanese|لبناني", "Palestinian|فلسطيني"][i % 4]), arab: true })),
  ...["Fahmy|فهمي", "Mostafa|مصطفى", "Abdelaziz|عبدالعزيز", "El Sayed|السيد", "Yassin|ياسين", "Sharaf|شرف", "Taha|طه", "Rizk|رزق", "Nasr|نصر", "Bakr|بكر"].map((x) => ({ last: bi(x), nat: bi("Egyptian|مصري"), arab: true })),
  ...["Al Harbi|الحربي", "Al Otaibi|العتيبي", "Al Qahtani|القحطاني", "Al Ghamdi|الغامدي", "Al Rashed|الراشد"].map((x) => ({ last: bi(x), nat: bi("Saudi|سعودي"), arab: true })),
  ...["Al Tamimi|التميمي", "Al Jubouri|الجبوري", "Al Obaidi|العبيدي"].map((x) => ({ last: bi(x), nat: bi("Iraqi|عراقي"), arab: true })),
  ...["Sharma|شارما", "Nair|ناير", "Menon|مينون", "Reddy|ريدي", "Iyer|آيير", "Kapoor|كابور"].map((x) => ({ last: bi(x), nat: bi("Indian|هندي"), arab: false })),
  ...["Khan|خان", "Qureshi|قريشي", "Siddiqui|صديقي", "Malik|مالك"].map((x) => ({ last: bi(x), nat: bi("Pakistani|باكستاني"), arab: false })),
  ...["Santos|سانتوس", "Reyes|رييس", "Cruz|كروز"].map((x) => ({ last: bi(x), nat: bi("Filipino|فلبيني"), arab: false })),
  ...["Clarke|كلارك", "Wilson|ويلسون", "Brown|براون", "Martin|مارتن", "Fischer|فيشر", "Rossi|روسي"].map((x, i) => ({ last: bi(x), nat: bi(["British|بريطاني", "American|أمريكي", "Canadian|كندي", "French|فرنسي", "German|ألماني", "Italian|إيطالي"][i]), arab: false })),
  ...["Mensah|منساه", "Okafor|أوكافور"].map((x, i) => ({ last: bi(x), nat: bi(["Ghanaian|غاني", "Nigerian|نيجيري"][i]), arab: false })),
];
const HOUSES = ["Falcons|الصقور", "Oryx|المها", "Dunes|الكثبان", "Pearls|اللآلئ"].map(bi);

/** Students per grade (KG1 = -1, KG2 = 0). Sums to 1,554 at the default size. */
function gradeCounts(total: number): Map<number, number> {
  const base: Array<[number, number]> = [[-1, 96], [0, 104], [1, 120], [2, 120], [3, 120], [4, 120], [5, 120], [6, 118], [7, 118], [8, 118], [9, 100], [10, 100], [11, 100], [12, 100]];
  const sum = base.reduce((s, [, n]) => s + n, 0);
  const out = new Map(base.map(([g, n]) => [g, Math.round((n * total) / sum)]));
  const diff = total - [...out.values()].reduce((s, n) => s + n, 0);
  out.set(1, out.get(1)! + diff);
  return out;
}
const SECTION_SIZE = (g: number) => (g <= 0 ? 24 : 25);
const SECTIONS = "ABCDEFGH".split("");

/** Weekly lessons per subject by band (37 lessons a week: 8 a day Monday to Thursday, 5 on Friday). */
const PLAN: Record<"primary" | "middle" | "high", Array<[string, number]>> = {
  primary: [["ENG", 7], ["MATH", 7], ["ARAB", 6], ["ISL", 3], ["SOC", 2], ["BIO", 5], ["PE", 3], ["ART", 2], ["MUSIC", 2]],
  middle: [["ENG", 6], ["MATH", 6], ["ARAB", 5], ["ISL", 3], ["SOC", 2], ["BIO", 3], ["PHYS", 2], ["CHEM", 2], ["CS", 2], ["PE", 2], ["ART", 2], ["FR", 2]],
  high: [["ENG", 6], ["MATH", 6], ["ARAB", 4], ["ISL", 2], ["SOC", 2], ["PHYS", 3], ["CHEM", 3], ["BIO", 3], ["CS", 2], ["ECON", 2], ["PE", 2], ["FR", 2]],
};
const bandOf = (g: number) => (g <= 5 ? "primary" : g <= 8 ? "middle" : "high");
const MAX_LOAD = 25;

// --- Infrastructure ------------------------------------------------------------------------------------------
const r = rng(SEED);
let idSeq = 0;
/** Deterministic 25-character ids (the same school on every run with the same seed). */
const nid = () => "sc" + (++idSeq).toString(36).padStart(9, "0") + Math.floor(r.next() * 36 ** 7).toString(36).padStart(7, "0") + Math.floor(r.next() * 36 ** 7).toString(36).padStart(7, "0");
const timings: Array<{ step: string; ms: number; rows: number }> = [];
const counts = new Map<string, number>();
const bump = (table: string, n: number) => counts.set(table, (counts.get(table) ?? 0) + n);
const log = (m: string) => console.log(`[scale] ${m}`);

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const before = [...counts.values()].reduce((s, n) => s + n, 0);
  const res = await fn();
  const rows = [...counts.values()].reduce((s, n) => s + n, 0) - before;
  timings.push({ step: name, ms: Date.now() - t0, rows });
  log(`${name}: ${rows.toLocaleString("en")} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return res;
}

/** Insert in chunks, a few statements in flight at once. */
async function insert<T>(db: PrismaClient, table: string, rows: T[], chunk = 4000) {
  const model = (db as unknown as Record<string, { createMany: (a: { data: T[]; skipDuplicates?: boolean }) => Promise<{ count: number }> }>)[table];
  const parts: T[][] = [];
  for (let i = 0; i < rows.length; i += chunk) parts.push(rows.slice(i, i + chunk));
  for (let i = 0; i < parts.length; i += 3) await Promise.all(parts.slice(i, i + 3).map((p) => model.createMany({ data: p })));
  bump(table, rows.length);
}

const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// --- Types -------------------------------------------------------------------------------------------------------
type Person = { userId: string; membershipId: string; email: string; first: Bi; last: Bi; gender: "F" | "M" };
type Staff = Person & { key: string; roles: string[]; subject: string | null; dept: string | null; load: number; kg: boolean };
type Kid = { id: string; membershipId: string | null; first: Bi; last: Bi; gender: "F" | "M"; grade: number; section: string; family: number; nat: Bi; ability: number; absence: number; lateness: number; enrolledOn: Date; studentNo: string };
type Family = { idx: number; origin: Origin; guardians: Array<Person & { id: string; rel: Bi; primary: boolean }>; kids: Kid[] };
type Klass = { id: string; yearId: string; grade: number; section: string; subject: string | null; teacherId: string | null; homeroom: boolean; periods: number; studentIds: string[] };
type Slot = { id: string; classId: string; teacherId: string | null; day: number; periodNo: number; start: string };
type YearInfo = { id: string; nameEn: string; nameAr: string; startsOn: Date; endsOn: Date; terms: Array<{ id: string; nameEn: string; nameAr: string; startsOn: Date; endsOn: Date }> };

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && process.env.SCALE_ALLOW_REMOTE !== "yes") {
    throw new Error(`Refusing to seed synthetic data on ${host}. Set SCALE_ALLOW_REMOTE=yes only for a disposable staging database.`);
  }
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  const db = new PrismaClient({ datasourceUrl: url });
  const tx = db as unknown as Tx;
  const started = Date.now();
  const now = new Date();
  const sizeBefore = await dbSize(db);
  log(`database ${new URL(url).pathname.slice(1)} is ${sizeBefore} before seeding; target ${TARGET_STUDENTS} students, seed ${SEED}`);

  // --- Organization and starter template --------------------------------------------------------------------------
  const org = await step("organization and starter template", async () => {
    const o = await db.organization.upsert({
      where: { slug: SCALE_SLUG },
      create: { slug: SCALE_SLUG, nameEn: "Scale Test School, Sharjah", nameAr: "مدرسة اختبار السعة، الشارقة" },
      update: {},
    });
    await wipeTenant(db, o.id);
    await db.organization.update({
      where: { id: o.id },
      data: {
        nameEn: "Scale Test School, Sharjah",
        nameAr: "مدرسة اختبار السعة، الشارقة",
        shortNameEn: "Scale Test",
        shortNameAr: "اختبار السعة",
        isDemo: false,
        defaultLocale: "en",
        timezone: "Asia/Dubai",
        currency: "AED",
        weekDays: [1, 2, 3, 4, 5],
        regulator: "SPEA",
        emirate: "Sharjah",
        dataRegion: "me-central-1",
        curricula: ["AMERICAN"],
        aiEnabled: false,
        aiSensitiveDataEnabled: false,
        onboardingCompletedAt: now,
        primaryColor: "#1F4E79",
        accentColor: "#B8860B",
      },
    });
    await installStarterTemplate(db, o.id, { curricula: ["AMERICAN"], locale: "en", now, installCourses: false, backdate: true });
    return o;
  });
  const orgId = org.id;

  // --- Years: last year (history), this year, next year (admissions and course choices) ------------------------------
  const years = await step("academic years", async () => {
    const cur = await db.academicYear.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    const y = academicStartYear(now);
    const mk = async (yy: number) => {
      const year = await db.academicYear.create({ data: { orgId, nameEn: `${yy}-${yy + 1}`, nameAr: `${yy}-${yy + 1}`, startsOn: utc(yy, 8, 24), endsOn: utc(yy + 1, 7, 2), isCurrent: false } });
      await db.term.createMany({
        data: [
          { orgId, academicYearId: year.id, nameEn: "Autumn term", nameAr: "الفصل الأول", startsOn: utc(yy, 8, 24), endsOn: utc(yy, 12, 12) },
          { orgId, academicYearId: year.id, nameEn: "Spring term", nameAr: "الفصل الثاني", startsOn: utc(yy + 1, 1, 5), endsOn: utc(yy + 1, 3, 27) },
          { orgId, academicYearId: year.id, nameEn: "Summer term", nameAr: "الفصل الثالث", startsOn: utc(yy + 1, 4, 13), endsOn: utc(yy + 1, 7, 2) },
        ],
      });
      return year;
    };
    const prev = await mk(y - 1);
    const next = await mk(y + 1);
    await installHolidays(db, orgId, prev.id, at(-420, 9, 0, now));
    const curBell = await db.bellPeriod.findMany({ where: { orgId, academicYearId: cur.id } });
    await db.bellPeriod.createMany({ data: curBell.map(({ id: _i, academicYearId: _a, ...b }) => ({ ...b, academicYearId: prev.id })) });
    const load = async (id: string): Promise<YearInfo> => {
      const yr = await db.academicYear.findUniqueOrThrow({ where: { id }, include: { terms: { orderBy: { startsOn: "asc" } } } });
      return { id: yr.id, nameEn: yr.nameEn, nameAr: yr.nameAr, startsOn: yr.startsOn, endsOn: yr.endsOn, terms: yr.terms };
    };
    return { prev: await load(prev.id), cur: await load(cur.id), next: await load(next.id) };
  });

  const roleIds = new Map((await db.role.findMany({ where: { orgId }, select: { id: true, key: true } })).map((x) => [x.key, x.id]));
  const deptIds = new Map((await db.department.findMany({ where: { orgId }, select: { id: true, key: true } })).map((x) => [x.key, x.id]));
  const subjects = new Map((await db.subject.findMany({ where: { orgId }, select: { id: true, code: true, nameEn: true, nameAr: true, department: { select: { key: true } } } })).map((s) => [s.code, s]));
  const passwordHash = await bcrypt.hash(SCALE_PASSWORD, 10);

  // --- People -----------------------------------------------------------------------------------------------------
  const counter = new Map<string, number>();
  const emailFor = (first: string, last: string, domain: string) => {
    const base = `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[^a-z.]+/g, "");
    const n = (counter.get(`${base}@${domain}`) ?? 0) + 1;
    counter.set(`${base}@${domain}`, n);
    return `${base}${n === 1 ? "" : n}@${domain}`;
  };

  const { staff, families, kids } = await step("people: staff, families, students", async () => {
    // Staff: 180 people across the roles a school this size has.
    const staffPlan: Array<{ key: string; roles: string[]; n: number; dept: string | null; title: Bi }> = [
      { key: "admin", roles: ["school_admin"], n: 2, dept: "administration", title: bi("School Administrator|مسؤول إدارة المدرسة") },
      { key: "principal", roles: ["principal"], n: 1, dept: "administration", title: bi("Principal|مدير المدرسة") },
      { key: "registrar", roles: ["registrar"], n: 2, dept: "administration", title: bi("Registrar|مسجل المدرسة") },
      { key: "admissions", roles: ["admissions_officer"], n: 2, dept: "administration", title: bi("Admissions Officer|مسؤول القبول") },
      { key: "finance", roles: ["finance_officer"], n: 3, dept: "administration", title: bi("Finance Officer|مسؤول مالي") },
      { key: "counselor", roles: ["counselor"], n: 4, dept: "student_services", title: bi("School Counselor|مرشد طلابي") },
      { key: "career", roles: ["career_advisor"], n: 2, dept: "student_services", title: bi("Career Advisor|مستشار مهني") },
      { key: "wellbeing", roles: ["wellbeing_lead"], n: 1, dept: "student_services", title: bi("Wellbeing Lead|مسؤول الرفاه") },
      { key: "dsl", roles: ["dsl"], n: 1, dept: "student_services", title: bi("Designated Safeguarding Lead|مسؤول حماية الطفل المعيّن") },
      { key: "deputy_dsl", roles: ["deputy_dsl"], n: 2, dept: "student_services", title: bi("Deputy Safeguarding Lead|نائب مسؤول حماية الطفل") },
      { key: "nurse", roles: ["nurse"], n: 2, dept: "student_services", title: bi("School Nurse|ممرض المدرسة") },
      { key: "it", roles: ["it_support"], n: 2, dept: "administration", title: bi("IT Support|الدعم التقني") },
      { key: "head_it", roles: ["head_of_it"], n: 1, dept: "administration", title: bi("Head of IT|رئيس قسم تقنية المعلومات") },
    ];
    const subjectTeachers: Array<[string, number]> = [["ENG", 17], ["MATH", 17], ["ARAB", 14], ["ISL", 7], ["SOC", 6], ["BIO", 10], ["PHYS", 4], ["CHEM", 4], ["CS", 3], ["ECON", 2], ["PE", 7], ["ART", 4], ["MUSIC", 3], ["FR", 3]];
    const heads = ["ENG", "MATH", "ARAB", "BIO", "PHYS", "SOC", "PE", "ART", "CS"];
    const out: Staff[] = [];
    const pushStaff = (key: string, roles: string[], subject: string | null, dept: string | null, kg = false, fixedEmail?: string) => {
      const gender: "F" | "M" = r.chance(0.62) ? "F" : "M";
      const intl = r.chance(0.35);
      const first = r.pick(gender === "F" ? (intl ? INTL_F : ARAB_F) : intl ? INTL_M : ARAB_M);
      const origin = r.pick(ORIGINS.filter((o) => o.arab !== intl));
      const email = fixedEmail ?? emailFor(first.en, origin.last.en, "staff.scale.example");
      out.push({ key, roles, subject, dept, kg, userId: "", membershipId: "", email, first, last: origin.last, gender, load: 0 });
    };
    for (const p of staffPlan) for (let i = 0; i < p.n; i++) pushStaff(p.key, p.roles, null, p.dept, false, i === 0 && ["admin", "principal", "dsl", "registrar", "finance", "counselor", "admissions"].includes(p.key) ? `${p.key}@staff.scale.example` : undefined);
    for (const [code, n] of subjectTeachers) {
      const dept = subjects.get(code)?.department?.key ?? null;
      for (let i = 0; i < n; i++) pushStaff(`teacher_${code}`, heads.includes(code) && i === 0 ? ["teacher", "department_head"] : ["teacher"], code, dept);
    }
    const kgSections = [-1, 0].reduce((s, g) => s + Math.ceil(gradeCounts(TARGET_STUDENTS).get(g)! / SECTION_SIZE(g)), 0);
    for (let i = 0; i < kgSections; i++) pushStaff("teacher_kg", ["teacher"], null, null, true);
    // Learning support, assistants and specialists without a timetable of their own.
    while (out.length < 180) pushStaff("teacher_support", ["teacher"], null, null);
    // The named test personas get fixed addresses.
    const mathT = out.find((s) => s.subject === "MATH" && !s.roles.includes("department_head"))!;
    mathT.email = "teacher@staff.scale.example";
    return { staff: out, ...buildFamilies() };
  });

  function buildFamilies() {
    const perGrade = gradeCounts(TARGET_STUDENTS);
    // Seats left per grade; families fill them with siblings a few grades apart.
    const left = new Map(perGrade);
    const fams: Family[] = [];
    const all: Kid[] = [];
    const sizes = () => {
      const x = r.next();
      return x < 0.78 ? 1 : x < 0.95 ? 2 : x < 0.99 ? 3 : 4;
    };
    let studentSeq = 0;
    // The first family is the test family: a KG1 child and a Grade 9 child (fixed parent and student addresses).
    while ([...left.values()].some((n) => n > 0)) {
      const idx = fams.length;
      const origin = idx === 0 ? ORIGINS[0] : ORIGINS[Math.floor(r.next() ** 1.3 * ORIGINS.length)];
      const arab = origin.arab;
      const n = sizes();
      const open = [...left.entries()].filter(([, v]) => v > 0).map(([g]) => g);
      const firstGrade = idx === 0 ? -1 : r.pick(open);
      const grades: number[] = [firstGrade];
      if (idx === 0) grades.push(9);
      for (let i = 1; i < n && idx > 0; i++) {
        const cands = open.filter((g) => !grades.includes(g) && Math.abs(g - grades[grades.length - 1]) >= 1 && Math.abs(g - grades[grades.length - 1]) <= 4 && (left.get(g) ?? 0) > 0);
        if (!cands.length) break;
        grades.push(r.pick(cands));
      }
      const famKids: Kid[] = [];
      for (const g of grades) {
        left.set(g, left.get(g)! - 1);
        const gender: "F" | "M" = r.chance(0.5) ? "F" : "M";
        const first = r.pick(gender === "F" ? (arab ? ARAB_F : INTL_F) : arab ? ARAB_M : INTL_M);
        const persistent = r.chance(0.05);
        const kid: Kid = {
          id: nid(),
          membershipId: null,
          first,
          last: origin.last,
          gender,
          grade: g,
          section: "A",
          family: idx,
          nat: origin.nat,
          ability: Math.max(30, Math.min(98, 72 + (r.next() + r.next() + r.next() - 1.5) * 24)),
          absence: persistent ? 0.08 + r.next() * 0.1 : 0.012 + r.next() * 0.03,
          lateness: r.chance(0.08) ? 0.12 : 0.02,
          enrolledOn: utc(academicStartYear(new Date()) - Math.max(0, Math.min(g + 1, r.int(0, 8))), 8, 24),
          studentNo: `ST${String(26000 + ++studentSeq).padStart(6, "0")}`,
        };
        famKids.push(kid);
        all.push(kid);
      }
      const mother = r.pick(arab ? ARAB_F : INTL_F);
      const father = r.pick(arab ? ARAB_M : INTL_M);
      const guardians: Family["guardians"] = [
        { id: nid(), userId: "", membershipId: "", email: emailFor(mother.en, origin.last.en, "parents.scale.example"), first: mother, last: origin.last, gender: "F", rel: bi("Mother|الأم"), primary: r.chance(0.55) },
        { id: nid(), userId: "", membershipId: "", email: emailFor(father.en, origin.last.en, "parents.scale.example"), first: father, last: origin.last, gender: "M", rel: bi("Father|الأب"), primary: false },
      ];
      if (!guardians[0].primary) guardians[1].primary = true;
      if (r.chance(0.03)) {
        const gm = r.pick(arab ? ARAB_F : INTL_F);
        guardians.push({ id: nid(), userId: "", membershipId: "", email: emailFor(gm.en, origin.last.en, "parents.scale.example"), first: gm, last: origin.last, gender: "F", rel: bi("Grandmother|الجدة"), primary: false });
      }
      fams.push({ idx, origin, guardians, kids: famKids });
    }
    // Sections: split each grade into sections of about 25, families spread across them.
    for (const [g] of perGrade) {
      const inGrade = r.shuffle(all.filter((k) => k.grade === g));
      const nSec = Math.ceil(inGrade.length / SECTION_SIZE(g));
      inGrade.forEach((k, i) => (k.section = SECTIONS[i % nSec]));
    }
    // The test family: a KG1 child and a Grade 9 child, with fixed parent addresses.
    const fam = fams[0];
    fam.guardians[0].email = "parent@parents.scale.example";
    fam.kids[0].enrolledOn = utc(academicStartYear(new Date()), 8, 24);
    // A few children who start after today (enrolled, not started yet): no attendance until they start.
    const nowAt = new Date();
    for (const k of all.filter((x) => x.grade === -1 && x.family !== 0).slice(0, 4)) k.enrolledOn = new Date(dateOnly(7 + r.int(0, 14), nowAt).getTime());
    return { families: fams, kids: all, testFamily: fam };
  }

  // Users and memberships
  await step("users and memberships", async () => {
    type U = { email: string; nameEn: string; nameAr: string };
    const users: U[] = [];
    for (const s of staff) users.push({ email: s.email, nameEn: `${s.first.en} ${s.last.en}`, nameAr: `${s.first.ar} ${s.last.ar}` });
    for (const f of families) for (const g of f.guardians) users.push({ email: g.email, nameEn: `${g.first.en} ${g.last.en}`, nameAr: `${g.first.ar} ${g.last.ar}` });
    // Students from Grade 4 have their own accounts.
    const kidEmail = new Map<string, string>();
    for (const k of kids) if (k.grade >= 4) {
      const e = emailFor(k.first.en, k.last.en, "students.scale.example");
      kidEmail.set(k.id, e);
      users.push({ email: e, nameEn: `${k.first.en} ${k.last.en}`, nameAr: `${k.first.ar} ${k.last.ar}` });
    }
    const testKid = families.find((f) => f.guardians[0].email === "parent@parents.scale.example")!.kids.find((k) => k.grade >= 4);
    if (testKid) {
      const old = kidEmail.get(testKid.id)!;
      kidEmail.set(testKid.id, "student@students.scale.example");
      users.find((u) => u.email === old)!.email = "student@students.scale.example";
    }
    for (let i = 0; i < users.length; i += 2000) await db.user.createMany({ data: users.slice(i, i + 2000).map((u) => ({ ...u, passwordHash, emailVerified: at(-300, 9, 0, now) })), skipDuplicates: true });
    await db.user.updateMany({ where: { email: { in: users.map((u) => u.email) } }, data: { passwordHash, lastActiveOrgId: orgId } });
    const ids = new Map<string, string>();
    for (let i = 0; i < users.length; i += 5000) for (const u of await db.user.findMany({ where: { email: { in: users.slice(i, i + 5000).map((x) => x.email) } }, select: { id: true, email: true } })) ids.set(u.email, u.id);
    bump("User", users.length);
    const mRows: Prisma.MembershipCreateManyInput[] = [];
    const mrRows: Prisma.MembershipRoleCreateManyInput[] = [];
    const add = (email: string, roles: string[], title: Bi | null, created: Date) => {
      const mid = stableId("membership", orgId, email);
      mRows.push({ id: mid, orgId, userId: ids.get(email)!, status: "ACTIVE", titleEn: title?.en ?? null, titleAr: title?.ar ?? null, createdAt: created, lastSeenAt: at(-r.int(0, 20), 8, 0, now) });
      for (const k of roles) mrRows.push({ id: nid(), orgId, membershipId: mid, roleId: roleIds.get(k)! });
      return mid;
    };
    for (const s of staff) {
      s.userId = ids.get(s.email)!;
      s.membershipId = add(s.email, s.roles, null, at(-500, 8, 0, now));
    }
    for (const f of families) for (const g of f.guardians) {
      g.userId = ids.get(g.email)!;
      g.membershipId = add(g.email, ["parent"], g.rel, at(-r.int(60, 500), 8, 0, now));
    }
    for (const k of kids) {
      const e = kidEmail.get(k.id);
      if (e) k.membershipId = add(e, ["student"], null, at(-r.int(60, 500), 8, 0, now));
    }
    await insert(db, "membership", mRows);
    await insert(db, "membershipRole", mrRows);
  });

  // Staff profiles, students, guardians, links
  await step("profiles, students, guardians, links", async () => {
    await insert(db, "staffProfile", staff.map((s, i) => ({ orgId, membershipId: s.membershipId, departmentId: s.dept ? deptIds.get(s.dept) ?? null : null, employeeNo: `STS-${String(2001 + i)}`, jobTitleEn: s.subject ? `${subjects.get(s.subject)?.nameEn} Teacher` : s.kg ? "Kindergarten Teacher" : s.key === "teacher_support" ? "Learning Support Teacher" : s.roles[0].replace(/_/g, " "), jobTitleAr: s.subject ? `معلم ${subjects.get(s.subject)?.nameAr}` : s.kg ? "معلمة رياض الأطفال" : "معلم دعم التعلم", phone: `+971 6 555 ${String(1000 + i)}`, gradeLevels: [] })));
    const campusId = (await db.campus.findFirstOrThrow({ where: { orgId } })).id;
    const studentRows: Prisma.StudentCreateManyInput[] = kids.map((k) => {
      const house = HOUSES[k.family % HOUSES.length];
      const age = k.grade + 6;
      return {
        id: k.id,
        orgId,
        membershipId: k.membershipId,
        campusId,
        studentNo: k.studentNo,
        firstNameEn: k.first.en,
        lastNameEn: k.last.en,
        firstNameAr: k.first.ar,
        lastNameAr: k.last.ar,
        gradeLevel: k.grade,
        section: k.section,
        dateOfBirth: utc(academicStartYear(now) - age, r.int(1, 12), r.int(1, 28)),
        gender: k.gender,
        nationalityEn: k.nat.en,
        nationalityAr: k.nat.ar,
        status: "ACTIVE",
        enrolledOn: k.enrolledOn,
        houseEn: house.en,
        houseAr: house.ar,
        curriculum: "AMERICAN",
        hasSen: r.chance(0.06),
        createdAt: new Date(Math.min(k.enrolledOn.getTime(), now.getTime()) - 30 * DAY),
      };
    });
    await insert(db, "student", studentRows);
    const gRows: Prisma.GuardianCreateManyInput[] = [];
    const lRows: Prisma.GuardianLinkCreateManyInput[] = [];
    for (const f of families) {
      for (const g of f.guardians) {
        gRows.push({ id: g.id, orgId, membershipId: g.membershipId, firstNameEn: g.first.en, lastNameEn: g.last.en, firstNameAr: g.first.ar, lastNameAr: g.last.ar, email: g.email, phone: `+971 5${r.int(0, 8)} ${r.int(100, 999)} ${r.int(1000, 9999)}`, preferredLoc: f.origin.arab && r.chance(0.6) ? "ar" : "en" });
        for (const k of f.kids) lRows.push({ id: nid(), orgId, guardianId: g.id, studentId: k.id, relationshipEn: g.rel.en, relationshipAr: g.rel.ar, isPrimary: g.primary, canApprove: g.rel.en !== "Grandmother", livesWith: true });
      }
    }
    await insert(db, "guardian", gRows);
    await insert(db, "guardianLink", lRows);
    await db.attendanceSettings.create({ data: { orgId, dailyOnlyGrades: [-1, 0], limitEnabled: true, updatedById: staff[0].membershipId } });
  });

  // --- Classes, timetable and enrollments for last year and this year ---------------------------------------------------------
  const teachersBy = new Map<string, Staff[]>();
  for (const s of staff) if (s.subject) teachersBy.set(s.subject, [...(teachersBy.get(s.subject) ?? []), s]);
  const kgTeachers = staff.filter((s) => s.kg);

  async function buildYear(year: YearInfo, offset: number, label: string) {
    // offset 0: this year; -1: last year (every student one grade lower; this year's KG1 had not joined).
    const roster = kids.filter((k) => k.grade + offset >= -1 && k.enrolledOn.getTime() < year.endsOn.getTime());
    const sectionsOf = new Map<string, Kid[]>();
    for (const k of roster) {
      const key = `${k.grade + offset}|${k.section}`;
      sectionsOf.set(key, [...(sectionsOf.get(key) ?? []), k]);
    }
    const classes: Klass[] = [];
    const load = new Map<string, number>();
    const pickTeacher = (code: string, periods: number) => {
      const pool = teachersBy.get(code) ?? [];
      const sorted = [...pool].sort((a, b) => (load.get(a.membershipId) ?? 0) - (load.get(b.membershipId) ?? 0));
      const t = sorted.find((x) => (load.get(x.membershipId) ?? 0) + periods <= MAX_LOAD) ?? sorted[0];
      if (t) load.set(t.membershipId, (load.get(t.membershipId) ?? 0) + periods);
      return t?.membershipId ?? null;
    };
    const sectionKeys = [...sectionsOf.keys()].sort((a, b) => Number(a.split("|")[0]) - Number(b.split("|")[0]) || a.localeCompare(b));
    let kgi = 0;
    const tutors = r.shuffle(staff.filter((s) => s.subject && !s.roles.includes("department_head")));
    let tutorIdx = 0;
    for (const key of sectionKeys) {
      const [gs, section] = key.split("|");
      const g = Number(gs);
      const members = sectionsOf.get(key)!.map((k) => k.id);
      const tutor = g <= 0 ? kgTeachers[kgi++ % kgTeachers.length].membershipId : tutors[tutorIdx++ % tutors.length].membershipId;
      classes.push({ id: nid(), yearId: year.id, grade: g, section, subject: null, teacherId: tutor, homeroom: true, periods: 0, studentIds: members });
      if (g <= 0) continue;
      for (const [code, periods] of PLAN[bandOf(g)]) classes.push({ id: nid(), yearId: year.id, grade: g, section, subject: code, teacherId: pickTeacher(code, periods), homeroom: false, periods, studentIds: members });
    }
    // The test teacher is the homeroom tutor of Grade 9 A this year.
    if (offset === 0) {
      const t = staff.find((s) => s.email === "teacher@staff.scale.example")!;
      const hr = classes.find((c) => c.homeroom && c.grade === 9 && c.section === "A");
      if (hr) hr.teacherId = t.membershipId;
    }
    const gradeLabel = (g: number) => (g === -1 ? bi("KG1|الروضة الأولى") : g === 0 ? bi("KG2|الروضة الثانية") : bi(`Grade ${g}|الصف ${g}`));
    await insert(
      db,
      "schoolClass",
      classes.map((c) => {
        const gl = gradeLabel(c.grade);
        const sub = c.subject ? subjects.get(c.subject)! : null;
        return {
          id: c.id,
          orgId,
          academicYearId: year.id,
          subjectId: sub?.id ?? null,
          teacherMembershipId: c.teacherId,
          nameEn: sub ? `${sub.nameEn} ${c.grade}${c.section}` : `Homeroom ${c.grade <= 0 ? gl.en : c.grade}${c.section}`,
          nameAr: sub ? `${sub.nameAr} ${c.grade}${c.section}` : `الفصل ${c.grade <= 0 ? gl.ar : c.grade}${c.section}`,
          gradeLevel: c.grade,
          section: c.section,
          isHomeroom: c.homeroom,
          room: c.homeroom ? `${c.grade <= 0 ? "K" : c.grade}${c.section}` : `${c.subject}-${c.grade}${c.section}`,
          capacity: 28,
          createdAt: new Date(year.startsOn.getTime() - 20 * DAY),
        };
      }),
    );
    // Enrollments: this year active, last year finished.
    const enr: Prisma.EnrollmentCreateManyInput[] = [];
    for (const c of classes) for (const sid of c.studentIds) enr.push({ id: nid(), orgId, studentId: sid, classId: c.id, status: offset === 0 ? "ACTIVE" : "INACTIVE", createdAt: new Date(year.startsOn.getTime() - 10 * DAY) });
    await insert(db, "enrollment", enr);
    // Timetable: greedy placement with no teacher double-booked.
    const bell = (await db.bellPeriod.findMany({ where: { orgId, academicYearId: year.id, kind: "LESSON" }, orderBy: [{ dayOfWeek: "asc" }, { periodNo: "asc" }] })).map((b) => ({ day: b.dayOfWeek, periodNo: b.periodNo, start: b.startTime }));
    const busy = new Set<string>();
    const slots: Slot[] = [];
    let unplaced = 0;
    const bySection = new Map<string, Klass[]>();
    for (const c of classes) if (!c.homeroom) bySection.set(`${c.grade}|${c.section}`, [...(bySection.get(`${c.grade}|${c.section}`) ?? []), c]);
    for (const [, list] of bySection) {
      const used = new Set<string>();
      const perDay = new Map<string, number>();
      for (const c of [...list].sort((a, b) => b.periods - a.periods)) {
        for (let k = 0; k < c.periods; k++) {
          const options = r.shuffle(bell.filter((b) => !used.has(`${b.day}|${b.periodNo}`) && !(c.teacherId && busy.has(`${c.teacherId}|${b.day}|${b.periodNo}`))));
          options.sort((a, b) => (perDay.get(`${c.id}|${a.day}`) ?? 0) - (perDay.get(`${c.id}|${b.day}`) ?? 0));
          const pick = options[0];
          if (!pick) {
            unplaced++;
            continue;
          }
          used.add(`${pick.day}|${pick.periodNo}`);
          if (c.teacherId) busy.add(`${c.teacherId}|${pick.day}|${pick.periodNo}`);
          perDay.set(`${c.id}|${pick.day}`, (perDay.get(`${c.id}|${pick.day}`) ?? 0) + 1);
          slots.push({ id: nid(), classId: c.id, teacherId: c.teacherId, day: pick.day, periodNo: pick.periodNo, start: pick.start });
        }
      }
    }
    await insert(db, "timetableSlot", slots.map((s) => ({ id: s.id, orgId, academicYearId: year.id, classId: s.classId, teacherMembershipId: s.teacherId, dayOfWeek: s.day, periodNo: s.periodNo, room: null })));
    log(`${label}: ${classes.length} classes, ${enr.length} enrollments, ${slots.length} lessons a week (${unplaced} not placed)`);
    return { classes, slots };
  }

  const prevYear = await step("last year: classes, enrollments, timetable", () => buildYear(years.prev, -1, "last year"));
  const curYear = await step("this year: classes, enrollments, timetable", () => buildYear(years.cur, 0, "this year"));

  // --- Attendance --------------------------------------------------------------------------------------------------
  const holidays = new Set<string>();
  for (const e of await db.calendarEvent.findMany({ where: { orgId, kind: "HOLIDAY" }, select: { startsAt: true, endsAt: true } })) {
    for (let t = e.startsAt.getTime() + 4 * 3600_000; t < e.endsAt.getTime() + 4 * 3600_000; t += DAY) holidays.add(new Date(t).toISOString().slice(0, 10));
  }
  const schoolDays = (year: YearInfo, until: Date) => {
    const out: Date[] = [];
    for (let t = year.startsOn.getTime(); t <= Math.min(year.endsOn.getTime(), until.getTime()); t += DAY) {
      const d = new Date(t);
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      if (holidays.has(keyOf(d))) continue;
      if (!year.terms.some((tm) => tm.startsOn.getTime() <= t && t <= tm.endsOn.getTime())) continue;
      out.push(d);
    }
    return out;
  };
  const code = (c: string) => DEFAULT_CODES.find((x) => x.code === c)!;
  const registrar = staff.find((s) => s.key === "registrar")!.membershipId;
  const today = dateOnly(0, now);

  async function attendanceFor(year: YearInfo, built: { classes: Klass[]; slots: Slot[] }, label: string) {
    const days = schoolDays(year, new Date(today.getTime() - DAY));
    const kidById = new Map(kids.map((k) => [k.id, k]));
    const homerooms = built.classes.filter((c) => c.homeroom);
    const classById = new Map(built.classes.map((c) => [c.id, c]));
    let daily = 0;
    let lessons = 0;
    for (const [di, d] of days.entries()) {
      const wd = d.getUTCDay();
      const dk = keyOf(d);
      const recent = today.getTime() - d.getTime() < 3 * DAY;
      const regs: Prisma.AttendanceRegisterCreateManyInput[] = [];
      const recs: Prisma.AttendanceRecordCreateManyInput[] = [];
      const dayCode = new Map<string, string>();
      for (const h of homerooms) {
        regs.push({ id: nid(), orgId, kind: "DAILY", classId: h.id, date: d, periodNo: 0, takenById: h.teacherId, takenAt: new Date(d.getTime() + (3 * 60 + 35 + r.int(0, 12)) * 60_000) });
        for (const sid of h.studentIds) {
          const k = kidById.get(sid)!;
          if (k.enrolledOn.getTime() > d.getTime()) continue;
          const x = r.next();
          let c = "P";
          let late: number | null = null;
          if (x < k.absence) {
            const y = r.next();
            c = y < 0.45 ? "I" : y < 0.6 ? "M" : y < 0.72 ? "E" : y < 0.8 ? "F" : recent && y < 0.9 ? "A" : "U";
          } else if (x < k.absence + k.lateness) {
            c = "L";
            late = r.int(3, 25);
          }
          dayCode.set(sid, c);
          const def = code(c);
          const office = ["I", "M", "F", "U"].includes(c);
          recs.push({ orgId, studentId: sid, date: d, status: statusOf(def), code: c, minutesLate: late, source: office ? "OFFICE" : "REGISTER", markedById: office ? registrar : h.teacherId });
        }
      }
      await insert(db, "attendanceRegister", regs);
      await insert(db, "attendanceRecord", recs);
      daily += recs.length;
      if (SKIP_LESSONS) continue;
      const lregs: Prisma.AttendanceRegisterCreateManyInput[] = [];
      const marks: Prisma.AttendanceLessonMarkCreateManyInput[] = [];
      for (const s of built.slots) {
        if (s.day !== wd) continue;
        const c = classById.get(s.classId)!;
        const regId = nid();
        const [hh, mm] = s.start.split(":").map(Number);
        lregs.push({ id: regId, orgId, kind: "LESSON", classId: s.classId, date: d, periodNo: s.periodNo, slotId: s.id, takenById: s.teacherId, takenAt: new Date(d.getTime() + ((hh - 4) * 60 + mm + r.int(1, 6)) * 60_000) });
        for (const sid of c.studentIds) {
          const dc = dayCode.get(sid);
          if (dc === undefined) continue;
          let mc = dc === "L" || dc === "P" ? "P" : dc;
          let late: number | null = null;
          if (mc === "P" && r.next() < 0.008) {
            mc = "L";
            late = r.int(2, 8);
          }
          const def = code(mc);
          marks.push({ orgId, registerId: regId, studentId: sid, date: d, code: mc, status: statusOf(def), minutesLate: late, source: "REGISTER", markedById: s.teacherId });
        }
      }
      await insert(db, "attendanceRegister", lregs);
      await insert(db, "attendanceLessonMark", marks, 5000);
      lessons += marks.length;
      if (di % 20 === 0) log(`${label}: day ${di + 1} of ${days.length} (${dk}), ${daily.toLocaleString("en")} daily and ${lessons.toLocaleString("en")} lesson marks so far`);
    }
    return { days: days.length, daily, lessons };
  }

  const attPrev = await step("last year: daily and lesson attendance", () => attendanceFor(years.prev, prevYear, "last year"));
  const attCur = await step("this year: daily and lesson attendance", () => attendanceFor(years.cur, curYear, "this year"));

  // Today: most homerooms have taken the morning register.
  await step("today's registers", async () => {
    const wd = today.getUTCDay();
    if (wd === 0 || wd === 6 || holidays.has(keyOf(today))) return;
    const regs: Prisma.AttendanceRegisterCreateManyInput[] = [];
    const recs: Prisma.AttendanceRecordCreateManyInput[] = [];
    const kidById = new Map(kids.map((k) => [k.id, k]));
    for (const h of curYear.classes.filter((c) => c.homeroom)) {
      if (r.chance(0.15) || (h.grade === 9 && h.section === "A")) continue;
      const takenAt = new Date(Math.min(now.getTime(), today.getTime() + (3 * 60 + 40) * 60_000));
      regs.push({ id: nid(), orgId, kind: "DAILY", classId: h.id, date: today, periodNo: 0, takenById: h.teacherId, takenAt });
      for (const sid of h.studentIds) {
        if (kidById.get(sid)!.enrolledOn.getTime() > today.getTime()) continue;
        const c = r.next() < 0.03 ? "A" : r.next() < 0.03 ? "L" : "P";
        recs.push({ orgId, studentId: sid, date: today, status: statusOf(code(c)), code: c, minutesLate: c === "L" ? r.int(3, 18) : null, markedById: h.teacherId });
      }
    }
    await insert(db, "attendanceRegister", regs);
    await insert(db, "attendanceRecord", recs);
  });

  // --- Gradebook and report cards ------------------------------------------------------------------------------------
  const bands = (await db.gradeBand.findMany({ where: { orgId }, orderBy: { minPercent: "desc" } })).map((b) => ({ label: b.label, minPercent: b.minPercent }));
  const bandFor = (p: number | null) => (p === null ? null : (bands.find((b) => p >= b.minPercent)?.label ?? bands[bands.length - 1]?.label ?? null));
  const nameOfStaff = new Map(staff.map((s) => [s.membershipId, { en: `${s.first.en} ${s.last.en}`, ar: `${s.first.ar} ${s.last.ar}` }]));
  const KINDS: Array<{ kind: "HOMEWORK" | "QUIZ" | "TEST" | "PROJECT" | "EXAM"; en: string; ar: string; max: number; weight: number }> = [
    { kind: "HOMEWORK", en: "Homework", ar: "واجب منزلي", max: 20, weight: 1 },
    { kind: "QUIZ", en: "Quiz", ar: "اختبار قصير", max: 20, weight: 1 },
    { kind: "TEST", en: "Unit test", ar: "اختبار الوحدة", max: 50, weight: 2 },
    { kind: "PROJECT", en: "Project", ar: "مشروع", max: 100, weight: 2 },
    { kind: "EXAM", en: "End of term exam", ar: "اختبار نهاية الفصل", max: 100, weight: 3 },
  ];

  async function gradebook(year: YearInfo, built: { classes: Klass[] }, current: boolean) {
    const avg = new Map<string, { sum: number; w: number }>(); // studentId|classId|termId
    const kidById = new Map(kids.map((k) => [k.id, k]));
    const subjectBoost = new Map<string, number>();
    let nA = 0;
    let nG = 0;
    for (const term of year.terms) {
      if (term.startsOn.getTime() > now.getTime()) continue;
      const termEnd = Math.min(term.endsOn.getTime(), now.getTime() - 2 * DAY);
      const span = termEnd - term.startsOn.getTime();
      const aRows: Prisma.AssessmentCreateManyInput[] = [];
      const gRows: Prisma.GradeCreateManyInput[] = [];
      for (const c of built.classes) {
        if (c.homeroom) continue;
        const list = current ? KINDS.slice(0, Math.max(2, Math.min(4, Math.floor(span / (14 * DAY))))) : KINDS;
        for (const [i, kd] of list.entries()) {
          const due = new Date(term.startsOn.getTime() + ((i + 1) / (list.length + 0.5)) * span);
          if (due.getTime() > now.getTime() - DAY) continue;
          const latest = current && i === list.length - 1;
          const aid = nid();
          const published = latest && r.chance(0.5) ? null : new Date(due.getTime() + r.int(2, 6) * DAY);
          aRows.push({ id: aid, orgId, classId: c.id, termId: term.id, titleEn: `${kd.en} ${i + 1}`, titleAr: `${kd.ar} ${i + 1}`, kind: kd.kind, maxScore: kd.max, weight: kd.weight, dueAt: due, publishedAt: published && published.getTime() < now.getTime() ? published : null, publishedById: published ? c.teacherId : null, createdById: c.teacherId ?? staff[0].membershipId, createdAt: new Date(due.getTime() - 7 * DAY) });
          nA++;
          for (const sid of c.studentIds) {
            const k = kidById.get(sid)!;
            if (k.enrolledOn.getTime() > due.getTime()) continue;
            const boostKey = `${sid}|${c.subject}`;
            if (!subjectBoost.has(boostKey)) subjectBoost.set(boostKey, (r.next() - 0.5) * 16);
            const pct = Math.max(15, Math.min(100, k.ability + subjectBoost.get(boostKey)! + (r.next() - 0.5) * 18));
            const score = Math.round((pct / 100) * kd.max * 2) / 2;
            gRows.push({ orgId, assessmentId: aid, studentId: sid, score, excused: false, updatedById: c.teacherId, updatedAt: new Date(due.getTime() + DAY) });
            if (published) {
              const key = `${sid}|${c.id}|${term.id}`;
              const a = avg.get(key) ?? { sum: 0, w: 0 };
              a.sum += (score / kd.max) * 100 * kd.weight;
              a.w += kd.weight;
              avg.set(key, a);
            }
          }
        }
      }
      await insert(db, "assessment", aRows);
      await insert(db, "grade", gRows, 5000);
      nG += gRows.length;
    }
    return { avg, assessments: nA, grades: nG };
  }

  const gbPrev = await step("last year: assessments and grades", () => gradebook(years.prev, prevYear, false));
  const gbCur = await step("this year: assessments and grades", () => gradebook(years.cur, curYear, true));

  await step("report cards (last year's summer term, released)", async () => {
    const term = years.prev.terms[years.prev.terms.length - 1];
    const category = await db.documentCategory.findFirst({ where: { orgId, key: "reports" }, select: { id: true } });
    const releasedAt = new Date(term.endsOn.getTime() + 2 * DAY);
    const docs: Prisma.DocumentCreateManyInput[] = [];
    const vers: Prisma.DocumentVersionCreateManyInput[] = [];
    const byStudent = new Map<string, Klass[]>();
    for (const c of prevYear.classes) if (!c.homeroom) for (const sid of c.studentIds) byStudent.set(sid, [...(byStudent.get(sid) ?? []), c]);
    const kidById = new Map(kids.map((k) => [k.id, k]));
    for (const [sid, list] of byStudent) {
      const k = kidById.get(sid)!;
      const rows = list.map((c) => {
        const a = gbPrev.avg.get(`${sid}|${c.id}|${term.id}`);
        const average = a && a.w ? Math.round((a.sum / a.w) * 10) / 10 : null;
        const sub = subjects.get(c.subject!)!;
        const tname = c.teacherId ? nameOfStaff.get(c.teacherId) : null;
        return { subjectEn: sub.nameEn, subjectAr: sub.nameAr, teacherEn: tname?.en ?? "", teacherAr: tname?.ar ?? "", average, band: bandFor(average), commentEn: "Steady progress this term.", commentAr: "تقدم مطّرد في هذا الفصل." };
      });
      const vals = rows.map((x) => x.average).filter((x): x is number => x !== null);
      const overall = vals.length ? Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 10) / 10 : null;
      const docId = nid();
      const verId = nid();
      const renderData = {
        kind: "report_card",
        school: { en: org.nameEn, ar: org.nameAr },
        student: { en: `${k.first.en} ${k.last.en}`, ar: `${k.first.ar} ${k.last.ar}`, studentNo: k.studentNo, grade: k.grade - 1, section: k.section },
        year: { en: years.prev.nameEn, ar: years.prev.nameAr },
        term: { en: term.nameEn, ar: term.nameAr },
        issuedAt: releasedAt.toISOString(),
        rows,
        overall,
        overallBand: bandFor(overall),
        bands,
      };
      const teacher = list[0].teacherId ?? staff[0].membershipId;
      docs.push({ id: docId, orgId, categoryId: category?.id ?? null, titleEn: `Term report card: ${term.nameEn} ${years.prev.nameEn}`, titleAr: `بطاقة التقرير الفصلي: ${term.nameAr} ${years.prev.nameAr}`, studentId: sid, sensitivity: "STANDARD", source: "GENERATED", currentVersionId: verId, uploadedById: teacher, visibleToFamily: true, createdAt: releasedAt });
      vers.push({ id: verId, orgId, documentId: docId, version: 1, storageKey: `reportcard:${term.id}:${sid}`, fileName: `report-card-${k.studentNo}-summer-term.pdf`, mimeType: "application/pdf", sizeBytes: 0, renderData: renderData as never, output: "BILINGUAL", createdById: teacher, createdAt: releasedAt });
    }
    await insert(db, "document", docs, 2000);
    await insert(db, "documentVersion", vers, 1000);
  });

  // --- Course choices: this year's subjects, next year's choices for Grades 8 to 11 --------------------------------------
  await step("subjects and course choices", async () => {
    const offerRows: Prisma.SubjectOfferingCreateManyInput[] = [];
    for (let g = 1; g <= 12; g++) for (const [codeX, periods] of PLAN[bandOf(g)]) offerRows.push({ id: nid(), orgId, academicYearId: years.cur.id, subjectId: subjects.get(codeX)!.id, gradeLevel: g, kind: "CORE", periodsPerWeek: periods, curriculum: null });
    const nextPlan: Array<[string, "CORE" | "OPTION", string | null, number]> = [["ENG", "CORE", null, 6], ["MATH", "CORE", null, 6], ["ARAB", "CORE", null, 4], ["ISL", "CORE", null, 2], ["PE", "CORE", null, 2], ["PHYS", "OPTION", "A", 4], ["BUS", "OPTION", "A", 4], ["CHEM", "OPTION", "B", 4], ["CS", "OPTION", "B", 4], ["BIO", "OPTION", "C", 4], ["ECON", "OPTION", "C", 4], ["ART", "OPTION", "D", 3], ["FR", "OPTION", "D", 3], ["PSY", "OPTION", "D", 3]];
    for (let g = 9; g <= 12; g++) for (const [c, kind, block, periods] of nextPlan) offerRows.push({ id: nid(), orgId, academicYearId: years.next.id, subjectId: subjects.get(c)!.id, gradeLevel: g, kind, optionBlock: block, periodsPerWeek: periods, curriculum: null });
    await insert(db, "subjectOffering", offerRows);
    const regs: Prisma.SubjectRegistrationCreateManyInput[] = [];
    for (const c of curYear.classes) if (!c.homeroom) for (const sid of c.studentIds) regs.push({ id: nid(), orgId, academicYearId: years.cur.id, studentId: sid, subjectId: subjects.get(c.subject!)!.id, status: "ALLOCATED", source: "IMPORT", classId: c.id, createdAt: new Date(years.cur.startsOn.getTime() - 20 * DAY) });
    const windowOpens = at(-12, 7, 0, now);
    await db.courseSelectionWindow.create({ data: { orgId, academicYearId: years.next.id, gradeLevels: [8, 9, 10, 11], opensAt: windowOpens, closesAt: at(9, 16, 0, now), roundEn: "Round 1", roundAr: "الجولة الأولى", createdById: staff[0].membershipId } });
    const subs: Prisma.CourseSelectionSubmissionCreateManyInput[] = [];
    for (const k of kids.filter((x) => x.grade >= 8 && x.grade <= 11)) {
      const x = r.next();
      if (x > 0.85) continue;
      const lastAt = new Date(windowOpens.getTime() + r.int(1, 11) * DAY);
      const submitted = x < 0.6;
      subs.push({ id: nid(), orgId, studentId: k.id, academicYearId: years.next.id, status: submitted ? (r.chance(0.3) ? "SIGNED_OFF" : "SUBMITTED") : "DRAFT", lastById: k.membershipId, lastSource: "STUDENT", lastAt: lastAt.getTime() < now.getTime() ? lastAt : now, submittedAt: submitted ? lastAt : null });
      for (const blk of ["A", "B", "C", "D"]) {
        const opts = nextPlan.filter((p) => p[2] === blk);
        const choice = r.pick(opts);
        regs.push({ id: nid(), orgId, academicYearId: years.next.id, studentId: k.id, subjectId: subjects.get(choice[0])!.id, status: "REQUESTED", source: "STUDENT", preference: 1, createdById: k.membershipId, chosenAt: lastAt.getTime() < now.getTime() ? lastAt : now });
      }
    }
    await insert(db, "subjectRegistration", regs);
    await insert(db, "courseSelectionSubmission", subs);
  });

  // --- Requests, messages, timeline ------------------------------------------------------------------------------------
  await step("requests, messages and timeline", async () => {
    const services = new Map((await db.serviceDefinition.findMany({ where: { orgId } })).map((s) => [s.key, s]));
    const parentKeys = ["absence_request", "document_request", "transport_request", "parent_meeting", "early_pickup", "contact_update", "feedback"].filter((k) => services.has(k));
    const studentKeys = ["it_support", "locker_request", "id_card_replacement", "recommendation_letter", "counselor_meeting", "activity_registration"].filter((k) => services.has(k));
    const reqRows: Prisma.RequestCreateManyInput[] = [];
    const msgRows: Prisma.RequestMessageCreateManyInput[] = [];
    const tlRows: Prisma.TimelineEventCreateManyInput[] = [];
    const seq = new Map<string, number>();
    const handlers = staff.filter((s) => ["registrar", "admin", "counselor", "it"].includes(s.key));
    const N = Math.round(TARGET_STUDENTS * 2);
    for (let i = 0; i < N; i++) {
      const f = r.pick(families);
      const k = r.pick(f.kids);
      const byParent = !k.membershipId || r.chance(0.7);
      const key = byParent ? r.pick(parentKeys) : r.pick(studentKeys);
      const svc = services.get(key)!;
      const requester = byParent ? f.guardians[0].membershipId : k.membershipId!;
      const daysAgo = Math.floor(r.next() ** 1.4 * 420);
      const submittedAt = at(-daysAgo, 7 + r.int(0, 10), r.int(0, 59), now);
      const open = daysAgo < 6 && r.chance(0.7);
      const status = open ? r.pick(["SUBMITTED", "IN_REVIEW", "IN_PROGRESS"] as const) : r.chance(0.06) ? "REJECTED" : "COMPLETED";
      const yearN = submittedAt.getUTCFullYear();
      const sk = `${svc.requestPrefix}-${yearN}`;
      const n = (seq.get(sk) ?? 0) + 1;
      seq.set(sk, n);
      const reqId = nid();
      const handler = r.pick(handlers).membershipId;
      const done = new Date(submittedAt.getTime() + r.int(2, Math.max(4, svc.slaHours + 12)) * 3600_000);
      reqRows.push({ id: reqId, orgId, number: `${svc.requestPrefix}-${yearN}-${String(n).padStart(4, "0")}`, serviceId: svc.id, requesterId: requester, studentId: k.id, status, priority: "MEDIUM", sensitivity: svc.sensitivity, titleEn: `${svc.nameEn}: ${k.first.en} ${k.last.en}`, titleAr: `${svc.nameAr}: ${k.first.ar} ${k.last.ar}`, currentStepEn: open ? "In review" : "Completed", currentStepAr: open ? "قيد المراجعة" : "مكتمل", progress: open ? 40 : 100, assigneeId: handler, slaDueAt: new Date(submittedAt.getTime() + svc.slaHours * 3600_000), submittedAt, completedAt: open ? null : done, createdAt: submittedAt, updatedAt: open ? submittedAt : done });
      tlRows.push({ orgId, requestId: reqId, studentId: k.id, actorId: requester, kind: "submitted", titleEn: "Request submitted", titleAr: "تم تقديم الطلب", createdAt: submittedAt });
      if (!open) tlRows.push({ orgId, requestId: reqId, studentId: k.id, actorId: handler, kind: status === "REJECTED" ? "rejected" : "completed", titleEn: status === "REJECTED" ? "Closed as not approved" : "Completed", titleAr: status === "REJECTED" ? "أُغلق دون موافقة" : "مكتمل", createdAt: done });
      const nMsg = r.int(0, 4);
      for (let m = 0; m < nMsg; m++) {
        const fromStaff = m % 2 === 0;
        msgRows.push({ id: nid(), orgId, requestId: reqId, membershipId: fromStaff ? handler : requester, visibility: "SHARED", body: fromStaff ? "Thank you, we have received this and will update you shortly. شكرًا لكم، استلمنا الطلب وسنوافيكم بالمستجدات قريبًا." : "Thank you for the update. شكرًا على المتابعة.", familyNotified: fromStaff, createdAt: new Date(submittedAt.getTime() + (m + 1) * 3 * 3600_000) });
      }
    }
    await insert(db, "request", reqRows);
    await insert(db, "requestMessage", msgRows);
    await insert(db, "timelineEvent", tlRows);
    for (const [key, value] of seq) await db.sequence.upsert({ where: { orgId_key: { orgId, key } }, create: { orgId, key, value }, update: { value } });
  });

  // --- Cases ----------------------------------------------------------------------------------------------------------
  await step("cases", async () => {
    const counselors = staff.filter((s) => s.key === "counselor").map((s) => s.membershipId);
    const dsl = staff.filter((s) => s.key === "dsl" || s.key === "deputy_dsl").map((s) => s.membershipId);
    const rows: Prisma.CaseCreateManyInput[] = [];
    const types = ["ACADEMIC", "BEHAVIOR", "ATTENDANCE", "LEARNING_SUPPORT", "PARENT_CONCERN", "WELLBEING", "WELLBEING", "SAFEGUARDING"] as const;
    for (let i = 0; i < 240; i++) {
      const k = r.pick(kids);
      const type = r.pick(types);
      const sensitivity = type === "WELLBEING" ? "WELLBEING" : type === "SAFEGUARDING" ? "SAFEGUARDING" : "STANDARD";
      const opened = at(-Math.floor(r.next() ** 1.2 * 400), 10, 0, now);
      const closed = r.chance(0.55);
      rows.push({ id: nid(), orgId, number: `CASE-${opened.getUTCFullYear()}-${String(1000 + i)}`, type, sensitivity, studentId: k.id, titleEn: `${type.replace(/_/g, " ").toLowerCase()} follow-up`, titleAr: "متابعة حالة", assigneeId: sensitivity === "SAFEGUARDING" ? r.pick(dsl) : r.pick(counselors), referrerId: r.pick(staff).membershipId, priority: r.pick(["LOW", "MEDIUM", "HIGH"] as const), status: closed ? "CLOSED" : r.pick(["NEW", "OPEN", "IN_PROGRESS", "WAITING"] as const), openedAt: opened, closedAt: closed ? new Date(opened.getTime() + r.int(5, 60) * DAY) : null, createdAt: opened });
    }
    await insert(db, "case", rows);
  });

  // --- Notifications and audit events -------------------------------------------------------------------------------
  await step("notifications", async () => {
    const rows: Prisma.NotificationCreateManyInput[] = [];
    const kinds = [
      { kind: "grade", en: "New grades published", ar: "نُشرت درجات جديدة", href: "/grades" },
      { kind: "attendance_unexplained", en: "Absence to explain", ar: "غياب يحتاج إلى توضيح", href: "/attendance" },
      { kind: "parent_update", en: "Update on your request", ar: "مستجد بشأن طلبك", href: "/requests" },
      { kind: "document_ready", en: "A document is ready", ar: "وثيقة جاهزة", href: "/documents" },
      { kind: "school", en: "School announcement", ar: "إعلان من المدرسة", href: "/home" },
    ];
    for (const f of families) for (const g of f.guardians) {
      const n = 18 + r.int(0, 20);
      for (let i = 0; i < n; i++) {
        const kd = r.pick(kinds);
        const daysAgo = Math.floor(r.next() ** 1.5 * 400);
        rows.push({ id: nid(), orgId, recipientId: g.membershipId, kind: kd.kind, titleEn: kd.en, titleAr: kd.ar, href: kd.href, readAt: daysAgo > 7 || r.chance(0.5) ? at(-daysAgo + 1, 19, 0, now) : null, createdAt: at(-daysAgo, 8 + r.int(0, 10), r.int(0, 59), now) });
      }
    }
    for (const s of staff) {
      const n = 60 + r.int(0, 80);
      for (let i = 0; i < n; i++) {
        const daysAgo = Math.floor(r.next() ** 1.5 * 400);
        rows.push({ id: nid(), orgId, recipientId: s.membershipId, kind: "job", titleEn: "New item for you", titleAr: "عنصر جديد لك", href: "/tasks", readAt: daysAgo > 3 ? at(-daysAgo, 18, 0, now) : null, createdAt: at(-daysAgo, 9, 0, now) });
      }
    }
    await insert(db, "notification", rows);
  });

  await step("audit events", async () => {
    const actions = ["attendance.register_save", "grades.save", "grades.publish", "student.view", "request.message.create", "auth.password_sign_in", "fees.payment.record", "case.update", "document.download"];
    const people = [...staff.map((s) => s.membershipId), ...families.flatMap((f) => f.guardians.map((g) => g.membershipId))];
    const total = Math.round(TARGET_STUDENTS * 160);
    const batch: Prisma.AuditEventCreateManyInput[] = [];
    for (let i = 0; i < total; i++) {
      const daysAgo = Math.floor(r.next() * 420);
      batch.push({ id: nid(), orgId, actorId: r.pick(people), action: r.pick(actions), entityType: "Student", entityId: r.pick(kids).id, createdAt: at(-daysAgo, 7 + r.int(0, 11), r.int(0, 59), now) });
      if (batch.length >= 20_000) await insert(db, "auditEvent", batch.splice(0));
    }
    await insert(db, "auditEvent", batch.splice(0));
  });

  // --- Admissions for next year -------------------------------------------------------------------------------------
  await step("admissions applications", async () => {
    await db.admissionSettings.create({ data: { orgId, publicOpen: true, openYearIds: [years.next.id], admissionNoPattern: "STS-{YY}{SEQ:4}", updatedById: staff[0].membershipId } });
    await db.admissionCapacity.createMany({ data: [...gradeCounts(TARGET_STUDENTS).entries()].map(([g, n]) => ({ orgId, academicYearId: years.next.id, gradeLevel: g, sectionSeats: Array.from({ length: Math.ceil(n / SECTION_SIZE(g)) }, () => SECTION_SIZE(g)), seatFeeFils: 300_000 })) });
    const stages = ["NEW", "NEW", "DOCUMENTS_PENDING", "ASSESSMENT_BOOKED", "ASSESSED", "OFFER_MADE", "OFFER_ACCEPTED", "SEAT_PAID", "WAITLISTED", "DECLINED", "WITHDRAWN"];
    const users: Prisma.UserCreateManyInput[] = [];
    const apps: Array<{ email: string; row: Omit<Prisma.AdmissionApplicationCreateManyInput, "applicantUserId"> }> = [];
    const n = Math.round(TARGET_STUDENTS * 0.42);
    for (let i = 0; i < n; i++) {
      const origin = r.pick(ORIGINS);
      const gender: "F" | "M" = r.chance(0.5) ? "F" : "M";
      const first = r.pick(gender === "F" ? (origin.arab ? ARAB_F : INTL_F) : origin.arab ? ARAB_M : INTL_M);
      const parent = r.pick(origin.arab ? ARAB_F : INTL_F);
      const email = emailFor(parent.en, origin.last.en, "applicants.scale.example");
      users.push({ email, nameEn: `${parent.en} ${origin.last.en}`, nameAr: `${parent.ar} ${origin.last.ar}`, passwordHash, emailVerified: at(-100, 9, 0, now) });
      const grade = r.chance(0.35) ? -1 : r.int(0, 11);
      const stage = r.pick(stages);
      const ago = r.int(1, 150);
      apps.push({ email, row: { id: nid(), orgId, number: `ADM-${years.next.startsOn.getUTCFullYear()}-${String(i + 1).padStart(4, "0")}`, academicYearId: years.next.id, gradeLevel: grade, curriculum: "AMERICAN", stage, stageChangedAt: at(-Math.floor(ago / 2), 10, 0, now), submittedAt: at(-ago, 10, 0, now), firstNameEn: first.en, lastNameEn: origin.last.en, firstNameAr: first.ar, lastNameAr: origin.last.ar, dateOfBirth: utc(years.next.startsOn.getUTCFullYear() - (grade + 6), r.int(1, 12), r.int(1, 28)), gender, nationality: "AE", homeLanguage: origin.arab ? "ar" : "en", consentAt: at(-ago, 10, 0, now), createdAt: at(-ago - 2, 10, 0, now) } });
    }
    await db.user.createMany({ data: users, skipDuplicates: true });
    bump("User", users.length);
    const ids = new Map((await db.user.findMany({ where: { email: { in: users.map((u) => u.email) } }, select: { id: true, email: true } })).map((u) => [u.email, u.id]));
    await insert(db, "admissionApplication", apps.map((a) => ({ ...a.row, applicantUserId: ids.get(a.email)! })));
    await insert(db, "admissionEvent", apps.map((a) => ({ orgId, applicationId: a.row.id!, kind: "stage", fromStage: "NEW", toStage: a.row.stage!, createdAt: a.row.stageChangedAt as Date })));
  });

  // --- Government returns (the census and attendance returns are built live when opened) ------------------------------
  await step("government returns", async () => {
    const admin = staff.find((s) => s.key === "admin")!;
    const ec = execCtx(tx, orgId, { now, quiet: true });
    const asOf = keyOf(dateOnly(0, now));
    await createReturn(ec, { membershipId: admin.membershipId, userId: admin.userId }, { kind: "CENSUS", asOf, label: "Census" }, { regulator: "SPEA" });
    await createReturn(ec, { membershipId: admin.membershipId, userId: admin.userId }, { kind: "ATTENDANCE", asOf, periodFrom: keyOf(years.cur.startsOn), label: "Attendance, term to date" }, { regulator: "SPEA" });
  });

  // --- Fees through the real services -------------------------------------------------------------------------------
  const fees = await step("fees: schedule, accounts, billing runs, payments", async () => {
    const fo: Actor = { membershipId: staff.find((s) => s.key === "finance")!.membershipId, userId: null };
    const aed = (n: number) => Math.round(n * 100);
    await db.financeSettings.create({ data: { orgId, legalNameEn: "Scale Test School LLC", legalNameAr: "مدرسة اختبار السعة ذ.م.م", addressEn: "Sharjah, United Arab Emirates", addressAr: "الشارقة، الإمارات العربية المتحدة", trn: "100000000000003", vatRegistered: true } });
    const year = await db.academicYear.findFirstOrThrow({ where: { id: years.cur.id }, include: { terms: true } });
    const tuition: Record<number, number> = { [-1]: 15_000, 0: 15_500, 1: 17_000, 2: 17_000, 3: 18_000, 4: 18_000, 5: 19_000, 6: 20_000, 7: 21_000, 8: 22_000, 9: 23_500, 10: 25_000, 11: 26_500, 12: 28_000 };
    for (const [g, amount] of Object.entries(tuition)) {
      const gn = Number(g);
      const codeX = gn === -1 ? "T-KG1" : gn === 0 ? "T-KG2" : `T-G${gn}`;
      await saveFeeItem(tx, orgId, { academicYearId: year.id, code: codeX, kind: "TUITION", nameEn: `Tuition, ${gn === -1 ? "KG1" : gn === 0 ? "KG2" : `Grade ${gn}`}`, nameAr: `الرسوم الدراسية، ${gn === -1 ? "الروضة الأولى" : gn === 0 ? "الروضة الثانية" : `الصف ${gn}`}`, amountFils: aed(amount), gradeLevels: [gn], zone: null, ...DEFAULT_BEHAVIOUR.TUITION, vatTreatment: "ZERO_RATED", active: true }, fo);
    }
    const others: Array<{ code: string; kind: FeeItemKind; en: string; ar: string; aed: number; grades?: number[]; zone?: string; vat: VatTreatment }> = [
      { code: "BUS-A", kind: "TRANSPORT", en: "School bus, zone A", ar: "الحافلة المدرسية، المنطقة أ", aed: 5_500, zone: "A", vat: "STANDARD" },
      { code: "BUS-B", kind: "TRANSPORT", en: "School bus, zone B", ar: "الحافلة المدرسية، المنطقة ب", aed: 6_500, zone: "B", vat: "STANDARD" },
      { code: "BOOKS", kind: "BOOKS", en: "Books and materials", ar: "الكتب والمواد", aed: 900, vat: "ZERO_RATED" },
    ];
    for (const it of others) await saveFeeItem(tx, orgId, { academicYearId: year.id, code: it.code, kind: it.kind, nameEn: it.en, nameAr: it.ar, amountFils: aed(it.aed), gradeLevels: it.grades ?? [], zone: it.zone ?? null, ...DEFAULT_BEHAVIOUR[it.kind], vatTreatment: it.vat, active: true }, fo);
    await savePlan(tx, orgId, { academicYearId: year.id, key: "termly", nameEn: "Termly (40%, 30%, 30%)", nameAr: "فصلية (40% و30% و30%)", kind: "TERMLY", isDefault: true, active: true, parts: suggestParts("TERMLY", year, year.terms) }, fo);
    await savePlan(tx, orgId, { academicYearId: year.id, key: "monthly", nameEn: "Monthly (10 instalments)", nameAr: "شهرية (10 أقساط)", kind: "MONTHLY", isDefault: false, active: true, parts: suggestParts("MONTHLY", year, year.terms) }, fo);
    const t0 = Date.now();
    await syncFamilyAccounts(tx, orgId, fo);
    const syncMs = Date.now() - t0;
    const accounts = await db.feeAccount.findMany({ where: { orgId }, include: { students: true } });
    for (const a of accounts) {
      if (r.chance(0.12)) await db.feeAccount.update({ where: { id: a.id }, data: { planKey: "monthly" } });
      for (const s of a.students) if (r.chance(0.3)) await db.studentFeeProfile.update({ where: { studentId: s.studentId }, data: { transportZone: r.chance(0.5) ? "A" : "B" } });
    }
    const plans = await db.instalmentPlan.findMany({ where: { orgId, academicYearId: year.id }, include: { parts: { orderBy: { seq: "asc" } } } });
    const runs: Array<{ partId: string; issue: Date; due: Date }> = [];
    for (const p of plans) for (const part of p.parts) {
      const issue = new Date(part.dueDate.getTime() - 14 * DAY);
      if (issue.getTime() <= now.getTime()) runs.push({ partId: part.id, issue, due: part.dueDate });
    }
    runs.sort((a, b) => a.issue.getTime() - b.issue.getTime());
    const runTimes: Array<{ invoices: number; ms: number }> = [];
    for (const run of runs) {
      const t1 = Date.now();
      const { run: br } = await createBillingRun(tx, orgId, { partId: run.partId, issueDate: run.issue, dueDate: run.due, includeCharges: true }, fo);
      const ec = execCtx(tx, orgId, { now: run.issue, quiet: true });
      let made = 0;
      for (let i = 0; i < 1000; i++) {
        const res = await processBillingBatch(ec, br.id, { batchSize: 25 });
        made += res.created;
        if (res.done) break;
      }
      runTimes.push({ invoices: made, ms: Date.now() - t1 });
      log(`billing run: ${made} invoices in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    }
    // Payments: most families pay on time, some late, some in part, a few not yet.
    const invoices = await db.invoice.findMany({ where: { orgId, kind: "TAX" }, orderBy: { issueDate: "asc" } });
    const methods: FeePaymentMethod[] = ["BANK_TRANSFER", "BANK_TRANSFER", "BANK_TRANSFER", "CARD", "CARD", "CHEQUE", "CASH"];
    const t2 = Date.now();
    let paid = 0;
    for (const inv of invoices) {
      const x = r.next();
      if (x < 0.07) continue;
      const when = x < 0.8 ? new Date(inv.dueDate.getTime() - r.int(0, 12) * DAY) : new Date(inv.dueDate.getTime() + r.int(3, 40) * DAY);
      if (when.getTime() > now.getTime() - 3600_000) continue;
      const fresh = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      const bal = balanceOf(fresh);
      const amount = x > 0.93 ? Math.round(bal / 2 / 100) * 100 : bal;
      if (amount <= 0) continue;
      const method = r.pick(methods);
      await recordPayment(tx, orgId, { accountId: inv.accountId, method, amountFils: amount, receivedAt: when, reference: method === "BANK_TRANSFER" ? `FT${String(100000 + paid)}` : null, chequeNumber: method === "CHEQUE" ? String(r.int(100000, 999999)) : null, chequeBank: method === "CHEQUE" ? "Sharjah Islamic Bank" : null, chequeDate: method === "CHEQUE" ? when : null, idempotencyKey: `scale:pay:${inv.id}`, invoiceIds: [inv.id] }, fo);
      paid++;
    }
    const payMs = Date.now() - t2;
    bump("Invoice", invoices.length);
    bump("FeePayment", paid);
    return { accounts: accounts.length, syncMs, runTimes, payments: paid, payMs, invoices: invoices.length };
  });

  // --- Summary ------------------------------------------------------------------------------------------------------
  await db.$executeRawUnsafe("ANALYZE");
  const sizeAfter = await dbSize(db);
  const tables = await db.$queryRaw<Array<{ table: string; rows: bigint; size: string }>>`
    SELECT c.relname AS table, c.reltuples::bigint AS rows, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15`;
  const summary = {
    seconds: Math.round((Date.now() - started) / 1000),
    sizeBefore,
    sizeAfter,
    students: kids.length,
    families: families.length,
    guardians: families.reduce((s, f) => s + f.guardians.length, 0),
    staff: staff.length,
    attendance: { lastYear: attPrev, thisYear: attCur },
    gradebook: { lastYear: { assessments: gbPrev.assessments, grades: gbPrev.grades }, thisYear: { assessments: gbCur.assessments, grades: gbCur.grades } },
    fees,
    steps: timings,
    largestTables: tables.map((t) => ({ table: t.table, rows: Number(t.rows), size: t.size })),
  };
  console.log(JSON.stringify(summary, null, 2));
  await db.$disconnect();
}

async function dbSize(db: PrismaClient) {
  const [row] = await db.$queryRaw<Array<{ size: string }>>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
  return row.size;
}

main().catch((e) => {
  console.error("[scale] failed", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
