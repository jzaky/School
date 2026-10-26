// Turning a return into files (Excel, CSV, PDF), logging each file with its version and checksums, and the audit
// trail. The version goes up only when the return's data changes, so downloading the same data twice gives the
// same version. Full Emirates ID numbers appear only in the learner registration list, only for people.reveal_ids
// holders who ask for them, and that download is audited as confidential.
import type { GovReturn } from "@prisma/client";
import { tenantTx, type TenantDb } from "@/lib/tenant-db";
import { decryptField } from "@/lib/crypto";
import { toCsv } from "@/lib/csv-out";
import { audit } from "@/server/audit/audit";
import { eidDigits, formatEid } from "@/server/admissions/rules";
import { asTx, loadSettings as loadAdmissionSettings } from "@/server/admissions/settings";
import type { Letterhead } from "@/server/documents/pdf";
import { dateKey } from "@/server/timetable/cover";
import { GovError } from "./access";
import { buildReturn, periodOf } from "./build";
import { canCarryIds, listsPeople, type ExportFormat, type ReturnKind } from "./kinds";
import { authorityText, dayText, gt, type Loc } from "./labels";
import { renderSummaryPdf } from "./pdf";
import { bilingualHeader, cellValue, dataHash, isEid, sha256, type ReturnData, type Table } from "./table";
import { problemCount } from "./validate";
import { workbook, type Sheet } from "./xlsx";
import { schoolAuthority } from "@/server/admissions/registration";
import { signerOf } from "./signer";

/** The table a CSV carries (a CSV holds one table): the one an authority's portal is most likely to take. */
export const CSV_TABLE: Record<ReturnKind, string> = { CENSUS: "sections", REGISTRATION: "learners", ATTENDANCE: "attendanceGrades", STAFF: "staffList", RESULTS: "results" };
/** Aggregate tables in the summary PDF (no lists of people). */
export const PDF_TABLES: Record<ReturnKind, string[]> = { CENSUS: ["summary", "grades", "nationality", "age", "sen"], REGISTRATION: ["movements"], ATTENDANCE: ["summary", "attendanceGrades"], STAFF: ["roles", "staffNationality", "gaps"], RESULTS: ["results", "ap"] };

export const specOf = (r: Pick<GovReturn, "kind" | "asOf" | "periodFrom">) => ({ kind: r.kind as ReturnKind, asOf: r.asOf, periodFrom: r.periodFrom });
export const metaOf = (r: Pick<GovReturn, "kind" | "asOf" | "periodFrom" | "authority">) => ({ kind: r.kind, asOf: dateKey(r.asOf), from: r.periodFrom ? dateKey(r.periodFrom) : null, authority: r.authority });

/** A return's title in one language: its own name, or the kind and date. */
export function returnTitle(r: Pick<GovReturn, "kind" | "asOf" | "label">, loc: Loc) {
  const kind = gt(loc, `kind.${r.kind}`);
  return r.label?.trim() ? `${r.label.trim()} (${kind})` : gt(loc, "titleOn", { kind, date: dayText(r.asOf, loc) });
}

export async function periodText(db: TenantDb, r: Pick<GovReturn, "kind" | "asOf" | "periodFrom">, loc: Loc) {
  if (r.kind === "STAFF") return gt(loc, "asAt", { date: dayText(r.asOf, loc) });
  const p = await periodOf(db, specOf(r));
  if (r.kind === "CENSUS") return gt(loc, "censusPeriod", { date: dayText(r.asOf, loc), from: dayText(p.from, loc), to: dayText(p.to, loc) });
  return gt(loc, "period", { from: dayText(p.from, loc), to: dayText(p.to, loc) });
}

/** The version a file of this data would carry: the latest version when the data is unchanged, else the next. */
export async function versionFor(db: TenantDb, returnId: string, dataSha256: string) {
  const latest = await db.govReturnExport.findFirst({ where: { returnId }, orderBy: [{ version: "desc" }, { createdAt: "desc" }], select: { version: true, dataSha256: true } });
  if (!latest) return 1;
  return latest.dataSha256 === dataSha256 ? latest.version : latest.version + 1;
}

