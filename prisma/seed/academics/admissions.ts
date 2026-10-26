// Demo data for admissions and enrollment at Horizon: next year's applications at every stage from KG1 to
// Grade 11 (with a waiting list, offers, payments and enrollments), two students who joined this term, a
// re-enrollment window with answers and reminders, leavers with transfer certificates, government registration
// records, and the Admissions Officer persona (Hana Saleh). All people are fictional, all dates relative to now.
// Safe to re-run: the tenant is wiped before the demo seed, and global users are created with skipDuplicates.
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import type { SeedWorld } from "../demo";
import { DEMO_PASSWORD } from "../demo";
import { at, dateOnly, emailFor, id, rng, stableId } from "../lib";
import { execCtx, type Tx } from "@/server/db";
import { encryptField } from "@/lib/crypto";
import { KG1, KG2 } from "@/lib/grade-levels";
import { ensureAdmissionSetup, ASSESSMENT_TYPE_KEY, TC_TEMPLATE_KEY } from "@/server/admissions/templates";
import { enrollApplication } from "@/server/admissions/enroll";
import { tcMergeData } from "@/server/admissions/pdf";
import { DEFAULT_DOC_TYPES, docTypesFor } from "@/server/admissions/config";
import { eidHash } from "@/server/admissions/secure";
import { nameDobKey } from "@/server/admissions/rules";
import { entryYearOf } from "@/server/admissions/settings";
import { nextSequence } from "@/server/common/sequence";
import { nextApplicationNo } from "@/server/admissions/numbers";

type Bi = { en: string; ar: string };
const b = (en: string, ar: string): Bi => ({ en, ar });
const DAY = 86_400_000;

type Stage = "NEW" | "DOCUMENTS_PENDING" | "ASSESSMENT_BOOKED" | "ASSESSED" | "OFFER_MADE" | "OFFER_ACCEPTED" | "SEAT_PAID" | "ENROLLED" | "WAITLISTED" | "DECLINED" | "WITHDRAWN" | "DRAFT";

type AppSeed = {
  first: Bi;
  last: Bi;
  gender: "F" | "M";
  nat: string;
  lang: string;
  grade: number;
  stage: Stage;
  /** Days ago the family submitted. */
  ago: number;
  mother: Bi;
  father: Bi;
  /** Birth date offset in months from the usual range start (0 = mid range). Negative = older. */
  ageShift?: number;
  outcome?: "RECOMMENDED" | "CONDITIONAL" | "NOT_RECOMMENDED";
  staffChild?: boolean;
  /** Index into world.guardians of an existing family: a sibling application (same guardian email). */
  siblingOf?: number;
  medical?: boolean;
  support?: boolean;
  previous?: { school: string; country: string; curriculum: string };
  expired?: boolean;
  closeReason?: string;
  closedBy?: "SCHOOL" | "FAMILY";
};

