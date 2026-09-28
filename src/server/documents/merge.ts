// Builds merge-field values for document templates in both languages.
import type { Tx } from "@/server/db";

function fmtDate(d: Date | null | undefined, locale: "en" | "ar") {
  if (!d) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    timeZone: "Asia/Dubai",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

const PURPOSES: Record<string, { en: string; ar: string }> = {
  visa: { en: "a residence visa application", ar: "طلب تأشيرة الإقامة" },
  embassy: { en: "an embassy application", ar: "تقديمه إلى السفارة" },
  bank: { en: "a bank application", ar: "تقديمه إلى البنك" },
  university: { en: "a university application", ar: "التقديم إلى الجامعة" },
  other: { en: "the family's records", ar: "سجلات الأسرة" },
};

export type MergeData = { en: Record<string, string>; ar: Record<string, string> };

export async function buildMergeData(
  tx: Tx,
  orgId: string,
  input: { studentId: string | null; requestNumber: string; form: Record<string, unknown>; now: Date },
): Promise<MergeData> {
  const [org, student, year] = await Promise.all([
    tx.organization.findUnique({ where: { id: orgId } }),
    input.studentId ? tx.student.findUnique({ where: { id: input.studentId } }) : null,
    tx.academicYear.findFirst({ where: { orgId, isCurrent: true } }),
  ]);
  const purposeKey = String(input.form.purpose ?? "other");
  const purpose = PURPOSES[purposeKey] ?? PURPOSES.other;
  const addressed = String(input.form.addressedTo ?? "").trim();
  const base = (locale: "en" | "ar"): Record<string, string> => ({
    "student.fullName": student ? `${student.firstNameEn} ${student.lastNameEn}` : "",
    "student.fullNameAr": student ? `${student.firstNameAr} ${student.lastNameAr}` : "",
    "student.studentNo": student?.studentNo ?? "",
    "student.grade": student ? String(student.gradeLevel) : "",
    "student.dateOfBirth": fmtDate(student?.dateOfBirth, locale),
    "student.nationality": (locale === "ar" ? student?.nationalityAr : student?.nationalityEn) ?? "",
    "student.enrolledOn": fmtDate(student?.enrolledOn, locale),
    "school.name": org?.nameEn ?? "",
    "school.nameAr": org?.nameAr ?? "",
    "academicYear.name": (locale === "ar" ? year?.nameAr : year?.nameEn) ?? "",
    "request.number": input.requestNumber,
    "request.addressedTo": addressed || (locale === "ar" ? "من يهمه الأمر" : "To whom it may concern"),
    "request.purpose": purpose[locale],
    today: fmtDate(input.now, locale),
  });
  return { en: base("en"), ar: base("ar") };
}

export function applyMerge(body: string, values: Record<string, string>) {
  return body.replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => values[k] ?? "");
}