/** Full Emirates ID numbers for the learners in a list, formatted 784-YYYY-NNNNNNN-N. Callers check the permission. */
async function eidValues(db: TenantDb, tables: Table[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const t of tables) for (const r of t.rows) for (const c of r) if (isEid(c) && c.present) ids.add(c.eid);
  const out = new Map<string, string>();
  if (!ids.size) return out;
  const rows = await db.student.findMany({ where: { id: { in: [...ids] } }, select: { id: true, emiratesIdEnc: true } });
  for (const r of rows) {
    try {
      const raw = decryptField(r.emiratesIdEnc!);
      const d = eidDigits(raw);
      out.set(r.id, d ? formatEid(d) : raw);
    } catch {
      // Unreadable value: left as "present".
    }
  }
  return out;
}

/** The sign-off line in one language. Arabic uses the signer's Arabic name and title when they are on file. */
async function signOffText(db: TenantDb, ret: GovReturn, loc: Loc, stale: boolean) {
  let name = ret.signedOffName ?? "";
  let title = ret.signedOffTitle;
  if (loc === "ar" && ret.signedOffById) {
    const s = await signerOf(db, ret.signedOffById).catch(() => null);
    if (s) {
      name = s.name.ar;
      title = s.title?.ar ?? title;
    }
  }
  return { name, title, at: dayText(ret.signedOffAt!, loc), stale };
}

type Actor = { membershipId: string; userId: string; name: { en: string; ar: string } };
type Org = { id: string; slug: string; nameEn: string; nameAr: string; shortNameEn: string | null; shortNameAr: string | null; emirate: string; logoUrl: string | null; regulator: string };

export type ExportResult = { file: Buffer; filename: string; contentType: string; version: number; exportId: string; problems: number };
export type ExportRequest = { format: ExportFormat; loc: Loc; withIds: boolean; allowIds: boolean; /** The seed passes its own (the letterhead module is request-only). */ letterhead?: Letterhead };

export type Rendered = { file: Buffer; filename: string; contentType: string; version: number; dataSha256: string; fileSha256: string; rowCount: number; problems: number; summary: ReturnData["summary"] };

