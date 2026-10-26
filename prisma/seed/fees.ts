// Demo fees: the fee schedule (KG1 to Grade 12), instalment plans, discounts, family accounts, a term of invoices for
// every family through real billing runs, and months of payments: on time, late, partial and unpaid, cheques
// (one post-dated and held, one returned), an early payment discount, credit notes, refunds (one paid, one waiting
// for the principal), a sponsor-paid family, a mid-term joiner billed pro rata and an applicant's seat booking.
// Everything goes through the same services the app uses. Dates follow the academic year, never past "now".
import bcrypt from "bcryptjs";
import type { FeePaymentMethod, FeeItemKind, VatTreatment } from "@prisma/client";
import { execCtx, type Tx } from "@/server/db";
import type { Actor } from "@/server/fees/ledger";
import { accountBalance, bouncePayment, clearCheque, decideRefund, earlyPaymentOffer, issueCreditNote, issueInvoice, markRefundPaid, recordPayment, requestRefund, balanceOf } from "@/server/fees/ledger";
import { billAccount, createBillingRun, partWithShare, previewAccountBill, processBillingBatch } from "@/server/fees/billing";
import { decideAward, requestAward, saveDiscount, saveFeeItem, savePlan, suggestParts, DEFAULT_BEHAVIOUR } from "@/server/fees/schedule";
import { syncFamilyAccounts } from "@/server/fees/accounts";
import { ensureFeeTemplates, sendDueFeeReminders } from "@/server/fees/notices";
import { createSeatBookingCharge } from "@/server/fees/seat-booking";
import { at, rng, stableId } from "./lib";
import type { SeedWorld } from "./demo";

const DAY = 86_400_000;
const bi = (en: string, ar: string) => ({ en, ar });

/** Tuition per year in AED (the demo school's own schedule; KG1 to Grade 12). */
const TUITION: Array<[number, number, string, string]> = [
  [-1, 16_500, "KG1", "الروضة الأولى"],
  [0, 17_000, "KG2", "الروضة الثانية"],
  [1, 18_500, "Grade 1", "الصف 1"],
  [2, 18_500, "Grade 2", "الصف 2"],
  [3, 19_500, "Grade 3", "الصف 3"],
  [4, 19_500, "Grade 4", "الصف 4"],
  [5, 20_500, "Grade 5", "الصف 5"],
  [6, 21_500, "Grade 6", "الصف 6"],
  [7, 22_500, "Grade 7", "الصف 7"],
  [8, 23_500, "Grade 8", "الصف 8"],
  [9, 25_000, "Grade 9", "الصف 9"],
  [10, 26_500, "Grade 10", "الصف 10"],
  [11, 28_000, "Grade 11", "الصف 11"],
  [12, 29_500, "Grade 12", "الصف 12"],
];

type ItemSeed = { code: string; kind: FeeItemKind; name: { en: string; ar: string }; aed: number; grades?: number[]; zone?: string; vat?: VatTreatment };
const OTHER_ITEMS: ItemSeed[] = [
  { code: "REG", kind: "REGISTRATION", name: bi("Registration fee", "رسوم التسجيل"), aed: 500 },
  { code: "REENROL", kind: "REENROLLMENT", name: bi("Re-enrollment fee", "رسوم إعادة التسجيل"), aed: 1_000 },
  { code: "SEAT", kind: "SEAT_DEPOSIT", name: bi("Seat booking deposit", "عربون حجز المقعد"), aed: 3_000 },
  { code: "BUS-A", kind: "TRANSPORT", name: bi("School bus, zone A (Al Barsha, Al Sufouh)", "الحافلة المدرسية، المنطقة أ (البرشاء، الصفوح)"), aed: 6_500, zone: "A" },
  { code: "BUS-B", kind: "TRANSPORT", name: bi("School bus, zone B (Al Quoz, Umm Suqeim, JVC)", "الحافلة المدرسية، المنطقة ب (القوز، أم سقيم، قرية جميرا الدائرية)"), aed: 7_500, zone: "B" },
  { code: "BUS-C", kind: "TRANSPORT", name: bi("School bus, zone C (Dubai Marina, JLT, Arabian Ranches)", "الحافلة المدرسية، المنطقة ج (دبي مارينا، أبراج بحيرات جميرا، المرابع العربية)"), aed: 8_500, zone: "C" },
  { code: "UNIFORM", kind: "UNIFORM", name: bi("Uniform set", "طقم الزي المدرسي"), aed: 450 },
  { code: "BOOKS-KG", kind: "BOOKS", name: bi("Books and materials, KG", "الكتب والمواد، الروضة"), aed: 650, grades: [-1, 0] },
  { code: "BOOKS-PS", kind: "BOOKS", name: bi("Books and materials, Grades 1 to 5", "الكتب والمواد، الصفوف 1 إلى 5"), aed: 850, grades: [1, 2, 3, 4, 5] },
  { code: "BOOKS-MS", kind: "BOOKS", name: bi("Books and materials, Grades 6 to 8", "الكتب والمواد، الصفوف 6 إلى 8"), aed: 950, grades: [6, 7, 8] },
  { code: "BOOKS-HS", kind: "BOOKS", name: bi("Books and materials, Grades 9 to 12", "الكتب والمواد، الصفوف 9 إلى 12"), aed: 1_200, grades: [9, 10, 11, 12] },
  { code: "TRIP-G9", kind: "TRIP", name: bi("Grade 9 geography field trip", "رحلة الجغرافيا الميدانية للصف 9"), aed: 180, grades: [9] },
  { code: "AP-EXAM", kind: "EXAM", name: bi("AP exam registration (per exam)", "تسجيل اختبار AP (لكل اختبار)"), aed: 650, grades: [10, 11, 12] },
  { code: "ACT-ECA", kind: "OTHER", name: bi("After-school activity (per term)", "نشاط بعد اليوم الدراسي (لكل فصل)"), aed: 750 },
];

