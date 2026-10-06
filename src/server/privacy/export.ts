// One-person data export (PDPL right of access): a ZIP with a bilingual summary PDF, JSON and one CSV
// per area, and the person's stored files. Sensitive content goes through the case access module
// (subjectExportDecision); anything not released is counted in withheld.csv with the reason.
import type { DsrType, Sensitivity } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { SENSITIVE, subjectExportDecision, type ExportDecision, type ExportWithheldReason } from "@/server/access/case-access";
import { audit } from "@/server/audit/audit";
import { getObject, isStoredKey } from "@/server/documents/storage-core";
import { createZip, type ZipEntry } from "@/lib/zip";
import { toCsv } from "@/lib/csv-out";
import { decryptField } from "@/lib/crypto";
import { collectSubjectRows, resolveSubject, scrubRow, type Subject, type SubjectRef } from "./subject";
import { renderSubjectSummaryPdf } from "./summary-pdf";
import { exportLabel } from "./labels";

type Row = Record<string, unknown>;

export type WithheldEntry = { model: string; reason: ExportWithheldReason; count: number };
export type SubjectExportResult = {
  zip: Buffer;
  fileName: string;
  subject: Subject;
  areas: Array<{ model: string; count: number }>;
  files: Array<{ path: string; bytes: number }>;
  missingFiles: number;
  withheld: WithheldEntry[];
  /** Exported rows by model (already scrubbed), for tests and the audit summary. */
  data: Record<string, Row[]>;
};

export class ExportError extends Error {
  constructor(public code: "NOT_FOUND" | "DSR_MISMATCH") {
    super(code);
  }
}

/** Does this request (DSR) concern this person? */
export function dsrMatchesSubject(dsr: { studentId: string | null; guardianId: string | null; membershipId: string | null }, subject: Pick<Subject, "kind" | "id">) {
  if (subject.kind === "student") return dsr.studentId === subject.id;
  if (subject.kind === "guardian") return dsr.guardianId === subject.id;
  return dsr.membershipId === subject.id;
}

/** Medical notes are stored encrypted; a released medical record carries the readable text. */
function readableMedical(r: Row): Row {
  const out = scrubRow(r);
  for (const k of ["allergies", "conditions", "medications"]) {
    const enc = r[`${k}Enc`];
    if (typeof enc !== "string" || !enc) continue;
    try {
      out[k] = decryptField(enc);
    } catch {
      out[k] = null;
    }
  }
  return out;
}

const fileSafe =(s: string) => s.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "file";

