// Demo data for government reporting at Horizon (a fictional school in Dubai, so its authority is KHDA):
// - registration references for students enrolled before Horizon recorded them (two recent joiners are left
//   without one, and one of them has no nationality and the other no Emirates ID on file, so the draft census has
//   a few problems to fix);
// - an end of year census submitted last term: signed off by the principal, exported, and sent with a reference;
// - a draft census for the upcoming census date, and a calendar of due dates with reminders already sent.
// All dates are relative to now. Files are rendered for real, so their checksums are true. Safe to re-run: the
// tenant is wiped before the demo seed.
import { createHash } from "node:crypto";
import type { SeedWorld } from "../demo";
import { dateOnly, at } from "../lib";
import { encryptField } from "@/lib/crypto";
import { tenantDb } from "@/lib/tenant-db";
import { renderExport } from "@/server/govreports/export";
import { buildReturn } from "@/server/govreports/build";
import { dataHash } from "@/server/govreports/table";
import { metaOf, specOf } from "@/server/govreports/export";
import { runGovReminders } from "@/server/govreports/reminders";

const DAY = 86_400_000;

/** A made-up Emirates ID for a fictional student: 784, the birth year, seven digits from the student number, a Luhn check digit. */
function fictionalEid(studentNo: string, dob: Date | null) {
  const year = String(dob ? dob.getUTCFullYear() : 2012);
  const body = String(parseInt(createHash("sha1").update(studentNo).digest("hex").slice(0, 8), 16) % 10_000_000).padStart(7, "0");
  const partial = `784${year}${body}`;
  let sum = 0;
  for (let i = 0; i < partial.length; i++) {
    let d = Number(partial[partial.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return `${partial}${(10 - (sum % 10)) % 10}`;
}

export async function seedGovReporting(w: SeedWorld) {
  const { db, orgId, now, log } = w;
  const registrar = w.personas.registrar;
  const principal = w.personas.principal;
  if (!registrar || !principal) {
    log("government: personas missing, skipped");
    return;
  }

  // --- Authority: KHDA (the demo school is in Dubai) ----------------------------------------------------------
  await db.admissionSettings.upsert({ where: { orgId }, update: { authority: "KHDA", authorityLabelEn: null, authorityLabelAr: null }, create: { orgId, authority: "KHDA" } });

  // --- Registration references for students enrolled before admissions were recorded in Horizon ----------------
  const year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, select: { startsOn: true } });
  const students = await db.student.findMany({ where: { orgId, status: { in: ["ACTIVE", "WITHDRAWN"] } }, select: { id: true, studentNo: true, enrolledOn: true, status: true, membershipId: true }, orderBy: { studentNo: "asc" } });
  const registered = new Set((await db.govRegistration.findMany({ where: { orgId, kind: "ENROLLMENT" }, select: { studentId: true } })).map((r) => r.studentId));
  const personaStudents = new Set([w.adam.id, w.yara.id]);
  // Two students who joined this school year with nothing recorded with KHDA yet: the draft census flags them.
  const recent = students.filter((s) => s.status === "ACTIVE" && !registered.has(s.id) && !personaStudents.has(s.id) && year && s.enrolledOn && s.enrolledOn >= year.startsOn && s.enrolledOn <= now);
  const unregistered = recent.slice(0, 2).map((s) => s.id);
  let seq = 4100;
  const rows = students
    .filter((s) => !registered.has(s.id) && !unregistered.includes(s.id))
    .map((s) => {
      const joined = s.enrolledOn && s.enrolledOn < now ? s.enrolledOn : new Date(now.getTime() - 400 * DAY);
      const y = new Date(joined.getTime() + 4 * 3600_000).getUTCFullYear();
      seq += 7;
      return { orgId, studentId: s.id, kind: "ENROLLMENT", authority: "KHDA", status: "APPROVED", reference: `REG-${y}-0${seq}`, submittedAt: new Date(joined.getTime() + 2 * DAY), decidedAt: new Date(joined.getTime() + 6 * DAY), updatedById: registrar, createdAt: new Date(joined.getTime() + DAY) };
    });
  if (rows.length) await db.govRegistration.createMany({ data: rows });
  // Leavers created by the admissions demo have no Emirates ID on file; they were on roll at last term's census.
  const noEid = await db.student.findMany({ where: { orgId, emiratesIdEnc: null, status: { in: ["ACTIVE", "WITHDRAWN"] }, id: { notIn: unregistered } }, select: { id: true, studentNo: true, dateOfBirth: true } });
  for (const s of noEid) {
    const digits = fictionalEid(s.studentNo, s.dateOfBirth);
    await db.student.update({ where: { id: s.id }, data: { emiratesIdEnc: encryptField(digits), emiratesIdLast4: digits.slice(-4) } });
  }
  // The same two joiners: one has no nationality on file, the other no Emirates ID.
  if (unregistered[0]) await db.student.update({ where: { id: unregistered[0] }, data: { emiratesIdEnc: null, emiratesIdLast4: null } });
  if (unregistered[1]) await db.student.update({ where: { id: unregistered[1] }, data: { nationalityEn: null, nationalityAr: null } });

  // --- Due dates ---------------------------------------------------------------------------------------------
  const due = async (titleEn: string, titleAr: string, kind: string, days: number, notes: string | null, done?: number) =>
    db.govDueDate.create({ data: { orgId, titleEn, titleAr, kind, dueOn: dateOnly(days, now), notes, doneAt: done !== undefined ? at(done, 11, 0, now) : null, createdById: registrar, createdAt: at(-160, 9, 0, now) } });
  const pastCensusDue = await due("End of year census", "إحصاء نهاية العام", "CENSUS", -146, null, -146);
  const censusDue = await due("Autumn student census", "إحصاء الطلبة لفصل الخريف", "CENSUS", 12, null);
  await due("Learner registration update", "تحديث تسجيل المتعلمين", "REGISTRATION", 3, null);
  await due("Autumn term attendance return", "تقرير الحضور لفصل الخريف", "ATTENDANCE", 52, null);
  await due("Internal assessment results, autumn term", "نتائج التقييمات الداخلية لفصل الخريف", "RESULTS", 58, null);
  await due("Staff data return", "تقرير بيانات الكادر", "STAFF", 75, null);

  // --- An end of year census submitted last term -------------------------------------------------------------
  const tdb = tenantDb(orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const names = async (m: string) => {
    const u = await db.membership.findUniqueOrThrow({ where: { id: m }, select: { userId: true, user: { select: { nameEn: true, nameAr: true } } } });
    return { membershipId: m, userId: u.userId, name: { en: u.user.nameEn, ar: u.user.nameAr || u.user.nameEn } };
  };
  const mona = await names(registrar);
  const omar = await names(principal);
  const censusDay = dateOnly(-148, now);
  const past = await db.govReturn.create({ data: { orgId, kind: "CENSUS", authority: "KHDA", asOf: censusDay, periodFrom: dateOnly(-148 - 273, now), label: null, dueDateId: pastCensusDue.id, createdById: registrar, createdAt: at(-153, 10, 0, now) } });
  const pastData = await buildReturn(tdb, orgId, specOf(past));
  const pastHash = dataHash(metaOf(past), pastData.tables);
  const principalTitle = await db.membership.findUniqueOrThrow({ where: { id: principal }, select: { titleEn: true, staffProfile: { select: { jobTitleEn: true } } } });
  await db.govReturn.update({ where: { id: past.id }, data: { signedOffById: principal, signedOffName: omar.name.en, signedOffTitle: principalTitle.titleEn || principalTitle.staffProfile?.jobTitleEn || "Principal", signedOffAt: at(-147, 13, 30, now), signedDataHash: pastHash, signedVersion: 1, status: "SIGNED_OFF" } });
  const signed = await db.govReturn.findUniqueOrThrow({ where: { id: past.id } });
  const record = async (format: "XLSX" | "PDF", when: Date) => {
    const letterhead = { school: { en: org.nameEn, ar: org.nameAr }, shortEn: org.shortNameEn || org.nameEn, emirate: { en: org.emirate, ar: "دبي" }, address: { en: `${org.emirate}, United Arab Emirates`, ar: "دبي، الإمارات العربية المتحدة" }, logo: null };
    const f = await renderExport(tdb, org, mona, signed, { format, loc: "en", withIds: false, allowIds: false, letterhead }, when);
    const row = await db.govReturnExport.create({ data: { orgId, returnId: past.id, version: f.version, format, locale: "en", fileSha256: f.fileSha256, dataSha256: f.dataSha256, sizeBytes: f.file.length, rowCount: f.rowCount, problemCount: f.problems, withIds: false, summary: f.summary, generatedById: registrar, createdAt: when } });
    await db.auditEvent.create({ data: { orgId, actorId: registrar, actorUserId: mona.userId, action: f.problems > 0 ? "government.export_with_problems" : "government.export", entityType: "GovReturn", entityId: past.id, sensitivity: "STANDARD", meta: { kind: "CENSUS", format, locale: "en", version: f.version, fileSha256: f.fileSha256, problems: f.problems, withIds: false, rows: f.rowCount, exportId: row.id }, createdAt: when } });
    return row;
  };
  const xlsx = await record("XLSX", at(-147, 9, 15, now));
  await record("PDF", at(-147, 14, 0, now));
  await db.govSubmission.create({ data: { orgId, returnId: past.id, exportId: xlsx.id, submittedOn: dateOnly(-146, now), reference: "CNS-2026-04127", note: null, recordedById: registrar, createdAt: at(-146, 12, 10, now) } });
  await db.govReturn.update({ where: { id: past.id }, data: { status: "SUBMITTED" } });
  await db.auditEvent.createMany({
    data: [
      { orgId, actorId: registrar, actorUserId: mona.userId, action: "government.return_create", entityType: "GovReturn", entityId: past.id, meta: { kind: "CENSUS" }, createdAt: at(-153, 10, 0, now) },
      { orgId, actorId: principal, actorUserId: omar.userId, action: "government.sign_off", entityType: "GovReturn", entityId: past.id, meta: { kind: "CENSUS", version: 1, dataSha256: pastHash }, createdAt: at(-147, 13, 30, now) },
      { orgId, actorId: registrar, actorUserId: mona.userId, action: "government.submission", entityType: "GovReturn", entityId: past.id, meta: { kind: "CENSUS", version: 1, fileSha256: xlsx.fileSha256, hasReference: true }, createdAt: at(-146, 12, 10, now) },
    ],
  });

  // --- The draft census for the upcoming census date (with the problems above to fix) ---------------------------
  const draft = await db.govReturn.create({ data: { orgId, kind: "CENSUS", authority: "KHDA", asOf: censusDue.dueOn, periodFrom: null, label: null, dueDateId: censusDue.id, createdById: registrar, createdAt: at(-2, 10, 20, now) } });
  await db.auditEvent.create({ data: { orgId, actorId: registrar, actorUserId: mona.userId, action: "government.return_create", entityType: "GovReturn", entityId: draft.id, meta: { kind: "CENSUS" }, createdAt: at(-2, 10, 20, now) } });

  // Reminders already due (the census in 12 days, the registration update in 3): in-app, recorded without sending.
  const sent = await runGovReminders(orgId, { now, quiet: true, flush: async () => undefined });
  log(`government: ${rows.length} registration references, ${unregistered.length} students left to fix, 1 submitted and 1 draft census, ${sent.sent} reminders`);
}
