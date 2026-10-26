import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { gradeLevelValues } from "@/lib/grade-levels";
import { decryptField } from "@/lib/crypto";
import { audit } from "@/server/audit/audit";
import { canEnroll, canRevealIds } from "@/server/admissions/access";
import { asTx, loadSettings } from "@/server/admissions/settings";
import { authorityNames } from "@/server/admissions/page-data";
import { countryName, languageName } from "@/server/admissions/config";
import { PrintButton } from "@/components/admissions/print-button";

export async function generateMetadata() {
  const t = await getTranslations("admissions.sheet");
  return { title: t("title") };
}

type Guardian = { relationship: string; firstNameEn: string; lastNameEn: string; firstNameAr?: string; lastNameAr?: string; email: string; phone: string; occupation?: string };
type Schooling = { attended: boolean; schoolName?: string; city?: string; country?: string; curriculum?: string; lastGrade?: string };

/**
 * Registration sheet: everything staff type into the authority's system (SPEA DALEEL, MoE Al Manhal, KHDA, ADEK), in
 * English and Arabic, ready to print. Full identity numbers need people.reveal_ids, and opening the sheet is audited.
 */
export default async function RegistrationSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!canEnroll(ctx)) notFound();
  const reg = await ctx.db.govRegistration.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!reg) notFound();
  const s = await ctx.db.student.findFirst({ where: { id: reg.studentId, orgId: ctx.orgId }, include: { guardians: { include: { guardian: true } } } });
  if (!s) notFound();
  const app = reg.applicationId ? await ctx.db.admissionApplication.findFirst({ where: { id: reg.applicationId, orgId: ctx.orgId } }) : null;
  const withdrawal = reg.withdrawalId ? await ctx.db.studentWithdrawal.findFirst({ where: { id: reg.withdrawalId, orgId: ctx.orgId } }) : null;
  const settings = await loadSettings(asTx(ctx.db), ctx.orgId);
  const authority = await authorityNames(ctx, settings);
  const reveal = canRevealIds(ctx);
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "student.registration_sheet", entityType: "Student", entityId: s.id, sensitivity: reveal ? "CONFIDENTIAL" : "STANDARD", meta: { registrationId: reg.id, fullIds: reveal } });
  const tEn = await getTranslations({ locale: "en", namespace: "admissions.sheet" });
  const tAr = await getTranslations({ locale: "ar", namespace: "admissions.sheet" });
  const tgEn = await getTranslations({ locale: "en", namespace: "gradeLevel" });
  const tgAr = await getTranslations({ locale: "ar", namespace: "gradeLevel" });
  const tcEn = await getTranslations({ locale: "en", namespace: "admissions.form.curriculum" });
  const tcAr = await getTranslations({ locale: "ar", namespace: "admissions.form.curriculum" });
  const curriculum = (loc: "en" | "ar") => {
    const tc = loc === "en" ? tcEn : tcAr;
    return s.curriculum && tc.has(s.curriculum) ? tc(s.curriculum) : (s.curriculum ?? "");
  };
  const t = await getTranslations("admissions.sheet");
  const dec = (v: string | null) => {
    if (!v) return "";
    try {
      return decryptField(v);
    } catch {
      return "";
    }
  };
  const eid = s.emiratesIdEnc ? (reveal ? dec(s.emiratesIdEnc).replace(/^(\d{3})(\d{4})(\d{7})(\d)$/, "$1-$2-$3-$4") : `784-••••-•••${s.emiratesIdLast4 ?? ""}`) : "";
  const passport = s.passportEnc ? (reveal ? dec(s.passportEnc) : `•••••${s.passportLast4 ?? ""}`) : "";
  const d = (x: Date | null | undefined, loc: string) => (x ? new Intl.DateTimeFormat(loc === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Dubai" }).format(x) : "");
  const schooling = (app?.schooling as Schooling | null) ?? null;
  const guardians: Guardian[] = app?.guardians
    ? (app.guardians as Guardian[])
    : s.guardians.map((l) => ({ relationship: "", firstNameEn: l.guardian.firstNameEn, lastNameEn: l.guardian.lastNameEn, firstNameAr: l.guardian.firstNameAr, lastNameAr: l.guardian.lastNameAr, email: l.guardian.email ?? "", phone: l.guardian.phone ?? "" }));
  const rows: Array<[string, string, string]> = [
    ["studentNo", s.studentNo, s.studentNo],
    ["nameEn", `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameEn} ${s.lastNameEn}`],
    ["nameAr", `${s.firstNameAr} ${s.lastNameAr}`, `${s.firstNameAr} ${s.lastNameAr}`],
    ["dob", d(s.dateOfBirth, "en"), d(s.dateOfBirth, "ar")],
    ["gender", s.gender ? tEn(s.gender === "F" ? "female" : "male") : "", s.gender ? tAr(s.gender === "F" ? "female" : "male") : ""],
    ["nationality", s.nationalityEn ?? "", s.nationalityAr ?? ""],
    ["emiratesId", eid, eid],
    ["passport", passport, passport],
    ["grade", `${tgEn("label", gradeLevelValues(s.gradeLevel))}${s.section ? ` ${s.section}` : ""}`, `${tgAr("label", gradeLevelValues(s.gradeLevel))}${s.section ? ` ${s.section}` : ""}`],
    ["curriculum", curriculum("en"), curriculum("ar")],
    ["enrolledOn", d(s.enrolledOn, "en"), d(s.enrolledOn, "ar")],
    ...(app?.homeLanguage ? [["homeLanguage", languageName(app.homeLanguage, "en"), languageName(app.homeLanguage, "ar")] as [string, string, string]] : []),
    ...(schooling?.attended ? [["previousSchool", `${schooling.schoolName ?? ""}, ${countryName(schooling.country, "en")}`, `${schooling.schoolName ?? ""}، ${countryName(schooling.country, "ar")}`] as [string, string, string]] : []),
    ...(withdrawal ? [["leavingDate", d(withdrawal.leavingDate, "en"), d(withdrawal.leavingDate, "ar")] as [string, string, string], ["destination", withdrawal.destination ?? "", withdrawal.destination ?? ""] as [string, string, string]] : []),
  ];
  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex items-start justify-between gap-4 print:hidden">
        <p className="text-sm text-gray-600">{t("printHint", { authority: authority.full })}</p>
        <PrintButton label={t("print")} />
      </div>
      <header className="flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <h1 className="text-lg font-semibold">{tEn(reg.kind === "WITHDRAWAL" ? "titleWithdrawal" : "titleEnrollment")}</h1>
          <p className="text-xs text-gray-600">{ctx.org.nameEn}</p>
        </div>
        <div dir="rtl" className="text-end">
          <h1 className="text-lg font-semibold">{tAr(reg.kind === "WITHDRAWAL" ? "titleWithdrawal" : "titleEnrollment")}</h1>
          <p className="text-xs text-gray-600">{ctx.org.nameAr}</p>
        </div>
      </header>
      <p className="mt-2 text-xs text-gray-600">
        {authority.full} {reg.reference ? `· ${reg.reference}` : ""}
      </p>
      <table className="mt-4 w-full border-collapse text-sm">
        <tbody>
          {rows.map(([k, en, ar]) => (
            <tr key={k} className="border-b">
              <th className="w-1/4 py-1.5 pe-2 text-start align-top text-xs font-medium text-gray-600">{tEn(`field.${k}`)}</th>
              <td className="w-1/4 py-1.5 pe-2 align-top" dir="ltr">{en}</td>
              <td className="w-1/4 py-1.5 ps-2 text-end align-top" dir="rtl">{ar}</td>
              <th className="w-1/4 py-1.5 ps-2 text-end align-top text-xs font-medium text-gray-600" dir="rtl">{tAr(`field.${k}`)}</th>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mt-6 text-sm font-semibold">
        {tEn("guardians")} <span className="text-gray-500">/ {tAr("guardians")}</span>
      </h2>
      <table className="mt-2 w-full border-collapse text-sm">
        <tbody>
          {guardians.map((g, i) => (
            <tr key={i} className="border-b">
              <td className="py-1.5 pe-2">
                {g.firstNameEn} {g.lastNameEn}
                {g.firstNameAr ? <span className="block text-xs text-gray-600" dir="rtl">{g.firstNameAr} {g.lastNameAr}</span> : null}
              </td>
              <td className="py-1.5 pe-2 text-xs" dir="ltr">{g.phone}</td>
              <td className="py-1.5 text-xs" dir="ltr">{g.email}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!reveal && <p className="mt-4 text-xs text-gray-600 print:hidden">{t("maskedNote")}</p>}
      <p className="mt-6 text-[10px] text-gray-500">{t("footer", { date: d(new Date(), ctx.locale) })}</p>
    </main>
  );
}
