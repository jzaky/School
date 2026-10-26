// Enroll: turn an accepted application into a student record in one transaction.
//
// 1. Creates the Student (or re-admits a former student the duplicate check found) with an admission number from
//    the school's pattern, the grade, section and homeroom, and the encrypted identifiers copied as they are.
// 2. Guardians: reuses a guardian the school already has (same email, or a sibling's guardian with the same phone
//    and first name), otherwise creates one; links each to the student. Siblings therefore share guardians.
// 3. Health details go to the student's medical record (still encrypted); learning support sets the SEN flag.
// 4. Copies the uploaded documents and the offer letter into the student's documents.
// 5. Family portal: guardians who already have an account see the new child at once; the others get an invitation.
// 6. A government registration record (SPEA DALEEL, MoE Al Manhal, KHDA or ADEK), the history and the audit trail.
import type { AdmissionApplication, Prisma, SchoolCurriculum, Sensitivity } from "@prisma/client";
import type { ExecCtx, Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { queueDirectEmail } from "@/server/notify/direct";
import { bilingualEmail } from "@/server/access/email-text";
import { generateToken, hashToken, inviteExpiry } from "@/server/access/tokens";
import { isEmail } from "@/lib/people-csv";
import { schoolVerified } from "@/server/onboarding/verification";
import { AdmissionError } from "./access";
import { docTypes, type DocCategory } from "./config";
import { parseFlags } from "./dup";
import { recordEvent } from "./events";
import type { GuardianInput } from "./form";
import { admissionsBoth, gradeBoth } from "./labels";
import { nextAdmissionNo } from "./numbers";
import { offerMergeData } from "./pdf";
import { normName } from "./rules";
import { decryptJson, encryptField } from "./secure";
import { emailFamily, type Actor } from "./service";
import { admissionYears, loadSettings } from "./settings";
import { checkMove } from "./stages";
import { OFFER_TEMPLATE_KEY } from "./templates";
import { createRegistration, schoolAuthority } from "./registration";

export type EnrollInput = {
  homeroomClassId: string | null;
  section: string | null;
  /** Re-admit a former student found by the duplicate check instead of creating a new record. */
  linkStudentId: string | null;
  sendInvites: boolean;
};

export type EnrollResult = {
  studentId: string;
  admissionNo: string;
  status: "ACTIVE" | "INACTIVE";
  guardiansCreated: number;
  guardiansReused: number;
  documentsCopied: number;
  invites: Array<{ email: string; token: string; emailed: boolean }>;
  invitesSkipped: "unverified_school" | null;
};

const SENSITIVITY: Record<DocCategory, Sensitivity> = { identity: "CONFIDENTIAL", medical: "MEDICAL", reports: "STANDARD", official_letters: "STANDARD" };
const phoneKey = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-9);

