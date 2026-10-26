// Offer letters and transfer certificates as bilingual PDFs, from the school's editable templates
// (Templates: "Offer of a Place" and "Transfer Certificate") with the shared letter renderer (Arabic shaping, RTL).
import type { AdmissionApplication, StudentWithdrawal } from "@prisma/client";
import type { Tx } from "@/server/db";
import type { MergeData } from "@/server/documents/merge";
import { renderLetterPdf } from "@/server/documents/pdf";
import type { Letterhead } from "@/server/documents/pdf";
import { admissionsBoth, childNameBoth, dateBoth, gradeBoth } from "./labels";
import { filsToAed } from "./rules";
import { ensureAdmissionSetup, OFFER_TEMPLATE_KEY, TC_TEMPLATE_KEY } from "./templates";

type Guardian = { firstNameEn: string; lastNameEn: string; firstNameAr?: string; lastNameAr?: string; primary?: boolean };

/** Merge values for the offer letter, in both languages. */
export async function offerMergeData(tx: Tx, orgId: string, app: AdmissionApplication): Promise<MergeData> {
  const [org, year, cap] = await Promise.all([
    tx.organization.findUnique({ where: { id: orgId }, select: { nameEn: true, nameAr: true } }),
    tx.academicYear.findUnique({ where: { id: app.academicYearId }, select: { nameEn: true, nameAr: true } }),
    tx.admissionCapacity.findUnique({ where: { orgId_academicYearId_gradeLevel: { orgId, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel } } }),
  ]);
  const guardians = (app.guardians as Guardian[] | null) ?? [];
  const g = guardians.find((x) => x.primary) ?? guardians[0];
  const child = childNameBoth(app);
  const grade = gradeBoth(app.gradeLevel);
  const deadline = app.offerDeadline ? dateBoth(app.offerDeadline) : { en: "", ar: "" };
  const fee = app.seatFeeFils ?? cap?.seatFeeFils ?? 0;
  const seat = fee > 0 ? admissionsBoth("letter.seatSentence", { amount: filsToAed(fee) }) : { en: "", ar: "" };
  const today = dateBoth(app.offerMadeAt ?? new Date());
  const base = (l: "en" | "ar"): Record<string, string> => ({
    "guardian.name": g ? (l === "ar" && g.firstNameAr ? `${g.firstNameAr} ${g.lastNameAr ?? ""}`.trim() : `${g.firstNameEn} ${g.lastNameEn}`) : "",
    "child.fullName": child[l],
    "child.firstName": l === "ar" && app.firstNameAr ? app.firstNameAr : app.firstNameEn,
    grade: grade[l],
    year: (l === "ar" ? year?.nameAr : year?.nameEn) ?? "",
    "school.name": org?.nameEn ?? "",
    "school.nameAr": org?.nameAr ?? "",
    "offer.deadline": deadline[l],
    "seat.sentence": seat[l],
    "application.number": app.number,
    today: today[l],
  });
  return { en: base("en"), ar: base("ar") };
}

export async function renderOfferPdf(tx: Tx, orgId: string, app: AdmissionApplication, letterhead: Letterhead | null): Promise<Buffer> {
  await ensureAdmissionSetup(tx, orgId);
  const [org, template] = await Promise.all([
    tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { nameEn: true, nameAr: true } }),
    tx.documentTemplate.findUniqueOrThrow({ where: { orgId_key: { orgId, key: OFFER_TEMPLATE_KEY } } }),
  ]);
  return renderLetterPdf({
    output: template.output,
    school: { en: org.nameEn, ar: org.nameAr },
    title: { en: template.nameEn, ar: template.nameAr },
    reference: app.number,
    bodyEn: template.bodyEn,
    bodyAr: template.bodyAr,
    merge: await offerMergeData(tx, orgId, app),
    signatory: { en: template.signatoryEn ?? "", ar: template.signatoryAr ?? "" },
    issuedAt: app.offerMadeAt ?? new Date(),
    letterhead,
  });
}

/** Merge values for the transfer certificate. */
export async function tcMergeData(tx: Tx, orgId: string, w: StudentWithdrawal): Promise<MergeData> {
  const [org, s] = await Promise.all([
    tx.organization.findUnique({ where: { id: orgId }, select: { nameEn: true, nameAr: true } }),
    tx.student.findFirstOrThrow({ where: { id: w.studentId, orgId } }),
  ]);
  const grade = gradeBoth(s.gradeLevel);
  const reason = admissionsBoth(`leavingReason.${w.reasonKey}`);
  const base = (l: "en" | "ar"): Record<string, string> => ({
    "student.fullName": l === "ar" ? `${s.firstNameAr} ${s.lastNameAr}` : `${s.firstNameEn} ${s.lastNameEn}`,
    "student.studentNo": s.studentNo,
    "student.dateOfBirth": s.dateOfBirth ? dateBoth(s.dateOfBirth)[l] : "",
    "student.nationality": (l === "ar" ? s.nationalityAr : s.nationalityEn) ?? "",
    "student.enrolledOn": s.enrolledOn ? dateBoth(s.enrolledOn)[l] : "",
    "student.grade": grade[l],
    "school.name": org?.nameEn ?? "",
    "school.nameAr": org?.nameAr ?? "",
    "leaving.date": dateBoth(w.leavingDate)[l],
    "leaving.reason": reason[l],
    "tc.number": w.tcNumber ?? "",
    today: dateBoth(w.tcIssuedAt ?? new Date())[l],
  });
  return { en: base("en"), ar: base("ar") };
}

export async function renderTcPdf(tx: Tx, orgId: string, w: StudentWithdrawal, letterhead: Letterhead | null): Promise<Buffer> {
  await ensureAdmissionSetup(tx, orgId);
  const [org, template] = await Promise.all([
    tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { nameEn: true, nameAr: true } }),
    tx.documentTemplate.findUniqueOrThrow({ where: { orgId_key: { orgId, key: TC_TEMPLATE_KEY } } }),
  ]);
  return renderLetterPdf({
    output: template.output,
    school: { en: org.nameEn, ar: org.nameAr },
    title: { en: template.nameEn, ar: template.nameAr },
    reference: w.tcNumber ?? w.id.slice(0, 8).toUpperCase(),
    bodyEn: template.bodyEn,
    bodyAr: template.bodyAr,
    merge: await tcMergeData(tx, orgId, w),
    signatory: { en: template.signatoryEn ?? "", ar: template.signatoryAr ?? "" },
    issuedAt: w.tcIssuedAt ?? new Date(),
    letterhead,
  });
}