export async function buildSubjectExport(ctx: Ctx, ref: SubjectRef, opts: { dsrId?: string | null; now?: Date } = {}): Promise<SubjectExportResult> {
  const { db, orgId } = ctx;
  const now = opts.now ?? new Date();
  const subject = await resolveSubject(db, orgId, ref);
  if (!subject) throw new ExportError("NOT_FOUND");
  const dsr = opts.dsrId ? await db.dataSubjectRequest.findFirst({ where: { id: opts.dsrId, orgId } }) : null;
  if (opts.dsrId && !dsr) throw new ExportError("NOT_FOUND");
  if (dsr && !dsrMatchesSubject(dsr, subject)) throw new ExportError("DSR_MISMATCH");
  const requestType: DsrType | null = dsr?.type ?? null;

  const rows = await collectSubjectRows(db, orgId, subject);
  const withheld = new Map<string, WithheldEntry>();
  const hold = (model: string, reason: ExportWithheldReason, n = 1) => {
    if (n <= 0) return;
    const key = `${model}|${reason}`;
    const cur = withheld.get(key) ?? { model, reason, count: 0 };
    cur.count += n;
    withheld.set(key, cur);
  };

  // Case decisions, made once per case through the access module (audited for sensitive cases).
  const caseIds = new Set<string>();
  for (const [model, list] of rows) for (const r of list) {
    if (model === "Case") caseIds.add(r.id as string);
    else if (typeof r.caseId === "string") caseIds.add(r.caseId);
  }
  const cases = caseIds.size ? await db.case.findMany({ where: { orgId, id: { in: [...caseIds] } } }) : [];
  const caseDecision = new Map<string, ExportDecision>();
  for (const c of cases) caseDecision.set(c.id, await subjectExportDecision(ctx, { requestType, sensitivity: c.sensitivity, caseRow: c }));
  const bySensitivity = new Map<string, ExportDecision>();
  const sensitivityDecision = async (s: Sensitivity) => {
    if (!bySensitivity.has(s)) bySensitivity.set(s, await subjectExportDecision(ctx, { requestType, sensitivity: s }));
    return bySensitivity.get(s)!;
  };

  const data: Record<string, Row[]> = {};
  const keep = (model: string, r: Row) => (data[model] ??= []).push(model === "StudentMedical" ? readableMedical(r) : scrubRow(r));
  const sensitiveCase = new Set(cases.filter((c) => SENSITIVE.includes(c.sensitivity)).map((c) => c.id));
  for (const [model, list] of rows) {
    for (const r of list) {
      let decision: ExportDecision = { include: true };
      let sensitive = false;
      if (model === "Case" || typeof r.caseId === "string") {
        const caseId = model === "Case" ? (r.id as string) : (r.caseId as string);
        decision = caseDecision.get(caseId) ?? { include: false, reason: "no_access" };
        sensitive = sensitiveCase.has(caseId);
      } else if (model === "StudentMedical") {
        decision = await sensitivityDecision("MEDICAL");
        sensitive = true;
      } else if (typeof r.sensitivity === "string" && (SENSITIVE.includes(r.sensitivity as Sensitivity) || r.sensitivity === "MEDICAL")) {
        decision = await sensitivityDecision(r.sensitivity as Sensitivity);
        sensitive = true;
      } else if (subject.kind === "staff" && model === "AiInteraction") decision = { include: false, reason: "third_party" };
      if (decision.include) keep(model, r);
      // Withheld sensitive records are counted together, so the export never says what kind they are.
      else hold(sensitive ? "Restricted" : model, decision.reason);
    }
  }

  // Case notes (current version) for the cases that were released.
  const released = (data.Case ?? []).map((c) => c.id as string);
  if (released.length) {
    const notes = await db.caseNote.findMany({ where: { orgId, caseId: { in: released } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { occurredAt: "asc" } });
    data.CaseNote = notes.map((n) => scrubRow({ id: n.id, caseId: n.caseId, kind: n.kind, occurredAt: n.occurredAt, version: n.currentVersion, body: n.versions[0]?.body ?? "" }));
  }
  // Child rows of exported parents.
  const docIds = (data.Document ?? []).map((d) => d.id as string);
  const versions = docIds.length ? await db.documentVersion.findMany({ where: { orgId, documentId: { in: docIds } }, orderBy: [{ documentId: "asc" }, { version: "asc" }] }) : [];
  if (versions.length) data.DocumentVersion = versions.map((v) => scrubRow({ ...v, storageKey: undefined, stored: isStoredKey(v.storageKey) }));
  const appIds = (data.Application ?? []).map((a) => a.id as string);
  if (appIds.length) {
    const reqs = await db.applicationRequirement.findMany({ where: { orgId, applicationId: { in: appIds } } });
    if (reqs.length) data.ApplicationRequirement = reqs.map(scrubRow);
  }
  const planIds = (data.StudentCoursePlan ?? []).map((p) => p.id as string);
  if (planIds.length) {
    const items = await db.studentCoursePlanItem.findMany({ where: { orgId, planId: { in: planIds } } });
    if (items.length) data.StudentCoursePlanItem = items.map(scrubRow);
  }

  // The person's own record and account details.
  const profile: Row[] = [];
  const details: Array<{ key: string; value: string }> = [];
  if (subject.kind === "student") {
    const s = await db.student.findFirstOrThrow({ where: { id: subject.id, orgId } });
    profile.push(scrubRow(s));
    details.push({ key: "studentNo", value: s.studentNo }, { key: "grade", value: String(s.gradeLevel) });
    if (s.dateOfBirth) details.push({ key: "dateOfBirth", value: s.dateOfBirth.toISOString().slice(0, 10) });
    if (s.emiratesIdLast4) details.push({ key: "emiratesId", value: `**** ${s.emiratesIdLast4}` });
    const links = await db.guardianLink.findMany({ where: { orgId, studentId: s.id }, include: { guardian: true } });
    for (const l of links) details.push({ key: "guardian", value: `${l.guardian.firstNameEn} ${l.guardian.lastNameEn}` });
  } else if (subject.kind === "guardian") {
    const g = await db.guardian.findFirstOrThrow({ where: { id: subject.id, orgId } });
    profile.push(scrubRow(g));
    if (g.email) details.push({ key: "email", value: g.email });
    if (g.phone) details.push({ key: "phone", value: g.phone });
  }
  if (subject.membershipId) {
    const m = await db.membership.findFirst({ where: { id: subject.membershipId, orgId }, include: { user: true, roles: { include: { role: true } } } });
    if (m) {
      data.Membership = [scrubRow({ id: m.id, status: m.status, titleEn: m.titleEn, titleAr: m.titleAr, locale: m.locale, lastSeenAt: m.lastSeenAt, createdAt: m.createdAt, roles: m.roles.map((r) => r.role.key).join(" ") })];
      data.User = [{ email: m.user.email, nameEn: m.user.nameEn, nameAr: m.user.nameAr, locale: m.user.locale, createdAt: m.user.createdAt }];
      if (subject.kind === "staff") details.push({ key: "email", value: m.user.email });
      // What the person did in the app (actions and times only, no record content).
      const events = await db.auditEvent.findMany({ where: { orgId, actorId: m.id }, orderBy: { createdAt: "desc" }, take: 2000, select: { action: true, entityType: true, createdAt: true } });
      if (events.length) data.AuditEvent = events;
    }
  }
  if (profile.length) data[subject.kind === "student" ? "Student" : "Guardian"] = profile;
  if (dsr) data.DataSubjectRequest = [scrubRow(dsr)];

  // Staff: records they wrote or handled about other people are not their personal data.
  if (subject.kind === "staff") {
    const [notes, assigned, hosted] = await Promise.all([
      db.caseNote.count({ where: { orgId, authorId: subject.id } }),
      db.case.count({ where: { orgId, assigneeId: subject.id } }),
      db.appointment.count({ where: { orgId, hostId: subject.id } }),
    ]);
    hold("CaseNote", "third_party", notes);
    hold("Case", "third_party", assigned);
    hold("Appointment", "third_party", hosted);
  }

  // Stored files of released documents.
  const files: Array<{ path: string; bytes: number }> = [];
  const fileEntries: ZipEntry[] = [];
  let missingFiles = 0;
  const docTitle = new Map((data.Document ?? []).map((d) => [d.id as string, String(d.titleEn ?? "document")]));
  for (const v of versions) {
    if (!isStoredKey(v.storageKey)) continue;
    const body = await getObject(v.storageKey);
    if (!body) {
      missingFiles++;
      continue;
    }
    const path = `files/${fileSafe(docTitle.get(v.documentId) ?? "document")}-v${v.version}-${fileSafe(v.fileName)}`;
    files.push({ path, bytes: body.length });
    fileEntries.push({ name: path, data: body, date: v.createdAt });
  }
  if (subject.kind === "student") {
    const s = await db.student.findFirst({ where: { id: subject.id, orgId }, select: { photoUrl: true } });
    if (s?.photoUrl && isStoredKey(s.photoUrl)) {
      const body = await getObject(s.photoUrl);
      if (body) {
        files.push({ path: "files/photo", bytes: body.length });
        fileEntries.push({ name: "files/photo", data: body });
      }
    }
  }

  const areas = Object.entries(data)
    .map(([model, list]) => ({ model, count: list.length }))
    .sort((a, b) => a.model.localeCompare(b.model));
  const withheldList = [...withheld.values()].sort((a, b) => a.model.localeCompare(b.model) || a.reason.localeCompare(b.reason));

  const pdf = await renderSubjectSummaryPdf({
    school: { en: ctx.org.nameEn, ar: ctx.org.nameAr },
    subjectName: subject.name,
    kind: subject.kind,
    reference: subject.reference,
    request: dsr ? { number: dsr.number, type: dsr.type } : null,
    generatedAt: now,
    details,
    areas,
    files: files.length,
    withheld: withheldList,
  });

  const manifest = {
    generatedAt: now.toISOString(),
    school: ctx.org.slug,
    subject: { kind: subject.kind, id: subject.id, reference: subject.reference },
    request: dsr ? { number: dsr.number, type: dsr.type } : null,
    areas,
    files: files.map((f) => f.path),
    missingFiles,
    withheld: withheldList.map((w) => ({ ...w, explanation: exportLabel("en", `reason.${w.reason}`) })),
  };
  const entries: ZipEntry[] = [
    { name: "summary.pdf", data: pdf, date: now },
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2), date: now },
    { name: "data.json", data: JSON.stringify(data, null, 2), date: now },
    ...Object.entries(data).map(([model, list]) => ({ name: `csv/${model}.csv`, data: toCsv(list), date: now })),
    {
      name: "withheld.csv",
      data: toCsv(
        withheldList.map((w) => ({ area: w.model, count: w.count, reason: w.reason, explanation_en: exportLabel("en", `reason.${w.reason}`), explanation_ar: exportLabel("ar", `reason.${w.reason}`) })),
        ["area", "count", "reason", "explanation_en", "explanation_ar"],
      ),
      date: now,
    },
    ...fileEntries,
  ];
  const zip = createZip(entries);

  await audit(db, orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: "dsr.export",
    entityType: subject.kind === "student" ? "Student" : subject.kind === "guardian" ? "Guardian" : "Membership",
    entityId: subject.id,
    sensitivity: "CONFIDENTIAL",
    meta: { dsr: dsr?.number ?? null, requestType, areas: areas.length, rows: areas.reduce((s, a) => s + a.count, 0), files: files.length, withheld: withheldList.map((w) => `${w.model}:${w.reason}:${w.count}`) },
  });

  return {
    zip,
    fileName: `data-export-${fileSafe(subject.reference)}-${now.toISOString().slice(0, 10)}.zip`,
    subject,
    areas,
    files,
    missingFiles,
    withheld: withheldList,
    data,
  };
}