async function findExistingGuardian(tx: Tx, orgId: string, g: GuardianInput, siblingIds: string[]) {
  const byEmail = await tx.guardian.findFirst({ where: { orgId, email: { equals: g.email.trim(), mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
  if (byEmail) return byEmail;
  if (!siblingIds.length) return null;
  // A sibling's guardian with the same phone number and first name is the same person with a new email address.
  const candidates = await tx.guardian.findMany({ where: { orgId, links: { some: { studentId: { in: siblingIds } } } } });
  return candidates.find((c) => phoneKey(c.phone) && phoneKey(c.phone) === phoneKey(g.phone) && normName(c.firstNameEn) === normName(g.firstNameEn)) ?? null;
}

export async function enrollApplication(ec: ExecCtx, actor: Actor, id: string, input: EnrollInput): Promise<EnrollResult> {
  const { tx, orgId, now } = ec;
  const app = await tx.admissionApplication.findFirst({ where: { id, orgId } });
  if (!app) throw new AdmissionError("NOT_FOUND");
  const s = await loadSettings(tx, orgId);
  const fee = app.seatFeeFils ?? (await tx.admissionCapacity.findUnique({ where: { orgId_academicYearId_gradeLevel: { orgId, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel } } }))?.seatFeeFils ?? 0;
  const check = checkMove(app.stage, "ENROLLED", s.stages, { seatFeeRequired: fee > 0 && !s.stages.find((x) => x.key === "SEAT_PAID")?.hidden });
  if (!check.ok) throw new AdmissionError(check.error);
  if (app.studentId) throw new AdmissionError("ALREADY_ENROLLED");

  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  const year = (await admissionYears(tx, orgId)).find((y) => y.id === app.academicYearId) ?? null;
  const yearRow = await tx.academicYear.findUnique({ where: { id: app.academicYearId } });
  if (!yearRow) throw new AdmissionError("YEAR");
  const startsLater = yearRow.startsOn.getTime() > now.getTime();
  const status = startsLater ? "INACTIVE" : "ACTIVE";
  const enrolledOn = startsLater ? yearRow.startsOn : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Homeroom (optional): a homeroom class of that year and grade.
  let homeroom: { id: string; section: string | null } | null = null;
  if (input.homeroomClassId) {
    const c = await tx.schoolClass.findFirst({ where: { id: input.homeroomClassId, orgId, isHomeroom: true, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel }, select: { id: true, section: true } });
    if (!c) throw new AdmissionError("HOMEROOM");
    homeroom = c;
  }
  const section = (homeroom?.section ?? input.section ?? app.offerSection ?? null)?.slice(0, 4) ?? null;
  const curriculum: SchoolCurriculum = (app.curriculum as SchoolCurriculum | null) ?? org.curricula[0] ?? "BRITISH";
  const campus = await tx.campus.findFirst({ where: { orgId }, orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], select: { id: true } });
  const nationality = app.nationality ? { en: countryLabel(app.nationality, "en"), ar: countryLabel(app.nationality, "ar") } : null;
  const support = decryptJson<{ needed?: boolean }>(app.supportEnc);

  // 1. Student
  let studentId: string;
  let admissionNo: string;
  const studentData = {
    firstNameEn: app.firstNameEn,
    lastNameEn: app.lastNameEn,
    firstNameAr: app.firstNameAr || app.firstNameEn,
    lastNameAr: app.lastNameAr || app.lastNameEn,
    gradeLevel: app.gradeLevel,
    section,
    dateOfBirth: app.dateOfBirth,
    gender: app.gender,
    nationalityEn: nationality?.en ?? null,
    nationalityAr: nationality?.ar ?? null,
    emiratesIdEnc: app.emiratesIdEnc,
    emiratesIdLast4: app.emiratesIdLast4,
    passportEnc: app.passportEnc,
    passportLast4: app.passportLast4,
    status: status as "ACTIVE" | "INACTIVE",
    enrolledOn,
    curriculum,
    hasSen: Boolean(support?.needed) || app.hasSupport,
    campusId: campus?.id ?? null,
  } satisfies Prisma.StudentUncheckedUpdateInput;
  if (input.linkStudentId) {
    const allowed = parseFlags(app.duplicateFlags).some((f) => f.target === "student" && f.id === input.linkStudentId);
    const former = allowed ? await tx.student.findFirst({ where: { id: input.linkStudentId, orgId } }) : null;
    if (!former) throw new AdmissionError("LINK_STUDENT");
    if (former.status === "ACTIVE") throw new AdmissionError("STUDENT_ACTIVE");
    await tx.student.update({ where: { id: former.id }, data: studentData });
    studentId = former.id;
    admissionNo = former.studentNo;
  } else {
    admissionNo = await nextAdmissionNo(tx, orgId, s.pattern, { year: year?.entryYear ?? now.getUTCFullYear(), short: org.shortNameEn ?? org.nameEn });
    const created = await tx.student.create({ data: { orgId, studentNo: admissionNo, ...studentData } });
    studentId = created.id;
  }
  if (homeroom) await tx.enrollment.createMany({ data: [{ orgId, studentId, classId: homeroom.id, status: "ACTIVE" }], skipDuplicates: true });

  // 2. Health: copied encrypted, field by field, into the medical record.
  const medical = decryptJson<{ allergies?: string; conditions?: string; medications?: string }>(app.medicalEnc);
  if (medical && (medical.allergies || medical.conditions || medical.medications)) {
    const enc = (v?: string) => (v ? encryptField(v) : null);
    const row = { allergiesEnc: enc(medical.allergies), conditionsEnc: enc(medical.conditions), medicationsEnc: enc(medical.medications), hasAlert: Boolean(medical.allergies || medical.conditions) };
    await tx.studentMedical.upsert({ where: { studentId }, create: { orgId, studentId, ...row }, update: row });
  }

  // 3. Guardians: reuse or create, then link.
  const guardians = ((app.guardians as GuardianInput[] | null) ?? []).filter((g) => g.firstNameEn && g.email);
  let created = 0;
  let reused = 0;
  const guardianIds: string[] = [];
  for (const g of guardians) {
    const existing = await findExistingGuardian(tx, orgId, g, app.siblingStudentIds);
    let gid: string;
    if (existing) {
      gid = existing.id;
      reused++;
      if (!existing.phone && g.phone) await tx.guardian.update({ where: { id: existing.id }, data: { phone: g.phone } });
    } else {
      const row = await tx.guardian.create({
        data: {
          orgId,
          firstNameEn: g.firstNameEn,
          lastNameEn: g.lastNameEn,
          firstNameAr: g.firstNameAr || g.firstNameEn,
          lastNameAr: g.lastNameAr || g.lastNameEn,
          email: g.email.trim().toLowerCase(),
          phone: g.phone,
          occupation: g.occupation || null,
          preferredLoc: "en",
        },
      });
      gid = row.id;
      created++;
    }
    guardianIds.push(gid);
    const rel = admissionsBoth(`relationship.${g.relationship}`);
    await tx.guardianLink.upsert({
      where: { guardianId_studentId: { guardianId: gid, studentId } },
      create: { orgId, guardianId: gid, studentId, relationshipEn: rel.en, relationshipAr: rel.ar, isPrimary: g.primary, livesWith: g.livesWith, canApprove: true, receivesUpdates: true },
      update: { relationshipEn: rel.en, relationshipAr: rel.ar, isPrimary: g.primary, livesWith: g.livesWith },
    });
  }

  // 4. Documents: each uploaded file (not rejected) and the offer letter go into the student's record.
  const types = docTypes(s.row?.documentTypes ?? null);
  const categories = new Map((await tx.documentCategory.findMany({ where: { orgId }, select: { id: true, key: true } })).map((c) => [c.key, c.id]));
  const uploads = await tx.admissionDocument.findMany({ where: { orgId, applicationId: app.id, status: { not: "REJECTED" } }, orderBy: { createdAt: "asc" } });
  let copied = 0;
  for (const d of uploads) {
    const type = types.find((t) => t.key === d.typeKey);
    const category: DocCategory = type?.category ?? "identity";
    const doc = await tx.document.create({
      data: {
        orgId,
        categoryId: categories.get(category === "identity" ? "identity" : category === "medical" ? "medical" : category === "reports" ? "reports" : "official_letters") ?? null,
        titleEn: type?.labelEn ?? d.typeKey,
        titleAr: type?.labelAr ?? d.typeKey,
        studentId,
        sensitivity: SENSITIVITY[category],
        source: "UPLOAD",
        uploadedById: actor.membershipId,
        visibleToFamily: true,
        createdAt: d.createdAt,
      },
    });
    const v = await tx.documentVersion.create({ data: { orgId, documentId: doc.id, version: 1, storageKey: d.storageKey, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, checksum: d.checksum, createdById: actor.membershipId, createdAt: d.createdAt } });
    await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: v.id } });
    copied++;
  }
  const offerTemplate = await tx.documentTemplate.findUnique({ where: { orgId_key: { orgId, key: OFFER_TEMPLATE_KEY } } });
  if (offerTemplate && app.offerMadeAt) {
    const merge = await offerMergeData(tx, orgId, app);
    const doc = await tx.document.create({
      data: { orgId, categoryId: categories.get("official_letters") ?? null, titleEn: offerTemplate.nameEn, titleAr: offerTemplate.nameAr, studentId, sensitivity: "STANDARD", source: "GENERATED", templateId: offerTemplate.id, uploadedById: actor.membershipId, visibleToFamily: true, createdAt: app.offerMadeAt },
    });
    const v = await tx.documentVersion.create({ data: { orgId, documentId: doc.id, version: 1, storageKey: `render:${OFFER_TEMPLATE_KEY}`, fileName: `offer-${app.number}.pdf`, mimeType: "application/pdf", sizeBytes: 0, renderData: merge as never, output: "BILINGUAL", createdById: actor.membershipId, createdAt: app.offerMadeAt } });
    await tx.document.update({ where: { id: doc.id }, data: { currentVersionId: v.id } });
    copied++;
  }

  // 5. Family portal invitations for guardians without an account (each invitation covers all their children).
  const invites: EnrollResult["invites"] = [];
  let invitesSkipped: EnrollResult["invitesSkipped"] = null;
  if (input.sendInvites) {
    if (!(await schoolVerified({ id: org.id, createdById: org.createdById }))) invitesSkipped = "unverified_school";
    else {
      const inviter = await tx.membership.findUnique({ where: { id: actor.membershipId }, select: { user: { select: { nameEn: true, nameAr: true } } } });
      const from = { en: inviter?.user.nameEn ?? "", ar: inviter?.user.nameAr || inviter?.user.nameEn || "" };
      const rows = await tx.guardian.findMany({ where: { id: { in: guardianIds }, membershipId: null }, select: { id: true, email: true, firstNameEn: true, lastNameEn: true, links: { select: { studentId: true } } } });
      for (const g of rows) {
        const email = (g.email ?? "").trim().toLowerCase();
        if (!isEmail(email)) continue;
        // One open invitation per address: older unused ones stop working.
        await tx.invitation.updateMany({ where: { orgId, kind: "PARENT", email, revokedAt: null, uses: 0, expiresAt: { gt: now } }, data: { revokedAt: now } });
        const token = generateToken();
        const inv = await tx.invitation.create({
          data: { orgId, kind: "PARENT", email, nameEn: `${g.firstNameEn} ${g.lastNameEn}`.trim(), roleKeys: ["parent"], studentIds: g.links.map((l) => l.studentId), tokenHash: hashToken(token), expiresAt: inviteExpiry(now), createdById: actor.membershipId, lastSentAt: now },
        });
        const mail = bilingualEmail("inviteSubject", "inviteBody_parent", { school: { en: org.nameEn, ar: org.nameAr }, inviter: from, days: 14 }, org.defaultLocale);
        const emailed = await queueDirectEmail(
          { ...ec, quiet: ec.quiet || org.isDemo },
          { to: email, templateKey: "invite_parent", subject: mail.subject, body: mail.body, href: `/join/${token}`, locale: org.defaultLocale, idempotencyKey: `invite:${inv.id}:1` },
        );
        await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "invite.create", entityType: "Invitation", entityId: inv.id, meta: { kind: "PARENT", children: g.links.length, source: "admissions" } });
        invites.push({ email, token, emailed: emailed && !org.isDemo });
      }
    }
  }

  // 6. Government registration (for example SPEA DALEEL): staff submit it and record the authority's decision.
  const authority = schoolAuthority(s.row, org.regulator);
  await createRegistration(tx, orgId, { studentId, kind: "ENROLLMENT", authority: authority.key, applicationId: app.id, at: now });

  await tx.admissionApplication.update({ where: { id: app.id }, data: { stage: "ENROLLED", stageChangedAt: now, studentId, enrolledAt: now } });
  const meta = { studentId, readmitted: Boolean(input.linkStudentId), status, guardiansCreated: created, guardiansReused: reused, documents: copied, invitations: invites.length, homeroom: Boolean(homeroom) };
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "enrolled", fromStage: app.stage, toStage: "ENROLLED", actorMembershipId: actor.membershipId, data: meta, at: now });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: input.linkStudentId ? "student.readmit" : "student.create", entityType: "Student", entityId: studentId, meta: { source: "admissions", applicationId: app.id } });
  await audit(tx, orgId, { actorId: actor.membershipId, actorUserId: actor.userId, action: "admission.enroll", entityType: "AdmissionApplication", entityId: app.id, meta });
  await emailFamily(ec, app, "enrolled", { grade: gradeBoth(app.gradeLevel), year: { en: yearRow.nameEn, ar: yearRow.nameAr } }, `adm:${app.id}:enrolled`);
  return { studentId, admissionNo, status, guardiansCreated: created, guardiansReused: reused, documentsCopied: copied, invites, invitesSkipped };
}

function countryLabel(code: string, locale: "en" | "ar") {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export type { AdmissionApplication };