async function ensureFinancePersona(w: SeedWorld) {
  const { db, orgId, now } = w;
  const email = "farah.qasim@horizon.example";
  const passwordHash = await bcrypt.hash("Horizon2026!", 8);
  const user = await db.user.upsert({ where: { email }, create: { email, nameEn: "Farah Qasim", nameAr: "فرح قاسم", passwordHash }, update: { nameEn: "Farah Qasim", nameAr: "فرح قاسم", passwordHash, lastActiveOrgId: orgId, locale: null } });
  const role = await db.role.findFirstOrThrow({ where: { orgId, key: "finance_officer" } });
  const mid = stableId("membership", orgId, email);
  await db.membership.create({ data: { id: mid, orgId, userId: user.id, status: "ACTIVE", titleEn: "Finance Officer", titleAr: "مسؤولة الشؤون المالية", createdAt: at(-400, 8, 0, now) } });
  await db.membershipRole.create({ data: { orgId, membershipId: mid, roleId: role.id } });
  const dept = await db.department.findFirst({ where: { orgId, key: "administration" }, select: { id: true } });
  await db.staffProfile.create({ data: { orgId, membershipId: mid, departmentId: dept?.id ?? null, employeeNo: "HIS-1990", jobTitleEn: "Finance Officer", jobTitleAr: "مسؤولة الشؤون المالية", phone: "+971 50 555 0290", officeEn: "Accounts office, Block A", officeAr: "قسم الحسابات، المبنى A", gradeLevels: [] } });
  const order = (await db.demoPersona.count({ where: { orgId } })) + 1;
  await db.demoPersona.create({ data: { orgId, key: "finance", membershipId: mid, roleLabelEn: "Finance Officer", roleLabelAr: "مسؤولة الشؤون المالية", blurbEn: "Bills families, records payments and runs fee reports.", blurbAr: "تصدر فواتير الأسر وتسجّل المدفوعات وتستخرج تقارير الرسوم.", homePath: "/home", order } });
  return mid;
}

