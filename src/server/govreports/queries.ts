// Data for the government reporting pages. Request code: ctx.db only, permission checked by the caller.
import type { Ctx } from "@/server/context";
import { asTx, loadSettings as loadAdmissionSettings } from "@/server/admissions/settings";
import { schoolAuthority } from "@/server/admissions/registration";
import { dateKey } from "@/server/timetable/cover";
import { buildReturn } from "./build";
import { metaOf, periodText, returnTitle, specOf, versionFor } from "./export";
import type { Problem, ReturnKind } from "./kinds";
import { authorityText, type Loc } from "./labels";
import { dataHash } from "./table";
import { signerOf } from "./signer";

export async function authorityFor(ctx: Ctx) {
  const settings = await loadAdmissionSettings(asTx(ctx.db), ctx.orgId);
  const a = schoolAuthority(settings.row, ctx.org.regulator);
  const own = { en: a.labelEn, ar: a.labelAr };
  return { key: a.key, full: authorityText(a.key, own, ctx.locale as Loc), short: authorityText(a.key, own, ctx.locale as Loc, "short"), own };
}

async function names(ctx: Ctx, ids: string[]) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return new Map<string, { en: string; ar: string }>();
  const rows = await ctx.db.membership.findMany({ where: { id: { in: clean } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
  return new Map(rows.map((r) => [r.id, { en: r.user.nameEn, ar: r.user.nameAr || r.user.nameEn }]));
}

export async function overviewData(ctx: Ctx) {
  const loc = ctx.locale as Loc;
  const [returns, due, submissions, year] = await Promise.all([
    ctx.db.govReturn.findMany({ orderBy: [{ asOf: "desc" }, { createdAt: "desc" }], take: 200, include: { exports: { orderBy: { createdAt: "desc" }, take: 1 }, submissions: { orderBy: { submittedOn: "desc" }, take: 1 } } }),
    ctx.db.govDueDate.findMany({ orderBy: { dueOn: "asc" }, take: 200 }),
    ctx.db.govSubmission.findMany({ orderBy: [{ submittedOn: "desc" }, { createdAt: "desc" }], take: 200, include: { return: true } }),
    ctx.db.academicYear.findFirst({ where: { isCurrent: true }, select: { startsOn: true } }),
  ]);
  const exportIds = submissions.map((s) => s.exportId);
  const files = exportIds.length ? await ctx.db.govReturnExport.findMany({ where: { id: { in: exportIds } }, select: { id: true, version: true, format: true, locale: true, fileSha256: true } }) : [];
  const who = await names(ctx, submissions.map((s) => s.recordedById));
  return {
    returns: returns.map((r) => ({ ...r, title: returnTitle(r, loc), latestExport: r.exports[0] ?? null, latestSubmission: r.submissions[0] ?? null })),
    due,
    log: submissions.map((s) => ({ ...s, title: returnTitle(s.return, loc), file: files.find((f) => f.id === s.exportId) ?? null, by: who.get(s.recordedById) ?? null })),
    yearStart: year?.startsOn ?? null,
  };
}

export type ProblemView = Problem & {
  student?: { id: string; name: string; studentNo: string; grade: number; section: string | null } | null;
  other?: { id: string; name: string; studentNo: string } | null;
  member?: { id: string; name: string } | null;
  /** Identity fields this student is missing (for the fix dialog). */
  missing?: Array<"dob" | "gender" | "nationality" | "eid">;
};

const MISSING: Record<string, "dob" | "gender" | "nationality" | "eid"> = { missing_dob: "dob", missing_gender: "gender", missing_nationality: "nationality", missing_eid: "eid" };

export async function returnPageData(ctx: Ctx, id: string) {
  const loc = ctx.locale as Loc;
  const ret = await ctx.db.govReturn.findFirst({ where: { id }, include: { exports: { orderBy: { createdAt: "desc" } }, submissions: { orderBy: [{ submittedOn: "desc" }, { createdAt: "desc" }] } } });
  if (!ret) return null;
  const data = await buildReturn(ctx.db, ctx.orgId, specOf(ret));
  const hash = dataHash(metaOf(ret), data.tables);
  const nextVersion = await versionFor(ctx.db, ret.id, hash);
  const studentIds = [...new Set(data.problems.flatMap((p) => [p.studentId, p.otherStudentId]).filter(Boolean) as string[])];
  const students = studentIds.length ? await ctx.db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, studentNo: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, section: true } }) : [];
  const nameOf = (s: { firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string }) => (loc === "ar" ? `${s.firstNameAr || s.firstNameEn} ${s.lastNameAr || s.lastNameEn}` : `${s.firstNameEn} ${s.lastNameEn}`);
  const members = await names(ctx, [...data.problems.map((p) => p.membershipId ?? ""), ...ret.exports.map((e) => e.generatedById), ...ret.submissions.map((s) => s.recordedById)]);
  const missingBy = new Map<string, Array<"dob" | "gender" | "nationality" | "eid">>();
  for (const p of data.problems) if (p.studentId && MISSING[p.rule]) missingBy.set(p.studentId, [...(missingBy.get(p.studentId) ?? []), MISSING[p.rule]]);
  const problems: ProblemView[] = data.problems.map((p) => {
    const s = p.studentId ? students.find((x) => x.id === p.studentId) : null;
    const o = p.otherStudentId ? students.find((x) => x.id === p.otherStudentId) : null;
    const m = p.membershipId ? members.get(p.membershipId) : null;
    return {
      ...p,
      student: s ? { id: s.id, name: nameOf(s), studentNo: s.studentNo, grade: s.gradeLevel, section: s.section } : null,
      other: o ? { id: o.id, name: nameOf(o), studentNo: o.studentNo } : null,
      member: m && p.membershipId ? { id: p.membershipId, name: loc === "ar" ? m.ar : m.en } : null,
      missing: p.studentId ? missingBy.get(p.studentId) : undefined,
    };
  });
  const nameIn = (id: string) => {
    const n = members.get(id);
    return n ? (loc === "ar" ? n.ar : n.en) : "";
  };
  const signer = ret.signedOffById ? await signerOf(ctx.db, ret.signedOffById).catch(() => null) : null;
  return {
    ret,
    signedName: signer ? (loc === "ar" ? signer.name.ar : signer.name.en) : null,
    kind: ret.kind as ReturnKind,
    title: returnTitle(ret, loc),
    period: await periodText(ctx.db, ret, loc),
    data,
    problems,
    hash,
    nextVersion,
    signedStale: Boolean(ret.signedDataHash && ret.signedDataHash !== hash),
    // The data no longer matches the file most recently sent to the authority.
    submittedChanged: (() => {
      const last = ret.submissions[0];
      const file = last ? ret.exports.find((e) => e.id === last.exportId) : null;
      return Boolean(file && file.dataSha256 !== hash);
    })(),
    exports: ret.exports.map((e) => ({ ...e, by: nameIn(e.generatedById) })),
    submissions: ret.submissions.map((s) => ({ ...s, by: nameIn(s.recordedById), file: ret.exports.find((e) => e.id === s.exportId) ?? null })),
    asOfKey: dateKey(ret.asOf),
  };
}
