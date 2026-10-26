import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { getOptionalCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { toCsv } from "@/lib/csv-out";
import { toXlsx } from "@/lib/xlsx-out";
import { decryptField } from "@/lib/crypto";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { canEnroll, canManageAdmissions, canRevealIds, canViewAdmissions } from "@/server/admissions/access";
import { admissionYears, asTx, loadSettings } from "@/server/admissions/settings";
import { capacityReport, currentByStage, funnel } from "@/server/admissions/reports";
import { windowSummary } from "@/server/admissions/reenrollment";
import { countryName } from "@/server/admissions/config";

export const runtime = "nodejs";

/**
 * Admissions exports as CSV or Excel. Aggregates (funnel, capacity, re-enrollment) need admissions.view; the
 * application list (names and contacts, never health details or ID numbers) needs admissions.manage; the government
 * registration list needs admissions.enroll (full ID numbers only with people.reveal_ids). Every export is audited.
 */
export async function GET(req: Request) {
  const ctx = await getOptionalCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canViewAdmissions(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const tx = asTx(ctx.db);
  const L = ctx.locale;
  const tg = await getTranslations("gradeLevel");
  const t = await getTranslations("admissions.export");
  const ts = await getTranslations("admissions.stage");
  const tc = await getTranslations("admissions.form.curriculum");
  const tsh = await getTranslations("admissions.sheet");
  const grade = (g: number) => tg("label", gradeLevelValues(g));
  const years = await admissionYears(tx, ctx.orgId);
  const year = years.find((y) => y.id === url.searchParams.get("year")) ?? years.find((y) => !y.isCurrent) ?? years[0];
  const settings = await loadSettings(tx, ctx.orgId);
  const stageName = (k: string) => {
    const s = settings.stages.find((x) => x.key === k);
    return (L === "ar" ? s?.labelAr || s?.labelEn : s?.labelEn || s?.labelAr) || (ts.has(k) ? ts(k) : k);
  };
  let columns: string[] = [];
  let rows: unknown[][] = [];
  let name = kind;

  if (kind === "funnel" && year) {
    const [f, now] = await Promise.all([funnel(tx, ctx.orgId, year.id), currentByStage(tx, ctx.orgId, year.id)]);
    const grades = [...new Set([...f, ...now].map((r) => r.grade))].sort((a, b) => a - b);
    columns = [t("stage"), t("measure"), ...grades.map(grade), t("total")];
    for (const st of settings.stages) {
      for (const [measure, src] of [[t("reached"), f], [t("now"), now]] as const) {
        const vals = grades.map((g) => src.filter((r) => r.stage === st.key && r.grade === g).reduce((s, r) => s + r.n, 0));
        rows.push([stageName(st.key), measure, ...vals, vals.reduce((a, b) => a + b, 0)]);
      }
    }
  } else if (kind === "capacity" && year) {
    const cap = await capacityReport(tx, ctx.orgId, year);
    columns = [t("grade"), t("capacity"), t("enrolled"), t("holding"), t("offered"), t("free"), t("waitlisted")];
    rows = cap.map((c) => [grade(c.grade), c.capacity ?? "", c.enrolled, c.holding, c.offered, c.available ?? "", c.waitlisted]);
  } else if (kind === "reenrollment") {
    const w = await ctx.db.reenrollmentWindow.findFirst({ where: { orgId: ctx.orgId, ...(url.searchParams.get("window") ? { id: String(url.searchParams.get("window")) } : {}) }, orderBy: { opensAt: "desc" } });
    if (!w) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const sum = await windowSummary(tx, ctx.orgId, w.id);
    columns = [t("grade"), t("eligible"), t("returning"), t("leaving"), t("pending")];
    rows = sum.map((r) => [grade(r.grade), r.eligible, r.returning, r.leaving, r.pending]);
  } else if (kind === "applications" && year) {
    if (!canManageAdmissions(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const g = url.searchParams.get("grade");
    const stage = url.searchParams.get("stage");
    const where: Prisma.AdmissionApplicationWhereInput = { orgId: ctx.orgId, academicYearId: year.id, stage: stage && /^[A-Z_]{2,40}$/.test(stage) ? stage : { not: "DRAFT" }, ...(g !== null && ALL_GRADE_LEVELS.includes(Number(g)) ? { gradeLevel: Number(g) } : {}) };
    const apps = await ctx.db.admissionApplication.findMany({ where, orderBy: [{ gradeLevel: "asc" }, { submittedAt: "asc" }], take: 5000 });
    columns = [t("number"), t("firstNameEn"), t("lastNameEn"), t("firstNameAr"), t("lastNameAr"), t("grade"), t("stage"), t("submitted"), t("dateOfBirth"), t("gender"), t("nationality"), t("guardian"), t("email"), t("phone"), t("sibling"), t("staffChild"), t("possibleDuplicate"), t("offerDeadline")];
    rows = apps.map((a) => {
      const gs = (a.guardians as Array<{ firstNameEn: string; lastNameEn: string; email: string; phone: string; primary?: boolean }> | null) ?? [];
      const p = gs.find((x) => x.primary) ?? gs[0];
      return [a.number, a.firstNameEn, a.lastNameEn, a.firstNameAr ?? "", a.lastNameAr ?? "", grade(a.gradeLevel), stageName(a.stage), a.submittedAt?.toISOString().slice(0, 10) ?? "", a.dateOfBirth?.toISOString().slice(0, 10) ?? "", a.gender ?? "", countryName(a.nationality, L), p ? `${p.firstNameEn} ${p.lastNameEn}` : "", p?.email ?? "", p?.phone ?? "", a.siblingStudentIds.length ? t("yes") : "", a.staffChild ? t("yes") : "", a.duplicateFlags.length ? t("yes") : "", a.offerDeadline?.toISOString().slice(0, 10) ?? ""];
    });
  } else if (kind === "registration") {
    if (!canEnroll(ctx)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const regKind = url.searchParams.get("regKind") === "WITHDRAWAL" ? "WITHDRAWAL" : "ENROLLMENT";
    const regs = await ctx.db.govRegistration.findMany({ where: { orgId: ctx.orgId, kind: regKind, status: "NOT_SUBMITTED" }, orderBy: { createdAt: "asc" }, take: 2000 });
    const students = await ctx.db.student.findMany({ where: { orgId: ctx.orgId, id: { in: regs.map((r) => r.studentId) } }, include: { guardians: { include: { guardian: true }, where: { isPrimary: true } } } });
    const full = canRevealIds(ctx);
    const dec = (v: string | null) => {
      try {
        return v ? decryptField(v) : "";
      } catch {
        return "";
      }
    };
    columns = [t("studentNo"), t("firstNameEn"), t("lastNameEn"), t("firstNameAr"), t("lastNameAr"), t("dateOfBirth"), t("gender"), t("nationality"), t("emiratesId"), t("passport"), t("grade"), t("section"), t("curriculum"), t("enrolledOn"), t("guardian"), t("phone"), t("email")];
    rows = regs.map((r) => {
      const s = students.find((x) => x.id === r.studentId)!;
      const g = s?.guardians[0]?.guardian;
      return s ? [s.studentNo, s.firstNameEn, s.lastNameEn, s.firstNameAr, s.lastNameAr, s.dateOfBirth?.toISOString().slice(0, 10) ?? "", s.gender ? tsh(s.gender === "F" ? "female" : "male") : "", L === "ar" ? s.nationalityAr ?? "" : s.nationalityEn ?? "", full ? dec(s.emiratesIdEnc) : s.emiratesIdLast4 ? `***${s.emiratesIdLast4}` : "", full ? dec(s.passportEnc) : s.passportLast4 ? `***${s.passportLast4}` : "", grade(s.gradeLevel), s.section ?? "", tc.has(s.curriculum) ? tc(s.curriculum) : s.curriculum, s.enrolledOn?.toISOString().slice(0, 10) ?? "", g ? `${g.firstNameEn} ${g.lastNameEn}` : "", g?.phone ?? "", g?.email ?? ""] : [];
    });
    name = `registration-${regKind.toLowerCase()}`;
  } else {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "admission.export", entityType: "AdmissionApplication", sensitivity: kind === "registration" || kind === "applications" ? "CONFIDENTIAL" : "STANDARD", meta: { kind, format, rows: rows.length } });
  const file = `admissions-${name}-${new Date().toISOString().slice(0, 10)}.${format}`;
  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(toXlsx(name, columns, rows, { rtl: L === "ar" })), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "private, no-store" } });
  }
  const csv = toCsv(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), columns);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "private, no-store" } });
}