const APPS: AppSeed[] = [
  // KG1, next year: the biggest intake.
  { first: b("Mira", "ميرا"), last: b("Haddadin", "حدادين"), gender: "F", nat: "JO", lang: "ar", grade: KG1, stage: "NEW", ago: 2, mother: b("Dana", "دانة"), father: b("Fadi", "فادي") },
  { first: b("Zayed", "زايد"), last: b("Al Mansouri", "المنصوري"), gender: "M", nat: "AE", lang: "ar", grade: KG1, stage: "NEW", ago: 3, mother: b("Shamma", "شما"), father: b("Hamad", "حمد"), medical: true },
  { first: b("Aarav", "آراف"), last: b("Kapoor", "كابور"), gender: "M", nat: "IN", lang: "hi", grade: KG1, stage: "NEW", ago: 4, mother: b("Priya", "بريا"), father: b("Rohan", "روهان"), ageShift: 14 },
  { first: b("Sofia", "صوفيا"), last: b("Rossi", "روسي"), gender: "F", nat: "IT", lang: "en", grade: KG1, stage: "NEW", ago: 1, mother: b("Giulia", "جوليا"), father: b("Marco", "ماركو") },
  { first: b("Yousef", "يوسف"), last: b("Barakat", "بركات"), gender: "M", nat: "LB", lang: "ar", grade: KG1, stage: "DOCUMENTS_PENDING", ago: 12, mother: b("Rima", "ريما"), father: b("Nabil", "نبيل") },
  { first: b("Hessa", "حصة"), last: b("Al Mazroui", "المزروعي"), gender: "F", nat: "AE", lang: "ar", grade: KG1, stage: "DOCUMENTS_PENDING", ago: 15, mother: b("Moza", "موزة"), father: b("Saif", "سيف") },
  { first: b("Ethan", "إيثان"), last: b("Clarke", "كلارك"), gender: "M", nat: "GB", lang: "en", grade: KG1, stage: "ASSESSMENT_BOOKED", ago: 18, mother: b("Emma", "إيما"), father: b("James", "جيمس") },
  { first: b("Layan", "ليان"), last: b("Sabbagh", "صباغ"), gender: "F", nat: "SY", lang: "ar", grade: KG1, stage: "ASSESSMENT_BOOKED", ago: 16, mother: b("Hala", "هالة"), father: b("Tarek", "طارق"), support: true },
  { first: b("Ibrahim", "إبراهيم"), last: b("Qasim", "قاسم"), gender: "M", nat: "PK", lang: "ur", grade: KG1, stage: "ASSESSMENT_BOOKED", ago: 20, mother: b("Ayesha", "عائشة"), father: b("Bilal", "بلال") },
  { first: b("Noor", "نور"), last: b("Al Hosani", "الحوسني"), gender: "F", nat: "AE", lang: "ar", grade: KG1, stage: "ASSESSED", ago: 30, mother: b("Latifa", "لطيفة"), father: b("Khalifa", "خليفة"), outcome: "RECOMMENDED" },
  { first: b("Leo", "ليو"), last: b("Fischer", "فيشر"), gender: "M", nat: "DE", lang: "de", grade: KG1, stage: "ASSESSED", ago: 28, mother: b("Anna", "آنا"), father: b("Lukas", "لوكاس"), outcome: "RECOMMENDED" },
  { first: b("Maryam", "مريم"), last: b("Hijazi", "حجازي"), gender: "F", nat: "PS", lang: "ar", grade: KG1, stage: "ASSESSED", ago: 33, mother: b("Lubna", "لبنى"), father: b("Ammar", "عمار"), outcome: "CONDITIONAL", support: true },
  { first: b("Adeline", "أديلين"), last: b("Santos", "سانتوس"), gender: "F", nat: "PH", lang: "tl", grade: KG1, stage: "OFFER_MADE", ago: 40, mother: b("Maria", "ماريا"), father: b("Jose", "خوسيه"), outcome: "RECOMMENDED" },
  { first: b("Omar", "عمر"), last: b("Abdelrahman", "عبد الرحمن"), gender: "M", nat: "EG", lang: "ar", grade: KG1, stage: "OFFER_MADE", ago: 44, mother: b("Nermeen", "نرمين"), father: b("Sherif", "شريف"), outcome: "RECOMMENDED", expired: true },
  { first: b("Hamdan", "حمدان"), last: b("Al Ameri", "العامري"), gender: "M", nat: "AE", lang: "ar", grade: KG1, stage: "OFFER_ACCEPTED", ago: 52, mother: b("Mariam", "مريم"), father: b("Rashid", "راشد"), outcome: "RECOMMENDED", staffChild: true },
  { first: b("Chloe", "كلوي"), last: b("Martin", "مارتن"), gender: "F", nat: "FR", lang: "fr", grade: KG1, stage: "OFFER_ACCEPTED", ago: 50, mother: b("Camille", "كاميل"), father: b("Julien", "جوليان"), outcome: "RECOMMENDED" },
  { first: b("Talia", "تاليا"), last: b("Ghanem", "غانم"), gender: "F", nat: "JO", lang: "ar", grade: KG1, stage: "SEAT_PAID", ago: 60, mother: b("Rasha", "رشا"), father: b("Hani", "هاني"), outcome: "RECOMMENDED" },
  { first: b("Arjun", "أرجون"), last: b("Reddy", "ريدي"), gender: "M", nat: "IN", lang: "en", grade: KG1, stage: "SEAT_PAID", ago: 58, mother: b("Kavya", "كافيا"), father: b("Vikram", "فيكرام"), outcome: "RECOMMENDED", medical: true },
  { first: b("Salma", "سلمى"), last: b("Bakri", "بكري"), gender: "F", nat: "SD", lang: "ar", grade: KG1, stage: "ENROLLED", ago: 70, mother: b("Amna", "آمنة"), father: b("Osman", "عثمان"), outcome: "RECOMMENDED" },
  { first: b("Daniel", "دانيال"), last: b("Okafor", "أوكافور"), gender: "M", nat: "NG", lang: "en", grade: KG1, stage: "ENROLLED", ago: 68, mother: b("Ngozi", "نغوزي"), father: b("Chinedu", "تشينيدو"), outcome: "RECOMMENDED" },
  { first: b("Rayan", "ريان"), last: b("Chaouki", "شوقي"), gender: "M", nat: "MA", lang: "ar", grade: KG1, stage: "DECLINED", ago: 46, mother: b("Salma", "سلمى"), father: b("Youssef", "يوسف"), ageShift: 15, closeReason: "age", closedBy: "SCHOOL" },
  { first: b("Ava", "آفا"), last: b("Thompson", "تومسون"), gender: "F", nat: "CA", lang: "en", grade: KG1, stage: "WITHDRAWN", ago: 55, mother: b("Olivia", "أوليفيا"), father: b("Ryan", "رايان"), closeReason: "relocation", closedBy: "FAMILY" },
  // KG2
  { first: b("Ali", "علي"), last: b("Rahimi", "رحيمي"), gender: "M", nat: "IR", lang: "fa", grade: KG2, stage: "NEW", ago: 5, mother: b("Sara", "سارة"), father: b("Reza", "رضا") },
  { first: b("Jana", "جنى"), last: b("Itani", "عيتاني"), gender: "F", nat: "LB", lang: "ar", grade: KG2, stage: "NEW", ago: 6, mother: b("Maya", "مايا"), father: b("Karim", "كريم"), previous: { school: "Little Cedars Nursery", country: "LB", curriculum: "Early years" } },
  { first: b("Musa", "موسى"), last: b("Al Kindi", "الكندي"), gender: "M", nat: "OM", lang: "ar", grade: KG2, stage: "ASSESSMENT_BOOKED", ago: 21, mother: b("Zainab", "زينب"), father: b("Said", "سعيد"), previous: { school: "Muscat Early Learning Centre", country: "OM", curriculum: "British EYFS" } },
  { first: b("Elena", "إيلينا"), last: b("Petrova", "بتروفا"), gender: "F", nat: "RU", lang: "ru", grade: KG2, stage: "ASSESSED", ago: 31, mother: b("Irina", "إيرينا"), father: b("Dmitri", "ديمتري"), outcome: "RECOMMENDED", previous: { school: "Sunshine Nursery Dubai", country: "AE", curriculum: "British EYFS" } },
  { first: b("Fatima", "فاطمة"), last: b("Al Balushi", "البلوشي"), gender: "F", nat: "AE", lang: "ar", grade: KG2, stage: "OFFER_MADE", ago: 38, mother: b("Asma", "أسماء"), father: b("Majid", "ماجد"), outcome: "RECOMMENDED", previous: { school: "Al Barsha Nursery", country: "AE", curriculum: "Montessori" } },
  { first: b("Liam", "ليام"), last: b("O'Brien", "أوبراين"), gender: "M", nat: "IE", lang: "en", grade: KG2, stage: "SEAT_PAID", ago: 57, mother: b("Siobhan", "شيفون"), father: b("Conor", "كونور"), outcome: "RECOMMENDED", previous: { school: "Green Leaves Nursery", country: "AE", curriculum: "British EYFS" } },
  { first: b("Hind", "هند"), last: b("Zuabi", "زعبي"), gender: "F", nat: "JO", lang: "ar", grade: KG2, stage: "ENROLLED", ago: 66, mother: b("Rula", "رولا"), father: b("Imad", "عماد"), outcome: "RECOMMENDED", previous: { school: "Amman Kids Academy", country: "JO", curriculum: "Jordanian" } },
  // Primary
  { first: b("Kenji", "كينجي"), last: b("Watanabe", "واتانابي"), gender: "M", nat: "JP", lang: "en", grade: 1, stage: "NEW", ago: 7, mother: b("Yuki", "يوكي"), father: b("Hiro", "هيرو"), previous: { school: "Tokyo International Kindergarten", country: "JP", curriculum: "International" } },
  { first: b("Lara", "لارا"), last: b("Mansour", "منصور"), gender: "F", nat: "EG", lang: "ar", grade: 1, stage: "ASSESSED", ago: 27, mother: b("Dina", "دينا"), father: b("Ahmed", "أحمد"), outcome: "RECOMMENDED", previous: { school: "Cairo British Kindergarten", country: "EG", curriculum: "British" } },
  { first: b("Zara", "زارا"), last: b("Hussain", "حسين"), gender: "F", nat: "GB", lang: "en", grade: 1, stage: "OFFER_ACCEPTED", ago: 48, mother: b("Nadia", "نادية"), father: b("Imran", "عمران"), outcome: "RECOMMENDED", previous: { school: "Riverside Primary", country: "GB", curriculum: "British" } },
  { first: b("Hamza", "حمزة"), last: b("Siddiq", "صدّيق"), gender: "M", nat: "PK", lang: "ur", grade: 1, stage: "DECLINED", ago: 49, mother: b("Sana", "سناء"), father: b("Usman", "عثمان"), ageShift: -14, closeReason: "family_choice", closedBy: "FAMILY", previous: { school: "Karachi Grammar Early Years", country: "PK", curriculum: "British" } },
  { first: b("Rania", "رانيا"), last: b("Haddad", "حداد"), gender: "F", nat: "SY", lang: "ar", grade: 3, stage: "DOCUMENTS_PENDING", ago: 9, mother: b("Lama", "لمى"), father: b("Samer", "سامر"), previous: { school: "Damascus Community School", country: "SY", curriculum: "American" } },
  { first: b("Noah", "نوح"), last: b("Williams", "ويليامز"), gender: "M", nat: "US", lang: "en", grade: 3, stage: "OFFER_MADE", ago: 35, mother: b("Sarah", "سارة"), father: b("Michael", "مايكل"), outcome: "RECOMMENDED", previous: { school: "Lincoln Elementary", country: "US", curriculum: "American" } },
  // Middle and high school
  { first: b("Abdulla", "عبدالله"), last: b("Al Naqbi", "النقبي"), gender: "M", nat: "AE", lang: "ar", grade: 6, stage: "NEW", ago: 8, mother: b("Aysha", "عائشة"), father: b("Ahmed", "أحمد"), previous: { school: "Sharjah American School", country: "AE", curriculum: "American" } },
  { first: b("Isabella", "إيزابيلا"), last: b("Garcia", "غارسيا"), gender: "F", nat: "ES", lang: "es", grade: 6, stage: "ASSESSED", ago: 26, mother: b("Lucia", "لوسيا"), father: b("Carlos", "كارلوس"), outcome: "CONDITIONAL", previous: { school: "Colegio Internacional Madrid", country: "ES", curriculum: "IB" } },
  { first: b("Tamim", "تميم"), last: b("Al Thani", "آل ثاني"), gender: "M", nat: "QA", lang: "ar", grade: 7, stage: "ASSESSMENT_BOOKED", ago: 14, mother: b("Noora", "نورة"), father: b("Jassim", "جاسم"), previous: { school: "Doha Academy", country: "QA", curriculum: "British" } },
  { first: b("Mila", "ميلا"), last: b("Novak", "نوفاك"), gender: "F", nat: "HR", lang: "en", grade: 7, stage: "WITHDRAWN", ago: 42, mother: b("Ana", "آنا"), father: b("Ivan", "إيفان"), closeReason: "other_school", closedBy: "FAMILY", previous: { school: "Zagreb International School", country: "HR", curriculum: "IB" } },
  { first: b("Kareem", "كريم"), last: b("Nassar", "نصار"), gender: "M", nat: "PS", lang: "ar", grade: 9, stage: "NEW", ago: 4, mother: b("Huda", "هدى"), father: b("Walid", "وليد"), previous: { school: "Ramallah Friends School", country: "PS", curriculum: "IB" } },
  { first: b("Priya", "بريا"), last: b("Nambiar", "نامبيار"), gender: "F", nat: "IN", lang: "mal", grade: 9, stage: "OFFER_ACCEPTED", ago: 47, mother: b("Lakshmi", "لاكشمي"), father: b("Suresh", "سوريش"), outcome: "RECOMMENDED", previous: { school: "Bangalore International School", country: "IN", curriculum: "CBSE" } },
  { first: b("Adam", "آدم"), last: b("Benjelloun", "بنجلون"), gender: "M", nat: "MA", lang: "fr", grade: 10, stage: "OFFER_ACCEPTED", ago: 45, mother: b("Leila", "ليلى"), father: b("Mehdi", "مهدي"), outcome: "RECOMMENDED", previous: { school: "Lycée Descartes Rabat", country: "MA", curriculum: "French" } },
  { first: b("Grace", "غريس"), last: b("Mensah", "منساه"), gender: "F", nat: "GH", lang: "en", grade: 10, stage: "OFFER_MADE", ago: 36, mother: b("Abena", "أبينا"), father: b("Kwame", "كوامي"), outcome: "RECOMMENDED", previous: { school: "Accra Academy", country: "GH", curriculum: "American" } },
  { first: b("Ahmad", "أحمد"), last: b("Al Hashimi", "الهاشمي"), gender: "M", nat: "AE", lang: "ar", grade: 10, stage: "WAITLISTED", ago: 22, mother: b("", ""), father: b("", ""), siblingOf: 2, outcome: "RECOMMENDED", previous: { school: "Dubai Scholars", country: "AE", curriculum: "American" } },
  { first: b("Sami", "سامي"), last: b("Farah", "فرح"), gender: "M", nat: "LB", lang: "ar", grade: 10, stage: "WAITLISTED", ago: 34, mother: b("Nour", "نور"), father: b("Georges", "جورج"), outcome: "RECOMMENDED", previous: { school: "Beirut Baptist School", country: "LB", curriculum: "American" } },
  { first: b("Hannah", "هانا"), last: b("Schmidt", "شميت"), gender: "F", nat: "DE", lang: "de", grade: 10, stage: "WAITLISTED", ago: 29, mother: b("Katrin", "كاترين"), father: b("Stefan", "شتيفان"), outcome: "CONDITIONAL", previous: { school: "Deutsche Schule Abu Dhabi", country: "AE", curriculum: "German" } },
  { first: b("Youssef", "يوسف"), last: b("Kassem", "قاسم"), gender: "M", nat: "JO", lang: "ar", grade: 11, stage: "ASSESSED", ago: 24, mother: b("Nisreen", "نسرين"), father: b("Ziad", "زياد"), outcome: "RECOMMENDED", previous: { school: "King's Academy", country: "JO", curriculum: "American" } },
  { first: b("Aisha", "عائشة"), last: b("Rahmani", "رحماني"), gender: "F", nat: "AF", lang: "fa", grade: 11, stage: "NEW", ago: 3, mother: b("Farida", "فريدة"), father: b("Jawad", "جواد"), previous: { school: "Kabul International School", country: "AF", curriculum: "American" } },
];