export async function seedFees(w: SeedWorld) {
  const { db, orgId, now } = w;
  const tx = db as unknown as Tx;
  const r = rng(20261026);
  const started = Date.now();
  const financeMid = await ensureFinancePersona(w);
  const fo: Actor = { membershipId: financeMid, userId: null };
  const pr: Actor = { membershipId: w.personas.principal ?? null, userId: null };
  const clamp = (d: Date) => (d.getTime() > now.getTime() - 3_600_000 ? null : d);
  const aed = (n: number) => Math.round(n * 100);

  // --- Settings: legal identity for tax invoices (fictional TRN), rules, reminders. Finance hold stays off. -------
  await db.financeSettings.create({
    data: {
      orgId,
      legalNameEn: "Horizon International School LLC",
      legalNameAr: "مدرسة هورايزن الدولية ذ.م.م",
      addressEn: "Al Barsha South, PO Box 0000, Dubai, United Arab Emirates",
      addressAr: "البرشاء جنوب، ص.ب 0000، دبي، الإمارات العربية المتحدة",
      trn: "100234567800003",
      vatRegistered: true,
      earlyPaymentBp: 200,
      earlyPaymentDays: 7,
      onlinePayments: true,
      bankDetailsEn: "Bank transfer: Horizon International School LLC\nIBAN AE00 0000 0000 0000 0000 000 (demo)\nQuote the invoice number as the reference.",
      bankDetailsAr: "التحويل البنكي: مدرسة هورايزن الدولية ذ.م.م\nرقم الآيبان AE00 0000 0000 0000 0000 000 (تجريبي)\nيرجى ذكر رقم الفاتورة كمرجع.",
    },
  });
  await ensureFeeTemplates(tx, orgId);

  // --- Fee schedule ----------------------------------------------------------------------------
  const year = await db.academicYear.findFirstOrThrow({ where: { orgId, isCurrent: true }, include: { terms: true } });
  for (const [g, amount, en, ar] of TUITION) {
    const code = g === -1 ? "T-KG1" : g === 0 ? "T-KG2" : `T-G${g}`;
    await saveFeeItem(tx, orgId, { academicYearId: year.id, code, kind: "TUITION", nameEn: `Tuition, ${en}`, nameAr: `الرسوم الدراسية، ${ar}`, amountFils: aed(amount), gradeLevels: [g], zone: null, ...DEFAULT_BEHAVIOUR.TUITION, vatTreatment: "ZERO_RATED", active: true }, fo);
  }
  const VAT: Record<FeeItemKind, VatTreatment> = { TUITION: "ZERO_RATED", REGISTRATION: "ZERO_RATED", REENROLLMENT: "ZERO_RATED", SEAT_DEPOSIT: "ZERO_RATED", BOOKS: "ZERO_RATED", TRANSPORT: "STANDARD", UNIFORM: "STANDARD", TRIP: "STANDARD", EXAM: "STANDARD", OTHER: "STANDARD" };
  for (const it of OTHER_ITEMS) {
    await saveFeeItem(tx, orgId, { academicYearId: year.id, code: it.code, kind: it.kind, nameEn: it.name.en, nameAr: it.name.ar, amountFils: aed(it.aed), gradeLevels: it.grades ?? [], zone: it.zone ?? null, ...DEFAULT_BEHAVIOUR[it.kind], vatTreatment: it.vat ?? VAT[it.kind], active: true }, fo);
  }
  const items = await db.feeItem.findMany({ where: { orgId, academicYearId: year.id } });
  const item = (code: string) => items.find((i) => i.code === code)!;

  // --- Instalment plans --------------------------------------------------------------------------
  const termly = suggestParts("TERMLY", year, year.terms);
  await savePlan(tx, orgId, { academicYearId: year.id, key: "termly", nameEn: "Termly (40%, 30%, 30%)", nameAr: "فصلية (40% و30% و30%)", kind: "TERMLY", isDefault: true, active: true, parts: termly }, fo);
  await savePlan(tx, orgId, { academicYearId: year.id, key: "monthly", nameEn: "Monthly (10 instalments)", nameAr: "شهرية (10 أقساط)", kind: "MONTHLY", isDefault: false, active: true, parts: suggestParts("MONTHLY", year, year.terms) }, fo);
  await savePlan(tx, orgId, { academicYearId: year.id, key: "annual", nameEn: "Annual (one payment)", nameAr: "سنوية (دفعة واحدة)", kind: "ANNUAL", isDefault: false, active: true, parts: suggestParts("ANNUAL", year, year.terms) }, fo);
  const plans = await db.instalmentPlan.findMany({ where: { orgId, academicYearId: year.id }, include: { parts: { orderBy: { seq: "asc" } } } });
  const plan = (key: string) => plans.find((p) => p.key === key)!;

  // --- Discounts -------------------------------------------------------------------------------
  await saveDiscount(tx, orgId, { code: "STAFF50", kind: "STAFF_CHILD", nameEn: "Staff child discount 50%", nameAr: "خصم أبناء الموظفين 50%", method: "PERCENT", percentBp: 5000, amountFils: null, requiresApproval: false, active: true }, fo);
  await saveDiscount(tx, orgId, { code: "SCHOL25", kind: "SCHOLARSHIP", nameEn: "Academic excellence scholarship 25%", nameAr: "منحة التفوق الأكاديمي 25%", method: "PERCENT", percentBp: 2500, amountFils: null, requiresApproval: true, active: true }, fo);
  await saveDiscount(tx, orgId, { code: "BURSARY6K", kind: "BURSARY", nameEn: "Financial assistance bursary (AED 6,000 a year)", nameAr: "إعانة مالية (6,000 درهم سنويًا)", method: "FIXED", percentBp: null, amountFils: aed(6_000), requiresApproval: true, active: true }, fo);
  await saveDiscount(tx, orgId, { code: "SPORT15", kind: "OTHER", nameEn: "Sports scholarship 15%", nameAr: "منحة رياضية 15%", method: "PERCENT", percentBp: 1500, amountFils: null, requiresApproval: true, active: true }, fo);
  const discounts = await db.feeDiscount.findMany({ where: { orgId } });
  const disc = (code: string) => discounts.find((d) => d.code === code)!;

  // --- Family accounts ---------------------------------------------------------------------------
  await syncFamilyAccounts(tx, orgId, fo);
  const accounts = await db.feeAccount.findMany({ where: { orgId }, include: { students: true }, orderBy: { code: "asc" } });
  const students = await db.student.findMany({ where: { orgId }, select: { id: true, gradeLevel: true, lastNameEn: true, firstNameEn: true } });
  const nasser = accounts.find((a) => a.students.some((s) => s.studentId === w.adam.id))!;
  await db.feeAccount.update({ where: { id: nasser.id }, data: { payerGuardianId: (await db.guardian.findFirst({ where: { orgId, membershipId: w.rania.membershipId } }))?.id ?? nasser.payerGuardianId } });
  // Transport zones for about a third of the children (both Nasser children ride the zone B bus).
  for (const a of accounts) {
    for (const s of a.students) {
      const zone = a.id === nasser.id ? "B" : r.chance(0.33) ? r.pick(["A", "B", "C"]) : null;
      if (zone) await db.studentFeeProfile.update({ where: { studentId: s.studentId }, data: { transportZone: zone } });
    }
  }
  const others = r.shuffle(accounts.filter((a) => a.id !== nasser.id));
  const monthly = others.slice(0, 8);
  const annual = others.slice(8, 14);
  for (const a of monthly) await db.feeAccount.update({ where: { id: a.id }, data: { planKey: "monthly" } });
  for (const a of annual) await db.feeAccount.update({ where: { id: a.id }, data: { planKey: "annual" } });
  // A family whose father's employer pays the fees (fictional company).
  const sponsored = others.find((a, i) => i >= 14 && a.students.length === 1)!;
  await db.feeAccount.update({ where: { id: sponsored.id }, data: { payerType: "SPONSOR", sponsorName: "Sandstone Ridge Engineering LLC", sponsorTrn: "100398765400003", billingAddress: "Office 1204, Business Bay, Dubai, United Arab Emirates", billingEmail: "accounts@sandstone-ridge.example" } });
  // A child who joined mid-term: held back from the August run and billed pro rata when they joined.
  const joinerAcc = others.find((a, i) => i >= 16 && a.students.length === 1 && a.id !== sponsored.id)!;
  const joinerId = joinerAcc.students[0].studentId;
  const p1 = plan("termly").parts[0];
  const joinedOn = new Date(Math.min(now.getTime() - 9 * DAY, p1.periodStart.getTime() + 40 * DAY));
  const joinerBillable = joinedOn.getTime() > p1.periodStart.getTime();
  if (joinerBillable) {
    await db.student.update({ where: { id: joinerId }, data: { enrolledOn: joinedOn } });
    await db.feeAccount.update({ where: { id: joinerAcc.id }, data: { planKey: "joining" } });
  }

  // --- Awards (before billing so discounts apply) ----------------------------------------------------
  const pickStudent = (pred: (s: (typeof students)[number]) => boolean, avoid: string[]) => students.find((s) => pred(s) && !avoid.includes(s.id) && accounts.some((a) => a.students.some((x) => x.studentId === s.id)));
  const used = [w.adam.id, w.yara.id, joinerId];
  const staffChild = pickStudent((s) => s.gradeLevel === 7, used)!;
  used.push(staffChild.id);
  const scholar = pickStudent((s) => s.gradeLevel === 11, used)!;
  used.push(scholar.id);
  const bursar = pickStudent((s) => s.gradeLevel === 8, used)!;
  used.push(bursar.id);
  const pendingBursar = pickStudent((s) => s.gradeLevel === 10, used)!;
  used.push(pendingBursar.id);
  const awardAt = new Date(year.startsOn.getTime() - 40 * DAY);
  await requestAward(tx, orgId, { studentId: staffChild.id, discountId: disc("STAFF50").id, academicYearId: year.id, reason: "Parent is a member of teaching staff." }, fo);
  const sch = await requestAward(tx, orgId, { studentId: scholar.id, discountId: disc("SCHOL25").id, academicYearId: year.id, reason: "Top 2% in Grade 10 final results; renewed annually on results." }, fo);
  await decideAward(tx, orgId, sch.id, true, "Approved by the scholarship committee.", awardAt, pr);
  const bur = await requestAward(tx, orgId, { studentId: bursar.id, discountId: disc("BURSARY6K").id, academicYearId: year.id, reason: "Change in family circumstances; documents seen by the finance office." }, fo);
  await decideAward(tx, orgId, bur.id, true, "Approved for this academic year.", awardAt, pr);

  // --- Charges waiting for the first invoice: books for everyone, uniforms for about half ---------------------
  const studentMap = new Map(students.map((s) => [s.id, s]));
  for (const a of accounts) {
    for (const s of a.students) {
      const st = studentMap.get(s.studentId);
      if (!st) continue;
      const books = items.find((i) => i.kind === "BOOKS" && i.gradeLevels.includes(st.gradeLevel));
      if (books) await db.feeCharge.create({ data: { orgId, accountId: a.id, studentId: st.id, feeItemId: books.id, unitFils: books.amountFils, createdById: financeMid, createdAt: new Date(year.startsOn.getTime() - 30 * DAY) } });
      if (r.chance(0.5) || a.id === nasser.id) await db.feeCharge.create({ data: { orgId, accountId: a.id, studentId: st.id, feeItemId: item("UNIFORM").id, quantity: a.id === nasser.id ? 1 : r.int(1, 2), unitFils: item("UNIFORM").amountFils, createdById: financeMid, createdAt: new Date(year.startsOn.getTime() - 30 * DAY) } });
    }
  }

  // --- Re-enrollment invoices in spring (the fee for this year, billed before the summer) ---------------------
  const reIssue = new Date(year.startsOn.getTime() - 98 * DAY);
  const reInvoices: Array<{ id: string; accountId: string; dueDate: Date; total: number }> = [];
  for (const a of accounts) {
    if (a.id === joinerAcc.id) continue;
    const kids = a.students.map((s) => studentMap.get(s.studentId)).filter((s): s is NonNullable<typeof s> => Boolean(s) && s!.gradeLevel >= 7);
    if (!kids.length) continue;
    const inv = await issueInvoice(
      tx,
      orgId,
      {
        kind: "TAX",
        accountId: a.id,
        academicYearId: year.id,
        issueDate: reIssue,
        dueDate: new Date(reIssue.getTime() + 21 * DAY),
        lines: kids.map((k) => ({ studentId: k.id, feeItemId: item("REENROL").id, kind: "REENROLLMENT" as const, descriptionEn: `Re-enrollment fee ${year.nameEn}: ${k.firstNameEn} ${k.lastNameEn}`, descriptionAr: `رسوم إعادة التسجيل ${year.nameAr}`, quantity: 1, unitFils: item("REENROL").amountFils, vatTreatment: "ZERO_RATED" as const })),
      },
      fo,
    );
    reInvoices.push({ id: inv.id, accountId: a.id, dueDate: inv.dueDate, total: inv.totalFils });
  }
  w.log(`fees: schedule, plans, accounts and re-enrollment invoices in ${Date.now() - started}ms`);

  // --- Payment plan for the story (executed in date order so receipt numbers follow dates) ---------------------
  type Pay = { at: Date; accountId: string; amount: number | "balance" | "half"; invoiceId?: string; method: FeePaymentMethod; cheque?: { no: string; bank: string; date: Date }; early?: boolean };
  const pays: Pay[] = [];
  const BANKS = ["Emirates NBD", "Abu Dhabi Commercial Bank", "Mashreq", "Dubai Islamic Bank", "First Abu Dhabi Bank", "RAKBANK"];
  const plannedMethod = (): FeePaymentMethod => (r.chance(0.7) ? "BANK_TRANSFER" : r.chance(0.5) ? "CARD" : "CASH");
  for (const inv of reInvoices) {
    const roll = r.next();
    if (roll < 0.06) continue; // unpaid since spring: over 90 days
    const when = new Date(inv.dueDate.getTime() - r.int(-12, 15) * DAY);
    pays.push({ at: when, accountId: inv.accountId, amount: "balance", invoiceId: inv.id, method: plannedMethod() });
  }
  await runPays(pays.splice(0), now);

  // --- Billing runs: Term 1 (termly), the full year (annual), and each monthly instalment already due -----------
  type RunInfo = { partId: string; issue: Date; due: Date };
  const runs: RunInfo[] = [];
  const termlyParts = plan("termly").parts;
  for (const p of termlyParts) {
    const issue = new Date(p.dueDate.getTime() - 14 * DAY);
    if (issue.getTime() <= now.getTime()) runs.push({ partId: p.id, issue, due: p.dueDate });
  }
  const ann = plan("annual").parts[0];
  runs.push({ partId: ann.id, issue: new Date(ann.dueDate.getTime() - 14 * DAY), due: ann.dueDate });
  for (const p of plan("monthly").parts) {
    const issue = new Date(p.dueDate.getTime() - 14 * DAY);
    if (issue.getTime() <= now.getTime()) runs.push({ partId: p.id, issue, due: p.dueDate });
  }
  runs.sort((a, b) => a.issue.getTime() - b.issue.getTime());
  for (const run of runs) {
    if (run.issue.getTime() > now.getTime()) continue;
    const { run: br } = await createBillingRun(tx, orgId, { partId: run.partId, issueDate: run.issue, dueDate: run.due, includeCharges: true }, fo);
    const ec = execCtx(tx, orgId, { now: run.issue, quiet: true });
    for (let i = 0; i < 100; i++) if ((await processBillingBatch(ec, br.id, { batchSize: 25 })).done) break;
    // Runs started by the finance office mid-morning Dubai time (issue dates are midnight UTC).
    const startedAt = new Date(run.issue.getTime() + (5 * 60 + 12) * 60_000);
    await db.billingRun.update({ where: { id: br.id }, data: { createdAt: startedAt, startedAt, finishedAt: new Date(startedAt.getTime() + 4 * 60_000) } });
  }

  // The joiner: billed pro rata for Term 1 on the day they joined.
  if (joinerBillable) {
    await db.feeAccount.update({ where: { id: joinerAcc.id }, data: { planKey: null } });
    const { part } = await partWithShare(tx, orgId, p1.id);
    await billAccount(tx, orgId, { accountId: joinerAcc.id, part, issueDate: joinedOn, dueDate: new Date(joinedOn.getTime() + 14 * DAY), includeCharges: true, academicYearId: year.id }, fo);
  }
  // Grade 9 field trip invoiced in October for every Grade 9 family (still open), AP exam fees for a few seniors.
  const tripIssue = clamp(new Date(now.getTime() - 6 * DAY));
  if (tripIssue) {
    for (const a of accounts) {
      const g9 = a.students.map((s) => studentMap.get(s.studentId)).filter((s): s is NonNullable<typeof s> => Boolean(s) && s!.gradeLevel === 9);
      if (!g9.length) continue;
      await issueInvoice(
        tx,
        orgId,
        {
          kind: "TAX",
          accountId: a.id,
          academicYearId: year.id,
          issueDate: tripIssue,
          dueDate: new Date(tripIssue.getTime() + 14 * DAY),
          lines: g9.map((k) => ({ studentId: k.id, feeItemId: item("TRIP-G9").id, kind: "TRIP" as const, descriptionEn: `${item("TRIP-G9").nameEn}: ${k.firstNameEn} ${k.lastNameEn}`, descriptionAr: item("TRIP-G9").nameAr, quantity: 1, unitFils: item("TRIP-G9").amountFils, vatTreatment: "STANDARD" as const })),
          applyCredit: false,
        },
        fo,
      );
    }
  }
  const apIssue = clamp(new Date(now.getTime() - 20 * DAY));
  if (apIssue) {
    const seniors = students.filter((s) => s.gradeLevel >= 11 && accounts.some((a) => a.students.some((x) => x.studentId === s.id))).slice(0, 5);
    for (const s of seniors) {
      const a = accounts.find((x) => x.students.some((y) => y.studentId === s.id))!;
      const exams = r.int(1, 3);
      const charge = await db.feeCharge.create({ data: { orgId, accountId: a.id, studentId: s.id, feeItemId: item("AP-EXAM").id, quantity: exams, unitFils: item("AP-EXAM").amountFils, descriptionEn: "AP exam registration (May session)", descriptionAr: "تسجيل اختبارات AP (دورة مايو)", createdById: financeMid } });
      const inv = await issueInvoice(
        tx,
        orgId,
        {
          kind: "TAX",
          accountId: a.id,
          academicYearId: year.id,
          issueDate: apIssue,
          dueDate: new Date(apIssue.getTime() + 14 * DAY),
          lines: [{ studentId: s.id, feeItemId: item("AP-EXAM").id, kind: "EXAM", descriptionEn: `AP exam registration (May session): ${s.firstNameEn} ${s.lastNameEn}`, descriptionAr: "تسجيل اختبارات AP (دورة مايو)", quantity: exams, unitFils: item("AP-EXAM").amountFils, vatTreatment: "STANDARD" }],
          chargeIds: [charge.id],
          applyCredit: false,
        },
        fo,
      );
      if (r.chance(0.6)) pays.push({ at: new Date(apIssue.getTime() + r.int(2, 12) * DAY), accountId: a.id, amount: "balance", invoiceId: inv.id, method: "CARD" });
    }
  }
  w.log(`fees: billing runs done in ${Date.now() - started}ms`);

  // --- Payments on instalment invoices: a realistic mix ------------------------------------------------------
  const instInvoices = await db.invoice.findMany({ where: { orgId, kind: "TAX", planPartId: { not: null } }, orderBy: { issueDate: "asc" } });
  // Families with their own story below (returned cheque, a September post-dated cheque) skip the general mix.
  const storyAccs = others.slice(36).filter((a) => a.id !== sponsored.id && a.id !== joinerAcc.id);
  const bounceAcc = storyAccs[0];
  const clearedAcc = storyAccs[7];
  const specials = new Set([nasser.id, sponsored.id, bounceAcc?.id, clearedAcc?.id].filter((x): x is string => Boolean(x)));
  const late = new Set(others.slice(20, 26).map((a) => a.id));
  const neverPaid = new Set(others.slice(26, 31).map((a) => a.id));
  const partial = new Set(others.slice(31, 36).map((a) => a.id));
  for (const inv of instInvoices) {
    if (specials.has(inv.accountId) || inv.accountId === joinerAcc.id) continue;
    if (neverPaid.has(inv.accountId)) continue;
    const isAnnual = annual.some((a) => a.id === inv.accountId);
    if (isAnnual) {
      // Annual payers pay early and take the early payment discount.
      pays.push({ at: new Date(inv.dueDate.getTime() - r.int(9, 20) * DAY), accountId: inv.accountId, amount: "balance", invoiceId: inv.id, method: "BANK_TRANSFER", early: true });
      continue;
    }
    if (partial.has(inv.accountId)) {
      pays.push({ at: new Date(inv.dueDate.getTime() + r.int(0, 12) * DAY), accountId: inv.accountId, amount: "half", invoiceId: inv.id, method: "BANK_TRANSFER" });
      continue;
    }
    if (late.has(inv.accountId)) {
      pays.push({ at: new Date(inv.dueDate.getTime() + r.int(8, 35) * DAY), accountId: inv.accountId, amount: "balance", invoiceId: inv.id, method: plannedMethod() });
      continue;
    }
    if (r.chance(0.1)) {
      pays.push({ at: new Date(inv.dueDate.getTime() - 3 * DAY), accountId: inv.accountId, amount: "balance", invoiceId: inv.id, method: "CHEQUE", cheque: { no: String(r.int(100000, 999999)), bank: r.pick(BANKS), date: new Date(inv.dueDate.getTime() - 3 * DAY) } });
      continue;
    }
    pays.push({ at: new Date(inv.dueDate.getTime() - r.int(-6, 10) * DAY), accountId: inv.accountId, amount: "balance", invoiceId: inv.id, method: plannedMethod() });
  }
  // Nasser family: Term 1 in two transfers, the second by card.
  const nasserT1 = instInvoices.find((i) => i.accountId === nasser.id);
  if (nasserT1) {
    pays.push({ at: new Date(nasserT1.dueDate.getTime() - 6 * DAY), accountId: nasser.id, amount: aed(15_000), invoiceId: nasserT1.id, method: "BANK_TRANSFER" });
    pays.push({ at: new Date(nasserT1.dueDate.getTime() + 12 * DAY), accountId: nasser.id, amount: "balance", invoiceId: nasserT1.id, method: "CARD" });
  }
  // The sponsor pays by bank transfer, a little late, as companies do.
  for (const inv of instInvoices.filter((i) => i.accountId === sponsored.id)) pays.push({ at: new Date(inv.dueDate.getTime() + 19 * DAY), accountId: sponsored.id, amount: "balance", invoiceId: inv.id, method: "BANK_TRANSFER" });
  await runPays(pays.splice(0), now);

  // --- Cheques: one returned and paid again by transfer; post-dated cheques for Term 2 held. --------------------
  const termOne = instInvoices.filter((i) => i.planPartId === termlyParts[0].id);
  const bounceFam = termOne.find((i) => i.accountId === bounceAcc?.id);
  if (bounceFam) {
    const chqAt = clamp(new Date(bounceFam.dueDate.getTime() - 2 * DAY));
    const fresh = await db.invoice.findUniqueOrThrow({ where: { id: bounceFam.id } });
    if (chqAt && balanceOf(fresh) > 0) {
      const res = await recordPayment(tx, orgId, { accountId: fresh.accountId, method: "CHEQUE", amountFils: balanceOf(fresh), receivedAt: chqAt, chequeNumber: "004417", chequeBank: "Mashreq", chequeDate: chqAt, idempotencyKey: "seed:bounce:1", invoiceIds: [fresh.id] }, fo);
      const bounceAt = clamp(new Date(chqAt.getTime() + 6 * DAY));
      if (bounceAt) {
        await bouncePayment(tx, orgId, res.payment.id, "Returned by the bank: insufficient funds", bounceAt, fo);
        const again = clamp(new Date(bounceAt.getTime() + 9 * DAY));
        if (again) await runPays([{ at: again, accountId: fresh.accountId, amount: "balance", invoiceId: fresh.id, method: "BANK_TRANSFER" }], now);
      }
    }
  }
  const t2 = termlyParts[1];
  const pdcFamilies = [nasser, ...others.slice(40, 43)];
  for (const [i, a] of pdcFamilies.entries()) {
    const handed = clamp(new Date(now.getTime() - (5 + i * 4) * DAY));
    if (!handed || !t2) continue;
    // Parents write the cheque for the Term 2 amount the school announced, so it settles the Term 2 invoice exactly.
    const { part: t2Part } = await partWithShare(tx, orgId, t2.id);
    const amount = (await previewAccountBill(tx, orgId, { accountId: a.id, part: t2Part, includeCharges: true, academicYearId: year.id })).totalFils || aed(8_000);
    await recordPayment(tx, orgId, { accountId: a.id, method: "CHEQUE", amountFils: amount, receivedAt: handed, chequeNumber: String(200000 + i * 137), chequeBank: BANKS[i % BANKS.length], chequeDate: new Date(t2.dueDate.getTime() - 3 * DAY), payerName: null, notes: "Post-dated cheque for Term 2", idempotencyKey: `seed:pdc:${i}` }, fo);
  }
  // A post-dated cheque from September that has since cleared.
  const clearedFam = termOne.find((i) => i.accountId === clearedAcc?.id);
  if (clearedFam) {
    const handed = clamp(new Date(clearedFam.issueDate.getTime() + 3 * DAY));
    const fresh = await db.invoice.findUniqueOrThrow({ where: { id: clearedFam.id } });
    if (handed && balanceOf(fresh) > 0) {
      const cDate = new Date(Math.min(fresh.dueDate.getTime() + 25 * DAY, now.getTime() - 2 * DAY));
      const res = await recordPayment(tx, orgId, { accountId: fresh.accountId, method: "CHEQUE", amountFils: balanceOf(fresh), receivedAt: handed, chequeNumber: "118842", chequeBank: "Emirates NBD", chequeDate: cDate, idempotencyKey: "seed:pdc:cleared", invoiceIds: [fresh.id] }, fo);
      if (res.payment.status === "HELD" && cDate.getTime() < now.getTime()) await clearCheque(tx, orgId, res.payment.id, new Date(cDate.getTime() + 1 * DAY), fo);
    }
  }

  // --- Credit notes: a transport correction and a cancelled duplicate trip charge ------------------------------
  const busLine = await db.invoiceLine.findFirst({ where: { orgId, kind: "TRANSPORT", invoice: { planPartId: termlyParts[0].id, accountId: { notIn: [nasser.id] } } }, include: { invoice: true } });
  const cnAt = clamp(new Date(termlyParts[0].periodStart.getTime() + 33 * DAY));
  if (busLine && cnAt) {
    await issueCreditNote(tx, orgId, { invoiceId: busLine.invoiceId, reasonKind: "CORRECTION", reasonEn: "School bus not used from October (two of four months)", reasonAr: "عدم استخدام الحافلة المدرسية من أكتوبر (شهران من أربعة)", lines: [{ invoiceLineId: busLine.id, netFils: Math.round(busLine.netFils / 2) }], issueDate: cnAt }, fo);
  }
  const tripInv = await db.invoice.findFirst({ where: { orgId, lines: { some: { kind: "TRIP" } }, accountId: { not: nasser.id } }, orderBy: { number: "desc" } });
  const tripCn = clamp(new Date(now.getTime() - 2 * DAY));
  if (tripInv && tripCn) await issueCreditNote(tx, orgId, { invoiceId: tripInv.id, reasonKind: "CANCELLATION", reasonEn: "Student is not taking part in the field trip", reasonAr: "الطالب لن يشارك في الرحلة الميدانية", issueDate: tripCn }, fo);

  // --- Refunds: an overpayment refunded (approved by the principal), and one waiting for approval -----------------
  // Families that owe nothing, so an extra payment stays as credit that can be refunded.
  const settled: string[] = [];
  for (const a of others.slice(14)) {
    if (a.id === sponsored.id || a.id === joinerAcc.id || neverPaid.has(a.id) || partial.has(a.id)) continue;
    if ((await accountBalance(tx, orgId, a.id)).owedFils === 0) settled.push(a.id);
    if (settled.length >= 2) break;
  }
  const overFam = termOne.find((i) => i.accountId === settled[0]);
  if (overFam) {
    const payAt = clamp(new Date(overFam.dueDate.getTime() + 3 * DAY));
    if (payAt) {
      const extra = await recordPayment(tx, orgId, { accountId: overFam.accountId, method: "BANK_TRANSFER", reference: "FT26-DUPLICATE-0918", amountFils: aed(2_500), receivedAt: payAt, notes: "Paid twice by mistake", idempotencyKey: "seed:over:1" }, fo);
      const free = extra.payment.amountFils - extra.payment.allocatedFils;
      if (free > 0) {
        const ref = await requestRefund(tx, orgId, { paymentId: extra.payment.id, amountFils: free, reason: "Family paid twice by mistake; refund to the same bank account." }, fo);
        const dec = clamp(new Date(payAt.getTime() + 2 * DAY));
        if (dec) {
          await decideRefund(tx, orgId, ref.id, true, "Checked against the bank statement.", dec, pr);
          const out = clamp(new Date(dec.getTime() + 2 * DAY));
          if (out) await markRefundPaid(tx, orgId, ref.id, { method: "BANK_TRANSFER", reference: "OUT-RF-0921", paidAt: out }, fo);
        }
      }
    }
  }
  const leftover = settled[1];
  if (leftover) {
    const at2 = clamp(new Date(now.getTime() - 3 * DAY));
    if (at2) {
      const extra = await recordPayment(tx, orgId, { accountId: leftover, method: "CASH", amountFils: aed(500), receivedAt: at2, notes: "Paid in cash twice for the trip", idempotencyKey: "seed:over:2" }, fo);
      const free = extra.payment.amountFils - extra.payment.allocatedFils;
      if (free > 0) await requestRefund(tx, orgId, { paymentId: extra.payment.id, amountFils: free, reason: "Cash paid twice at the accounts office." }, fo);
    }
  }

  // --- A bursary waiting for the principal, and an applicant's seat booking -----------------------------------
  await requestAward(tx, orgId, { studentId: pendingBursar.id, discountId: disc("BURSARY6K").id, academicYearId: year.id, reason: "Guardian lost employment in September; supporting letter received." }, fo);
  await createSeatBookingCharge(orgId, "APP-2027-0108", aed(3_000), { name: "Huda Al Kaabi", nameAr: "هدى الكعبي", email: "huda.alkaabi@family.horizon.example" }, { now: clamp(new Date(now.getTime() - 4 * DAY)) ?? now, actorId: financeMid });

  // --- Reminders already sent for overdue invoices (each stage once) -------------------------------------------
  await sendDueFeeReminders(execCtx(tx, orgId, { now, quiet: true }));

  // --- Timestamps follow the documents (the audit log and lists read as months of history) -------------------
  await db.$executeRaw`UPDATE "Invoice" SET "createdAt" = "issueDate" WHERE "orgId" = ${orgId}`;
  await db.$executeRaw`UPDATE "FeePayment" SET "createdAt" = "receivedAt" WHERE "orgId" = ${orgId}`;
  await db.$executeRaw`UPDATE "CreditNote" SET "createdAt" = "issueDate" WHERE "orgId" = ${orgId}`;
  await db.$executeRaw`UPDATE "FeeAllocation" a SET "createdAt" = COALESCE(p."clearedAt", a."createdAt") FROM "FeePayment" p WHERE a."paymentId" = p."id" AND a."orgId" = ${orgId}`;
  await db.$executeRaw`UPDATE "AuditEvent" a SET "createdAt" = i."issueDate" FROM "Invoice" i WHERE a."orgId" = ${orgId} AND a."entityId" = i."id" AND a."action" LIKE 'fees.%'`;
  await db.$executeRaw`UPDATE "AuditEvent" a SET "createdAt" = COALESCE(p."bouncedAt", p."clearedAt", p."receivedAt") FROM "FeePayment" p WHERE a."orgId" = ${orgId} AND a."entityId" = p."id" AND a."action" LIKE 'fees.%'`;
  await db.$executeRaw`UPDATE "AuditEvent" a SET "createdAt" = c."issueDate" FROM "CreditNote" c WHERE a."orgId" = ${orgId} AND a."entityId" = c."id" AND a."action" LIKE 'fees.%'`;
  await db.$executeRaw`UPDATE "AuditEvent" a SET "createdAt" = COALESCE(r."paidAt", r."decidedAt", r."requestedAt") FROM "FeeRefund" r WHERE a."orgId" = ${orgId} AND a."entityId" = r."id" AND a."action" LIKE 'fees.%'`;
  await db.$executeRaw`UPDATE "AuditEvent" a SET "createdAt" = b."createdAt" FROM "BillingRun" b WHERE a."orgId" = ${orgId} AND a."entityId" = b."id" AND a."action" LIKE 'fees.%'`;
  w.log(`fees: done in ${Date.now() - started}ms`);

  async function runPays(list: Pay[], nowAt: Date) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let n = 0;
    for (const p of list) {
      if (p.at.getTime() > nowAt.getTime() - 3_600_000) continue;
      const inv = p.invoiceId ? await db.invoice.findUnique({ where: { id: p.invoiceId } }) : null;
      const bal = inv ? balanceOf(inv) : 0;
      const amount = p.amount === "balance" ? bal : p.amount === "half" ? Math.round(bal / 2 / 100) * 100 : p.amount;
      if (!amount || amount <= 0) continue;
      let finalAmount = amount;
      if (p.early && inv) {
        const offer = await earlyPaymentOffer(tx, orgId, inv.id, p.at);
        if (offer) finalAmount = offer.payNowFils;
      }
      const at9 = new Date(Date.UTC(p.at.getUTCFullYear(), p.at.getUTCMonth(), p.at.getUTCDate(), 6 + (n % 6), (n * 7) % 60));
      const receivedAt = at9.getTime() > nowAt.getTime() ? p.at : at9;
      await recordPayment(
        tx,
        orgId,
        {
          accountId: p.accountId,
          method: p.method,
          amountFils: finalAmount,
          receivedAt,
          reference: p.method === "BANK_TRANSFER" ? `FT${String(receivedAt.getUTCFullYear()).slice(2)}${String(100000 + ((n * 7919) % 899999))}` : p.method === "CARD" ? `POS-${String(4000 + n)}` : null,
          chequeNumber: p.cheque?.no ?? null,
          chequeBank: p.cheque?.bank ?? null,
          chequeDate: p.cheque?.date ?? null,
          idempotencyKey: `seed:pay:${p.accountId}:${p.invoiceId ?? "x"}:${p.at.getTime()}:${n}`,
          invoiceIds: p.invoiceId ? [p.invoiceId] : [],
          earlyDiscountInvoiceId: p.early ? (p.invoiceId ?? null) : null,
        },
        fo,
      );
      n++;
    }
  }
}