/** Build the return and render one file, without recording anything. */
export async function renderExport(db: TenantDb, org: Org, actor: Actor, ret: GovReturn, req: ExportRequest, now = new Date()): Promise<Rendered> {
  const kind = ret.kind as ReturnKind;
  if (req.withIds && (!canCarryIds(kind) || req.format === "PDF")) throw new GovError("NO_IDS_HERE");
  if (req.withIds && !req.allowIds) throw new GovError("FORBIDDEN_IDS");
  const data = await buildReturn(db, org.id, specOf(ret));
  const dataSha256 = dataHash(metaOf(ret), data.tables);
  const problems = problemCount(data.problems);
  const version = await versionFor(db, ret.id, dataSha256);
  const loc = req.loc;
  const settings = await loadAdmissionSettings(asTx(db), org.id);
  // The school's own name for its authority applies while the return is for that same authority.
  const current = schoolAuthority(settings.row, org.regulator);
  const own = current.key === ret.authority ? { en: current.labelEn, ar: current.labelAr } : null;
  const authority = authorityText(ret.authority, own, loc);
  const eids = req.withIds ? await eidValues(db, data.tables) : undefined;
  const presence = { present: gt(loc, "present"), missing: gt(loc, "missing") };
  const title = returnTitle(ret, loc);
  const period = await periodText(db, ret, loc);
  let file: Buffer;
  let contentType: string;
  let ext: string;
  let rowCount = data.rowCount;

  if (req.format === "XLSX") {
    const about: Sheet = {
      name: gt(loc, "sheet.about"),
      headers: [[gt("en", "sheet.field"), gt("en", "sheet.value")], [gt("ar", "sheet.field"), gt("ar", "sheet.value")]],
      rows: [
        ...(problems > 0 ? [[gt(loc, "sheet.warning"), gt(loc, "pdf.problemsWarning", { n: problems })]] : []),
        [gt(loc, "sheet.school"), loc === "ar" ? org.nameAr : org.nameEn],
        [gt(loc, "sheet.return"), title],
        [gt(loc, "pdf.authority"), authority],
        [gt(loc, "pdf.period"), period],
        [gt(loc, "pdf.version"), version],
        [gt(loc, "pdf.checksum"), dataSha256],
        [gt(loc, "sheet.generatedBy"), loc === "ar" ? actor.name.ar : actor.name.en],
        [gt(loc, "sheet.generatedAt"), now.toISOString()],
        [gt(loc, "sheet.format"), gt(loc, "pdf.formatNotice", { authority })],
        ...(req.withIds ? [[gt(loc, "sheet.ids"), gt(loc, "sheet.idsNotice")]] : []),
        ...data.gaps.map((g) => [gt(loc, "sheet.gap"), gt(loc, `gap.${g}`)]),
      ],
      warnRows: problems > 0 ? [0] : [],
      rtl: loc === "ar",
    };
    const sheets: Sheet[] = [
      about,
      ...data.tables.map(
        (t): Sheet => ({
          name: loc === "ar" ? t.title.ar : t.title.en,
          headers: [t.columns.map((c) => c.label.en), t.columns.map((c) => c.label.ar)],
          rows: [...t.rows.map((r) => r.map((c) => cellValue(c, loc, eids, presence))), ...(t.note ? [[], [loc === "ar" ? t.note.ar : t.note.en]] : [])],
          boldRows: t.totalRow ? [t.rows.length - 1] : [],
          rtl: loc === "ar",
        }),
      ),
    ];
    file = workbook(sheets);
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    ext = "xlsx";
  } else if (req.format === "CSV") {
    const t = data.tables.find((x) => x.key === CSV_TABLE[kind]) ?? data.tables[0];
    const headers = t.columns.map(bilingualHeader);
    rowCount = t.rows.length;
    file = Buffer.from(toCsv(t.rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, cellValue(r[i], loc, eids, presence)]))), headers), "utf8");
    contentType = "text/csv; charset=utf-8";
    ext = "csv";
  } else {
    const tables = PDF_TABLES[kind].map((k) => data.tables.find((t) => t.key === k)).filter((t): t is Table => Boolean(t));
    const stale = Boolean(ret.signedDataHash && ret.signedDataHash !== dataSha256);
    file = await renderSummaryPdf({
      loc,
      title,
      authority,
      period,
      version,
      dataSha256,
      generatedAt: now,
      generatedBy: loc === "ar" ? actor.name.ar : actor.name.en,
      problems,
      tables,
      signOff: ret.signedOffAt && ret.signedOffName ? await signOffText(db, ret, loc, stale) : null,
      letterhead: req.letterhead ?? (await (await import("@/server/documents/letterhead")).letterheadFor(db, org)),
    });
    contentType = "application/pdf";
    ext = "pdf";
  }

  const fileSha256 = sha256(file);
  const filename = `${org.slug}-${kind.toLowerCase()}-${dateKey(ret.asOf)}-v${version}${loc === "ar" ? "-ar" : ""}${req.withIds ? "-ids" : ""}.${ext}`;
  return { file, filename, contentType, version, dataSha256, fileSha256, rowCount, problems, summary: data.summary };
}

/** Render a file and log it (version, checksums, open problems) with an audit event, in one transaction. */
export async function generateExport(db: TenantDb, org: Org, actor: Actor, ret: GovReturn, req: ExportRequest, now = new Date()): Promise<ExportResult> {
  const kind = ret.kind as ReturnKind;
  const { file, filename, contentType, version, dataSha256, fileSha256, rowCount, problems, summary } = await renderExport(db, org, actor, ret, req, now);
  const loc = req.loc;
  const people = listsPeople(kind) && req.format !== "PDF";
  const row = await tenantTx(org.id, async (tx) => {
    const created = await tx.govReturnExport.create({
      data: { orgId: org.id, returnId: ret.id, version, format: req.format, locale: loc, fileSha256, dataSha256, sizeBytes: file.length, rowCount, problemCount: problems, withIds: req.withIds, summary, generatedById: actor.membershipId, createdAt: now },
    });
    await audit(tx, org.id, {
      actorId: actor.membershipId,
      actorUserId: actor.userId,
      action: problems > 0 ? "government.export_with_problems" : "government.export",
      entityType: "GovReturn",
      entityId: ret.id,
      sensitivity: req.withIds || people ? "CONFIDENTIAL" : "STANDARD",
      meta: { kind, format: req.format, locale: loc, version, fileSha256, problems, withIds: req.withIds, rows: rowCount, exportId: created.id },
    });
    return created;
  });
  return { file, filename, contentType, version, exportId: row.id, problems };
}

export type { ReturnData };