/** Draft applications families have started and not submitted yet. */
const DRAFTS: Array<Pick<AppSeed, "first" | "last" | "gender" | "nat" | "grade" | "mother" | "father"> & { ago: number; steps: string }> = [
  { first: b("Lina", "لينا"), last: b("Sharaf", "شرف"), gender: "F", nat: "JO", grade: KG1, mother: b("Reem", "ريم"), father: b("Bassam", "بسام"), ago: 1, steps: "student,schooling" },
  { first: b("Oliver", "أوليفر"), last: b("Brown", "براون"), gender: "M", nat: "AU", grade: KG1, mother: b("Charlotte", "شارلوت"), father: b("Jack", "جاك"), ago: 2, steps: "student" },
  { first: b("Reem", "ريم"), last: b("Taha", "طه"), gender: "F", nat: "SA", grade: 2, mother: b("Haya", "هيا"), father: b("Faisal", "فيصل"), ago: 5, steps: "student,schooling,family" },
];

const NEXT_SEATS: Record<number, { seats: number[]; fee: number }> = {
  [-1]: { seats: [20, 20], fee: 250000 },
  0: { seats: [20], fee: 250000 },
  1: { seats: [22], fee: 300000 },
  2: { seats: [22], fee: 300000 },
  3: { seats: [22], fee: 300000 },
  4: { seats: [22], fee: 300000 },
  5: { seats: [22], fee: 300000 },
  6: { seats: [24], fee: 350000 },
  7: { seats: [24], fee: 350000 },
  8: { seats: [24], fee: 350000 },
  9: { seats: [12, 12], fee: 350000 },
  10: { seats: [12, 12], fee: 350000 },
  11: { seats: [12, 12], fee: 350000 },
  12: { seats: [12, 12], fee: 350000 },
};

/** Stage path an application walked to reach its current stage (for the history and the funnel). */
function pathTo(stage: Stage): Stage[] {
  const main: Stage[] = ["NEW", "DOCUMENTS_PENDING", "ASSESSMENT_BOOKED", "ASSESSED", "OFFER_MADE", "OFFER_ACCEPTED", "SEAT_PAID", "ENROLLED"];
  if (stage === "WAITLISTED") return ["NEW", "ASSESSMENT_BOOKED", "ASSESSED", "WAITLISTED"];
  if (stage === "DECLINED") return ["NEW", "ASSESSMENT_BOOKED", "DECLINED"];
  if (stage === "WITHDRAWN") return ["NEW", "DOCUMENTS_PENDING", "WITHDRAWN"];
  const i = main.indexOf(stage);
  return main.slice(0, i + 1).filter((s) => s !== "DOCUMENTS_PENDING" || stage === "DOCUMENTS_PENDING");
}

export async function seedAdmissions(w: SeedWorld) {
  const { db, orgId, now, log } = w;
  const r = rng(20261026);
  const tx = db as unknown as Tx;
  await ensureAdmissionSetup(tx, orgId);

  // --- Years -----------------------------------------------------------------------------------
  const current = await db.academicYear.findFirstOrThrow({ where: { orgId, isCurrent: true } });
  const next = await db.academicYear.findFirst({ where: { orgId, isCurrent: false, startsOn: { gt: current.startsOn } }, orderBy: { startsOn: "asc" } });
  if (!next) {
    log("admissions: no next academic year, skipped");
    return;
  }
  const entry = entryYearOf(next);

  // --- Settings and places ---------------------------------------------------------------------------
  await db.admissionSettings.create({
    data: {
      orgId,
      publicOpen: true,
      cutoffMonth: 12,
      cutoffDay: 31,
      admissionNoPattern: "HIS-{YY}{SEQ:3}",
      offerDays: 14,
      introEn: "Horizon opens its new kindergarten and primary wing next year. Applications are open from KG1 to Grade 11. Save your application at any time and finish it later.",
      introAr: "تفتتح هورايزن جناح رياض الأطفال والمرحلة الابتدائية الجديد في العام القادم، والتقديم مفتوح من الروضة الأولى حتى الصف الحادي عشر. يمكنكم حفظ الطلب في أي وقت وإكماله لاحقًا.",
      updatedById: w.staff.get("aisha_rahman")!.membershipId,
      createdAt: at(-120, 9, 0, now),
    },
  });
  await db.admissionCapacity.createMany({
    data: [
      ...Object.entries(NEXT_SEATS).map(([g, v]) => ({ orgId, academicYearId: next.id, gradeLevel: Number(g), sectionSeats: v.seats, seatFeeFils: v.fee })),
      ...[6, 7, 8, 9, 10, 11, 12].map((g) => ({ orgId, academicYearId: current.id, gradeLevel: g, sectionSeats: [14, 14], seatFeeFils: 350000 })),
    ],
  });

  // --- The Admissions Officer persona -----------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 8);
  const hanaEmail = "hana.saleh@horizon.example";
  await db.user.createMany({ data: [{ email: hanaEmail, nameEn: "Hana Saleh", nameAr: "هناء صالح", passwordHash }], skipDuplicates: true });
  const hanaUser = await db.user.update({ where: { email: hanaEmail }, data: { passwordHash, lastActiveOrgId: orgId, locale: null } });
  const hanaId = stableId("membership", orgId, hanaEmail);
  const role = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId, key: "admissions_officer" } } });
  await db.membership.create({ data: { id: hanaId, orgId, userId: hanaUser.id, status: "ACTIVE", titleEn: "Admissions Officer", titleAr: "مسؤولة القبول والتسجيل", createdAt: at(-400, 8, 0, now) } });
  await db.membershipRole.create({ data: { orgId, membershipId: hanaId, roleId: role.id } });
  const adminDept = w.departments.get("administration") ?? null;
  await db.staffProfile.create({ data: { orgId, membershipId: hanaId, departmentId: adminDept, employeeNo: "HIS-1090", jobTitleEn: "Admissions Officer", jobTitleAr: "مسؤولة القبول والتسجيل", phone: "+971 50 555 0290", officeEn: "Admissions office, Block A", officeAr: "مكتب القبول، المبنى A" } });
  await db.availabilityRule.createMany({ data: [1, 2, 3, 4, 5].map((weekday) => ({ orgId, membershipId: hanaId, weekday, startMinute: 8 * 60, endMinute: 15 * 60 })) });
  const type = await db.appointmentType.findUniqueOrThrow({ where: { orgId_key: { orgId, key: ASSESSMENT_TYPE_KEY } } });
  const registrar = w.personas.registrar;
  await db.appointmentTypeHost.createMany({ data: [hanaId, registrar].filter(Boolean).map((m) => ({ orgId, typeId: type.id, membershipId: m })), skipDuplicates: true });
  const maxOrder = (await db.demoPersona.aggregate({ where: { orgId }, _max: { order: true } }))._max.order ?? 20;
  await db.demoPersona.create({ data: { orgId, key: "admissions", membershipId: hanaId, roleLabelEn: "Admissions Officer", roleLabelAr: "مسؤولة القبول والتسجيل", blurbEn: "Runs applications from KG1 to Grade 12, offers, enrollment and re-enrollment.", blurbAr: "تدير الطلبات من الروضة الأولى حتى الصف الثاني عشر والعروض والقيد وإعادة التسجيل.", homePath: "/admissions", order: maxOrder + 1 } });
  w.personas.admissions = hanaId;

  // --- Applicant families (global accounts) ------------------------------------------------------------
  const taken = new Set<string>();
  const familyEmail = (s: { father: Bi; mother: Bi; last: Bi }) => emailFor(s.mother.en || s.father.en || "family", s.last.en, "family.example", taken);
  const apps = APPS.map((a) => ({ ...a, email: a.siblingOf !== undefined ? w.guardians[a.siblingOf].email : familyEmail(a) }));
  const drafts = DRAFTS.map((a) => ({ ...a, email: familyEmail(a) }));
  const raniaEmail = w.rania.email;
  const users = [...apps, ...drafts].filter((a) => !a.email.endsWith("horizon.example")).map((a) => ({ email: a.email, nameEn: `${a.mother.en || a.father.en} ${a.last.en}`, nameAr: `${a.mother.ar || a.father.ar} ${a.last.ar}`, passwordHash, emailVerified: at(-90, 9, 0, now) }));
  await db.user.createMany({ data: users, skipDuplicates: true });
  const userIds = new Map((await db.user.findMany({ where: { email: { in: [...apps, ...drafts].map((a) => a.email).concat(raniaEmail) } }, select: { id: true, email: true } })).map((u) => [u.email, u.id]));

  const settings = { docTypes: DEFAULT_DOC_TYPES };
  const sampleDocs = (appId: string, grade: number, nat: string, when: Date, complete: boolean, accepted: boolean): Prisma.AdmissionDocumentCreateManyInput[] => {
    const types = docTypesFor(settings.docTypes, grade, nat).filter((d) => d.required || r.chance(0.4));
    const list = complete ? types : types.filter((d, i) => i % 3 !== 1);
    return list.map((d, i) => ({ orgId, applicationId: appId, typeKey: d.key, fileName: `${d.key.replace(/_/g, "-")}.pdf`, mimeType: "application/pdf", sizeBytes: 140_000 + ((i * 7919) % 900_000), storageKey: `sample:${d.key}`, checksum: stableId("doc", appId, d.key), status: accepted ? "ACCEPTED" : "RECEIVED", createdAt: new Date(when.getTime() + i * 60_000) }));
  };

  let seq = 0;
  const appNo = () => `ADM-${entry}-${String(++seq).padStart(4, "0")}`;
  const appRows: Prisma.AdmissionApplicationCreateManyInput[] = [];
  const events: Prisma.AdmissionEventCreateManyInput[] = [];
  const docs: Prisma.AdmissionDocumentCreateManyInput[] = [];
  const messages: Prisma.AdmissionMessageCreateManyInput[] = [];
  const appointments: Prisma.AppointmentCreateManyInput[] = [];
  const attendees: Prisma.AppointmentAttendeeCreateManyInput[] = [];
  const toEnroll: Array<{ id: string; at: Date }> = [];
  const dob = (grade: number, shift = 0) => {
    // Middle of the usual birth year for the grade, shifted in months.
    const age = grade + 5;
    const d = new Date(Date.UTC(entry - age, 5, 1 + r.int(0, 27)));
    d.setUTCMonth(d.getUTCMonth() - shift + r.int(-4, 4));
    return d;
  };
  const guardianJson = (a: (typeof apps)[number]) => {
    if (a.siblingOf !== undefined) {
      const g = w.guardians[a.siblingOf];
      return [{ relationship: g.gender === "F" ? "MOTHER" : "FATHER", firstNameEn: g.first.en, lastNameEn: g.last.en, firstNameAr: g.first.ar, lastNameAr: g.last.ar, email: g.email, phone: g.phone, occupation: "", employer: "", livesWith: true, primary: true }];
    }
    const phone = (n: number) => `+971 5${n % 6} 555 ${String(3000 + n).slice(-4)}`;
    return [
      { relationship: "MOTHER", firstNameEn: a.mother.en, lastNameEn: a.last.en, firstNameAr: a.mother.ar, lastNameAr: a.last.ar, email: a.email, phone: phone(seq * 3 + 1), occupation: r.pick(["Engineer", "Doctor", "Teacher", "Architect", "Accountant", "Designer", ""]), employer: "", livesWith: true, primary: true },
      { relationship: "FATHER", firstNameEn: a.father.en, lastNameEn: a.last.en, firstNameAr: a.father.ar, lastNameAr: a.last.ar, email: a.email.replace("@", ".2@"), phone: phone(seq * 3 + 2), occupation: r.pick(["Manager", "Pilot", "Pharmacist", "Consultant", "Business owner", ""]), employer: "", livesWith: true, primary: false },
    ];
  };

  for (const a of apps) {
    const appId = id();
    const number = appNo();
    const submitted = at(-a.ago, 9 + (a.ago % 8), (a.ago * 7) % 60, now);
    const path = pathTo(a.stage);
    const birth = dob(a.grade, a.ageShift ?? 0);
    const withEid = a.ago % 4 !== 1;
    const eid = withEid ? `784${birth.getUTCFullYear()}${String(1_000_000 + ((seq * 104729) % 8_999_999)).slice(0, 7)}${seq % 10}` : null;
    const passport = `${["N", "P", "A", "K", "L"][seq % 5]}${String(10_000_000 + ((seq * 7919) % 89_999_999)).slice(0, 8)}`;
    const staffMember = a.staffChild;
    // Stage dates: spread from the submission date to a day or two ago.
    const span = Math.max(1, a.ago - 1);
    // Each later step on its own day within office hours (the family's own steps in the evening).
    const stepDay = (i: number) => -a.ago + Math.round((span * 0.9 * i) / Math.max(1, path.length - 1));
    const dates = path.map((s, i) => (i === 0 ? submitted : s === "OFFER_ACCEPTED" ? at(stepDay(i), 19 + (seq % 3), (seq * 11) % 60, now) : at(stepDay(i), 8 + ((seq + i * 3) % 7), (seq * 7 + i * 13) % 60, now)));
    const last = dates[dates.length - 1];
    const offerIdx = path.indexOf("OFFER_MADE");
    const offerAt = offerIdx >= 0 ? dates[offerIdx] : null;
    const assessIdx = path.indexOf("ASSESSMENT_BOOKED");
    const siblingIds = a.siblingOf !== undefined ? w.guardians[a.siblingOf].studentIds : [];
    const medical = a.medical ? encryptField(JSON.stringify({ allergies: a.grade <= 0 ? "Peanuts and tree nuts (carries an auto-injector)" : "Penicillin", conditions: a.grade <= 0 ? "" : "Mild asthma", medications: a.grade <= 0 ? "" : "Inhaler when needed" })) : null;
    const support = a.support ? encryptField(JSON.stringify({ needed: true, details: "Speech and language support twice a week at the current nursery; benefits from visual timetables.", previousAssessment: true })) : null;
    const seatFee = NEXT_SEATS[a.grade]?.fee ?? 0;
    appRows.push({
      id: appId,
      orgId,
      number,
      applicantUserId: userIds.get(a.email)!,
      academicYearId: next.id,
      gradeLevel: a.grade,
      curriculum: null,
      stage: a.stage === "ENROLLED" ? "SEAT_PAID" : a.stage,
      stageChangedAt: last,
      submittedAt: submitted,
      source: "ONLINE",
      step: "student,schooling,family,health",
      firstNameEn: a.first.en,
      lastNameEn: a.last.en,
      firstNameAr: a.first.ar,
      lastNameAr: a.last.ar,
      dateOfBirth: birth,
      gender: a.gender,
      nationality: a.nat,
      homeLanguage: a.lang,
      emiratesIdEnc: eid ? encryptField(eid) : null,
      emiratesIdLast4: eid ? eid.slice(-4) : null,
      emiratesIdHash: eid ? eidHash(eid) : null,
      passportEnc: encryptField(passport),
      passportLast4: passport.slice(-4),
      nameDobKey: nameDobKey(a.first.en, a.last.en, birth),
      schooling: (a.previous ? { attended: true, schoolName: a.previous.school, city: "", country: a.previous.country, curriculum: a.previous.curriculum, lastGrade: "", fromYear: entry - 3, toYear: entry, leavingReason: "Family moving to Dubai" } : { attended: false }) as Prisma.InputJsonValue,
      guardians: guardianJson(a) as Prisma.InputJsonValue,
      siblings: (a.siblingOf !== undefined ? [{ name: `${w.students.find((s) => s.id === siblingIds[0])?.first.en ?? ""} ${a.last.en}`, gradeLevel: w.students.find((s) => s.id === siblingIds[0])?.grade ?? null, studentNo: "" }] : []) as Prisma.InputJsonValue,
      siblingStudentIds: siblingIds,
      staffChild: Boolean(staffMember),
      staffChildVerified: Boolean(staffMember),
      priorityBoost: 0,
      medicalEnc: medical,
      supportEnc: support,
      hasMedical: Boolean(a.medical),
      hasSupport: Boolean(a.support),
      consentAt: submitted,
      assessmentOutcome: a.outcome ?? null,
      assessmentNotes: a.outcome ? (a.outcome === "RECOMMENDED" ? "Settled quickly, engaged with the activities and followed instructions in English and Arabic." : "Ready to join with some language support in the first term.") : null,
      offerSection: offerAt ? "A" : null,
      offerMadeAt: offerAt,
      offerDeadline: offerAt ? (a.expired ? at(-2, 23, 59, now) : new Date(Math.max(offerAt.getTime() + 14 * DAY, at(5 + (seq % 6), 23, 59, now).getTime()))) : null,
      offerRespondedAt: ["OFFER_ACCEPTED", "SEAT_PAID", "ENROLLED"].includes(a.stage) ? dates[path.indexOf("OFFER_ACCEPTED")] : null,
      seatFeeFils: offerAt ? seatFee : null,
      seatPaidAt: ["SEAT_PAID", "ENROLLED"].includes(a.stage) ? dates[path.indexOf("SEAT_PAID")] : null,
      seatPaymentRef: ["SEAT_PAID", "ENROLLED"].includes(a.stage) ? `RCPT-${entry}-${String(200 + seq)}` : null,
      closedBy: a.closedBy ?? null,
      closeReason: a.closeReason ?? null,
      waitlistedAt: a.stage === "WAITLISTED" ? last : null,
      duplicateFlags: [],
      createdAt: new Date(submitted.getTime() - 2 * DAY),
      updatedAt: last,
    });
    events.push({ orgId, applicationId: appId, kind: "created", toStage: "DRAFT", createdAt: new Date(submitted.getTime() - 2 * DAY) });
    path.forEach((s, i) => events.push({ orgId, applicationId: appId, kind: s === "OFFER_MADE" || s === "OFFER_ACCEPTED" ? "offer" : s === "SEAT_PAID" ? "payment" : "stage", fromStage: i === 0 ? "DRAFT" : path[i - 1], toStage: s, actorMembershipId: i === 0 || s === "OFFER_ACCEPTED" ? null : hanaId, createdAt: dates[i] }));
    const complete = !["NEW", "DOCUMENTS_PENDING"].includes(a.stage) || a.ago % 2 === 0;
    docs.push(...sampleDocs(appId, a.grade, a.nat, new Date(submitted.getTime() - DAY), complete && a.stage !== "DOCUMENTS_PENDING", path.includes("ASSESSED")));
    if (assessIdx >= 0) {
      const booked = a.stage === "ASSESSMENT_BOOKED";
      const start = booked ? at(1 + (seq % 6), 9 + (seq % 4), 0, now) : at(stepDay(assessIdx) + 5, 9 + (seq % 5), seq % 2 ? 30 : 0, now);
      const apptId = id();
      appointments.push({ id: apptId, orgId, typeId: type.id, hostId: hanaId, bookedById: hanaId, studentId: null, startsAt: start, endsAt: new Date(start.getTime() + 45 * 60_000), status: booked ? "CONFIRMED" : "COMPLETED", locationEn: "Admissions office", locationAr: "مكتب القبول", notesEn: `${number}: ${a.first.en} ${a.last.en}`, createdAt: dates[assessIdx] });
      attendees.push({ orgId, appointmentId: apptId, membershipId: hanaId });
      appRows[appRows.length - 1].assessmentAppointmentId = apptId;
    }
    // Conversation: a question from the family and a reply, plus an internal note on some applications.
    if (seq % 3 === 0 && a.stage !== "NEW") {
      messages.push({ orgId, applicationId: appId, authorUserId: userIds.get(a.email)!, visibility: "SHARED", body: a.lang === "ar" ? "مرحبًا، هل يمكن تقديم موعد التقييم إلى صباح الثلاثاء؟" : "Hello, could the assessment be on a Tuesday morning instead?", createdAt: new Date(submitted.getTime() + 2 * DAY) });
      messages.push({ orgId, applicationId: appId, authorMembershipId: hanaId, visibility: "SHARED", body: a.lang === "ar" ? "أهلًا بكم، تم ذلك. أرسلنا إليكم الموعد الجديد بالبريد الإلكتروني." : "Of course. We have moved it and emailed you the new time.", createdAt: new Date(submitted.getTime() + 2 * DAY + 3 * 3600_000) });
    }
    if (seq % 4 === 2) messages.push({ orgId, applicationId: appId, authorMembershipId: hanaId, visibility: "STAFF", body: "Previous school report received by email; uploaded copy to follow.", createdAt: new Date(submitted.getTime() + DAY) });
    if (a.stage === "DOCUMENTS_PENDING") messages.push({ orgId, applicationId: appId, authorMembershipId: hanaId, visibility: "SHARED", body: a.lang === "ar" ? "شكرًا على طلبكم. يُرجى رفع شهادة الميلاد وسجل التطعيمات لنتمكن من حجز موعد التقييم." : "Thank you for applying. Please upload the birth certificate and vaccination record so we can book the assessment.", createdAt: last });
    if (a.stage === "ENROLLED") toEnroll.push({ id: appId, at: new Date(last.getTime()) });
  }

  // Rania Nasser (the parent persona) applies for her youngest, Lina, with her family portal account.
  {
    const appId = id();
    const birth = dob(KG1, 2);
    const offerAt = at(-3, 10, 30, now);
    const submittedAt = at(-34, 20, 15, now);
    appRows.push({
      id: appId,
      orgId,
      number: appNo(),
      applicantUserId: userIds.get(raniaEmail)!,
      academicYearId: next.id,
      gradeLevel: KG1,
      stage: "OFFER_MADE",
      stageChangedAt: offerAt,
      submittedAt,
      step: "student,schooling,family,health",
      firstNameEn: "Lina",
      lastNameEn: "Nasser",
      firstNameAr: "لينا",
      lastNameAr: "ناصر",
      dateOfBirth: birth,
      gender: "F",
      nationality: "JO",
      homeLanguage: "ar",
      passportEnc: encryptField("N4471209"),
      passportLast4: "1209",
      nameDobKey: nameDobKey("Lina", "Nasser", birth),
      schooling: { attended: false } as Prisma.InputJsonValue,
      guardians: [
        { relationship: "MOTHER", firstNameEn: w.rania.first.en, lastNameEn: w.rania.last.en, firstNameAr: w.rania.first.ar, lastNameAr: w.rania.last.ar, email: w.rania.email, phone: w.rania.phone, occupation: "Architect", employer: "", livesWith: true, primary: true },
        { relationship: "FATHER", firstNameEn: w.karim.first.en, lastNameEn: w.karim.last.en, firstNameAr: w.karim.first.ar, lastNameAr: w.karim.last.ar, email: w.karim.email, phone: w.karim.phone, occupation: "Civil engineer", employer: "", livesWith: true, primary: false },
      ] as Prisma.InputJsonValue,
      siblings: [{ name: "Adam Nasser", gradeLevel: 9, studentNo: "" }, { name: "Yara Nasser", gradeLevel: 6, studentNo: "" }] as Prisma.InputJsonValue,
      siblingStudentIds: [w.adam.id, w.yara.id],
      consentAt: submittedAt,
      assessmentOutcome: "RECOMMENDED",
      assessmentNotes: "Confident and curious; already reads simple words in Arabic and English.",
      offerSection: "B",
      offerMadeAt: offerAt,
      offerDeadline: at(11, 23, 59, now),
      seatFeeFils: NEXT_SEATS[KG1].fee,
      createdAt: at(-36, 21, 0, now),
      updatedAt: offerAt,
    });
    for (const [i, s] of (["NEW", "ASSESSMENT_BOOKED", "ASSESSED", "OFFER_MADE"] as Stage[]).entries()) events.push({ orgId, applicationId: appId, kind: s === "OFFER_MADE" ? "offer" : "stage", fromStage: i === 0 ? "DRAFT" : null, toStage: s, actorMembershipId: i === 0 ? null : hanaId, createdAt: at(-34 + i * 9, 10, 0, now) });
    docs.push(...sampleDocs(appId, KG1, "JO", at(-34, 20, 0, now), true, true));
    messages.push({ orgId, applicationId: appId, authorMembershipId: hanaId, visibility: "SHARED", body: "Dear Rania, we are delighted to offer Lina a place in KG1. The offer letter is ready on this page.", createdAt: offerAt });
  }

  // Drafts in progress.
  for (const d of drafts) {
    const appId = id();
    const birth = dob(d.grade);
    appRows.push({ id: appId, orgId, number: appNo(), applicantUserId: userIds.get(d.email)!, academicYearId: next.id, gradeLevel: d.grade, stage: "DRAFT", stageChangedAt: at(-d.ago, 19, 0, now), step: d.steps, firstNameEn: d.first.en, lastNameEn: d.last.en, firstNameAr: d.first.ar, lastNameAr: d.last.ar, dateOfBirth: birth, gender: d.gender, nationality: d.nat, nameDobKey: nameDobKey(d.first.en, d.last.en, birth), createdAt: at(-d.ago, 19, 0, now), updatedAt: at(-d.ago, 19, 30, now) });
    events.push({ orgId, applicationId: appId, kind: "created", toStage: "DRAFT", createdAt: at(-d.ago, 19, 0, now) });
  }

  // A family that withdrew and applied again for the same child (possible duplicate for staff).
  const withdrawnG11 = appRows.find((x) => x.firstNameEn === "Aisha" && x.lastNameEn === "Rahmani")!;
  {
    const appId = id();
    const birth = withdrawnG11.dateOfBirth as Date;
    appRows.push({ ...withdrawnG11, id: appId, number: appNo(), stage: "WITHDRAWN", stageChangedAt: at(-60, 12, 0, now), submittedAt: at(-80, 9, 0, now), closedBy: "FAMILY", closeReason: "relocation", createdAt: at(-82, 9, 0, now), updatedAt: at(-60, 12, 0, now), nameDobKey: nameDobKey("Aisha", "Rahmani", birth) });
    events.push({ orgId, applicationId: appId, kind: "stage", fromStage: "DRAFT", toStage: "NEW", createdAt: at(-80, 9, 0, now) }, { orgId, applicationId: appId, kind: "stage", fromStage: "NEW", toStage: "WITHDRAWN", createdAt: at(-60, 12, 0, now) });
    withdrawnG11.duplicateFlags = [`namedob:application:${appId}`];
  }

  await db.admissionApplication.createMany({ data: appRows });
  // Application numbers above were assigned here, so the school's counter continues after them.
  await db.sequence.upsert({ where: { orgId_key: { orgId, key: `ADM-${entry}` } }, create: { orgId, key: `ADM-${entry}`, value: seq }, update: { value: seq } });
  await db.admissionEvent.createMany({ data: events });
  await db.admissionDocument.createMany({ data: docs });
  await db.admissionMessage.createMany({ data: messages });
  if (appointments.length) {
    await db.appointment.createMany({ data: appointments });
    await db.appointmentAttendee.createMany({ data: attendees });
  }

  // --- Enrolled for next year (through the real enrollment service) -------------------------------------
  const actor = { membershipId: hanaId, userId: hanaUser.id };
  const regIds: string[] = [];
  for (const e of toEnroll) {
    const res = await enrollApplication(execCtx(tx, orgId, { now: e.at, quiet: true }), actor, e.id, { homeroomClassId: null, section: "A", linkStudentId: null, sendInvites: false });
    const reg = await db.govRegistration.findFirstOrThrow({ where: { orgId, studentId: res.studentId } });
    regIds.push(reg.id);
  }
  // One registration submitted to the authority and waiting for approval.
  if (regIds[0]) await db.govRegistration.update({ where: { id: regIds[0] }, data: { status: "SUBMITTED", submittedAt: at(-6, 11, 0, now), reference: "REG-2027-01842", updatedById: hanaId } });

  // --- Two students who joined this term ------------------------------------------------------------------
  const joiners = [
    { first: b("Yasmin", "ياسمين"), last: b("Al Jaber", "الجابر"), gender: "F" as const, nat: "SA", grade: 7, ago: 24, mother: b("Hessa", "حصة"), father: b("Turki", "تركي") },
    { first: b("Lucas", "لوكاس"), last: b("Moreau", "مورو"), gender: "M" as const, nat: "FR", grade: 10, ago: 12, mother: b("Claire", "كلير"), father: b("Antoine", "أنطوان") },
  ];
  for (const [i, j] of joiners.entries()) {
    const email = emailFor(j.mother.en, j.last.en, "family.example", taken);
    await db.user.createMany({ data: [{ email, nameEn: `${j.mother.en} ${j.last.en}`, nameAr: `${j.mother.ar} ${j.last.ar}`, passwordHash, emailVerified: at(-60, 9, 0, now) }], skipDuplicates: true });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const appId = id();
    const birth = new Date(Date.UTC(entryYearOf(current) - j.grade - 5, 3 + i * 4, 12));
    const submitted = at(-j.ago - 30, 10, 0, now);
    const enrolledAt = at(-j.ago, 9, 30, now);
    const eid = `784${birth.getUTCFullYear()}${String(4_200_000 + i * 31_337).slice(0, 7)}${i + 3}`;
    await db.admissionApplication.create({
      data: {
        id: appId,
        orgId,
        number: await nextApplicationNo(tx, orgId, entryYearOf(current)),
        applicantUserId: user.id,
        academicYearId: current.id,
        gradeLevel: j.grade,
        stage: "SEAT_PAID",
        stageChangedAt: at(-j.ago - 3, 10, 0, now),
        submittedAt: submitted,
        step: "student,schooling,family,health",
        firstNameEn: j.first.en,
        lastNameEn: j.last.en,
        firstNameAr: j.first.ar,
        lastNameAr: j.last.ar,
        dateOfBirth: birth,
        gender: j.gender,
        nationality: j.nat,
        homeLanguage: j.nat === "FR" ? "fr" : "ar",
        emiratesIdEnc: encryptField(eid),
        emiratesIdLast4: eid.slice(-4),
        emiratesIdHash: eidHash(eid),
        nameDobKey: nameDobKey(j.first.en, j.last.en, birth),
        schooling: { attended: true, schoolName: j.nat === "FR" ? "Lycée International de Lyon" : "Riyadh Schools", country: j.nat, curriculum: j.nat === "FR" ? "French" : "American", lastGrade: String(j.grade - 1), fromYear: null, toYear: null, leavingReason: "Family relocated to Dubai" } as Prisma.InputJsonValue,
        guardians: [
          { relationship: "MOTHER", firstNameEn: j.mother.en, lastNameEn: j.last.en, firstNameAr: j.mother.ar, lastNameAr: j.last.ar, email, phone: `+971 50 555 07${i}1`, occupation: "", employer: "", livesWith: true, primary: true },
          { relationship: "FATHER", firstNameEn: j.father.en, lastNameEn: j.last.en, firstNameAr: j.father.ar, lastNameAr: j.last.ar, email: email.replace("@", ".2@"), phone: `+971 50 555 07${i}2`, occupation: "", employer: "", livesWith: true, primary: false },
        ] as Prisma.InputJsonValue,
        siblings: [] as Prisma.InputJsonValue,
        consentAt: submitted,
        assessmentOutcome: "RECOMMENDED",
        offerSection: "B",
        offerMadeAt: at(-j.ago - 14, 10, 0, now),
        offerDeadline: at(-j.ago - 1, 23, 59, now),
        offerRespondedAt: at(-j.ago - 10, 18, 0, now),
        seatFeeFils: 350000,
        seatPaidAt: at(-j.ago - 3, 10, 0, now),
        seatPaymentRef: `RCPT-${entryYearOf(current)}-0${41 + i}`,
        createdAt: new Date(submitted.getTime() - DAY),
      },
    });
    for (const [k, s] of (["NEW", "ASSESSMENT_BOOKED", "ASSESSED", "OFFER_MADE", "OFFER_ACCEPTED", "SEAT_PAID"] as Stage[]).entries()) await db.admissionEvent.create({ data: { orgId, applicationId: appId, kind: "stage", fromStage: k === 0 ? "DRAFT" : null, toStage: s, actorMembershipId: k === 0 || s === "OFFER_ACCEPTED" ? null : hanaId, createdAt: new Date(submitted.getTime() + k * 4 * DAY) } });
    await db.admissionDocument.createMany({ data: sampleDocs(appId, j.grade, j.nat, submitted, true, true) });
    const homeroom = w.classes.find((c) => c.homeroom && c.grade === j.grade && c.section === "B");
    const res = await enrollApplication(execCtx(tx, orgId, { now: enrolledAt, quiet: true }), actor, appId, { homeroomClassId: homeroom?.id ?? null, section: "B", linkStudentId: null, sendInvites: false });
    const reg = await db.govRegistration.findFirstOrThrow({ where: { orgId, studentId: res.studentId } });
    await db.govRegistration.update({
      where: { id: reg.id },
      data: i === 0 ? { status: "APPROVED", submittedAt: at(-j.ago + 1, 11, 0, now), decidedAt: at(-j.ago + 6, 13, 0, now), reference: "REG-2026-07715", updatedById: hanaId } : { status: "SUBMITTED", submittedAt: at(-j.ago + 2, 11, 0, now), reference: "REG-2026-08102", updatedById: hanaId },
    });
  }

  // --- Re-enrollment for next year: open, two thirds answered ---------------------------------------------------
  const window = await db.reenrollmentWindow.create({ data: { orgId, academicYearId: next.id, opensAt: at(-10, 7, 0, now), closesAt: at(12, 23, 59, now), messageEn: "Please confirm whether each of your children will return to Horizon next year. Places for new families are offered from the seats you release.", messageAr: "يُرجى تأكيد عودة كل من أطفالكم إلى هورايزن في العام القادم، إذ تُعرض المقاعد المتاحة على الأسر الجديدة.", reminderDays: [7, 2], createdById: hanaId, createdAt: at(-14, 9, 0, now) } });
  const eligible = (await db.student.findMany({ where: { orgId, status: "ACTIVE", gradeLevel: { lt: 12 } }, select: { id: true, gradeLevel: true }, orderBy: [{ gradeLevel: "asc" }, { studentNo: "asc" }] })).filter((s) => s.id !== w.adam.id && s.id !== w.yara.id);
  const leaving = new Map<string, { reason: string; note: string | null }>();
  const reasons = ["relocation_abroad", "another_school", "relocation_abroad", "fees", "curriculum", "relocation_uae"];
  // A few leavers, including one Grade 9 student so Grade 10 is full next year.
  const g9 = eligible.filter((s) => s.gradeLevel === 9);
  if (g9[3]) leaving.set(g9[3].id, { reason: "relocation_abroad", note: "Father's company is moving the family to Toronto." });
  for (const s of r.shuffle(eligible.filter((x) => x.gradeLevel !== 9)).slice(0, 5)) leaving.set(s.id, { reason: reasons[leaving.size % reasons.length], note: null });
  const answered = eligible.filter((s, i) => leaving.has(s.id) || i % 3 !== 2);
  const guardianOf = new Map<string, string>();
  for (const g of w.guardians) for (const sid of g.studentIds) if (!guardianOf.has(sid)) guardianOf.set(sid, g.membershipId);
  const responses: Prisma.ReenrollmentResponseCreateManyInput[] = [];
  const withdrawals: Prisma.StudentWithdrawalCreateManyInput[] = [];
  for (const [i, s] of answered.entries()) {
    const leave = leaving.get(s.id);
    const respId = id();
    const wdId = leave ? id() : null;
    responses.push({ id: respId, orgId, windowId: window.id, studentId: s.id, intent: leave ? "LEAVING" : "RETURNING", reasonKey: leave?.reason ?? null, reasonNote: leave?.note ?? null, respondedById: guardianOf.get(s.id) ?? hanaId, respondedAt: at(-9 + (i % 9), 18 + (i % 4), (i * 13) % 60, now), withdrawalId: wdId });
    if (leave && wdId) withdrawals.push({ id: wdId, orgId, studentId: s.id, leavingDate: current.endsOn, reasonKey: leave.reason, reasonNote: leave.note, source: "REENROLLMENT", status: "PLANNED", createdById: guardianOf.get(s.id) ?? hanaId, createdAt: at(-9 + (i % 9), 18, 0, now) });
  }
  await db.reenrollmentResponse.createMany({ data: responses });
  await db.studentWithdrawal.createMany({ data: withdrawals });
  // The opening notice went to every family; the 7-day reminder round has not been reached yet.
  await db.jobRun.createMany({ data: [...new Set(w.guardians.map((g) => g.membershipId))].map((m) => ({ orgId, queue: "admissions", name: "reenrollment.open", idempotencyKey: `reenrol:${window.id}:open:${m}`, status: "COMPLETED" as const, finishedAt: at(-10, 7, 5, now), createdAt: at(-10, 7, 5, now) })), skipDuplicates: true });
  await db.notification.createMany({
    data: [...new Set(w.guardians.map((g) => g.membershipId))].map((m) => ({ orgId, recipientId: m, kind: "reenrollment_open", titleEn: "Please confirm next year's place for your child", titleAr: "يُرجى تأكيد مقعد طفلك للعام القادم", bodyEn: `Re-enrollment for ${next.nameEn} is open. Tell us whether each child is returning.`, bodyAr: `إعادة التسجيل للعام ${next.nameAr} مفتوحة. أخبرونا هل سيعود كل طفل.`, href: "/reenrollment", createdAt: at(-10, 7, 5, now) })),
  });

  // --- Leavers earlier this year (former students with transfer certificates) -------------------------------------
  const tcTemplate = await db.documentTemplate.findUniqueOrThrow({ where: { orgId_key: { orgId, key: TC_TEMPLATE_KEY } } });
  const lettersCat = w.categories.get("official_letters") ?? null;
  const former = [
    { first: b("Omar", "عمر"), last: b("Siddiqui", "صديقي"), grade: 8, reason: "relocation_abroad", dest: "Toronto, Canada", ago: 40, approved: true },
    { first: b("Leen", "لين"), last: b("Awad", "عوض"), grade: 11, reason: "another_school", dest: "A school in Abu Dhabi", ago: 9, approved: false },
  ];
  for (const [i, f] of former.entries()) {
    const sid = id();
    await db.student.create({ data: { id: sid, orgId, studentNo: `HIS-${23900 + i}`, firstNameEn: f.first.en, lastNameEn: f.last.en, firstNameAr: f.first.ar, lastNameAr: f.last.ar, gradeLevel: f.grade, section: "A", dateOfBirth: new Date(Date.UTC(entryYearOf(current) - f.grade - 5, 2 + i, 8)), gender: i === 0 ? "M" : "F", nationalityEn: i === 0 ? "Pakistan" : "Jordan", nationalityAr: i === 0 ? "باكستان" : "الأردن", status: "WITHDRAWN", enrolledOn: new Date(Date.UTC(entryYearOf(current) - 3, 7, 25)), curriculum: "AMERICAN" } });
    const wdId = id();
    const tcYear = new Date(dateOnly(-f.ago, now).getTime() + 4 * 3600_000).getUTCFullYear();
    const tcNumber = `TC-${tcYear}-${String(await nextSequence(tx, orgId, `TC-${tcYear}`)).padStart(4, "0")}`;
    const wd = await db.studentWithdrawal.create({ data: { id: wdId, orgId, studentId: sid, leavingDate: dateOnly(-f.ago, now), reasonKey: f.reason, destination: f.dest, status: "COMPLETED", source: "STAFF", tcNumber, tcIssuedAt: at(-f.ago, 11, 0, now), createdById: hanaId, completedById: registrar ?? hanaId, completedAt: at(-f.ago, 11, 0, now), createdAt: at(-f.ago - 12, 10, 0, now) } });
    const doc = await db.document.create({ data: { orgId, categoryId: lettersCat, titleEn: tcTemplate.nameEn, titleAr: tcTemplate.nameAr, studentId: sid, sensitivity: "STANDARD", source: "GENERATED", templateId: tcTemplate.id, uploadedById: registrar ?? hanaId, visibleToFamily: true, createdAt: at(-f.ago, 11, 0, now) } });
    const v = await db.documentVersion.create({ data: { orgId, documentId: doc.id, version: 1, storageKey: `render:${TC_TEMPLATE_KEY}`, fileName: `${tcNumber}.pdf`, mimeType: "application/pdf", sizeBytes: 0, renderData: (await tcMergeData(tx, orgId, wd)) as never, output: "BILINGUAL", createdById: registrar ?? hanaId, createdAt: at(-f.ago, 11, 0, now) } });
    await db.document.update({ where: { id: doc.id }, data: { currentVersionId: v.id } });
    await db.studentWithdrawal.update({ where: { id: wdId }, data: { tcDocumentId: doc.id } });
    await db.govRegistration.create({ data: { orgId, studentId: sid, kind: "WITHDRAWAL", authority: "KHDA", withdrawalId: wdId, status: f.approved ? "APPROVED" : "NOT_SUBMITTED", reference: f.approved ? "REG-2026-05530" : null, submittedAt: f.approved ? at(-f.ago + 1, 10, 0, now) : null, decidedAt: f.approved ? at(-f.ago + 4, 10, 0, now) : null, createdAt: at(-f.ago, 11, 0, now) } });
  }
  // A leaver staff recorded directly (planned for the end of the month).
  const planned = eligible.find((s) => s.gradeLevel === 8 && !leaving.has(s.id));
  if (planned) await db.studentWithdrawal.create({ data: { orgId, studentId: planned.id, leavingDate: dateOnly(18, now), reasonKey: "relocation_uae", reasonNote: "Moving to Ras Al Khaimah; family asked for the transfer certificate before the last day.", destination: "A school in Ras Al Khaimah", status: "PLANNED", source: "STAFF", createdById: hanaId, createdAt: at(-3, 12, 0, now) } });

  log(`admissions: ${appRows.length} applications, ${toEnroll.length + joiners.length} enrolled, ${responses.length} re-enrollment answers`);
}
