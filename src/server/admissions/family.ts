// The family side of an application: start, save each step, submit, answer an offer, message the school, withdraw.
// Every function takes the school id (from the public page's slug) and the signed-in family account, and every
// query filters on applicantUserId: a family can only ever read or change its own applications.
import type { AdmissionApplication, Prisma } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { ALL_GRADE_LEVELS } from "@/lib/grade-levels";
import { AdmissionError } from "./access";
import { missingDocs } from "./config";
import { findDuplicates, matchSiblings } from "./dup";
import { mailFamily } from "./email";
import { notifyTeam, recordEvent } from "./events";
import { familySchema, hasMedicalInfo, healthSchema, schoolingSchema, studentSchema, type FamilyStep, type HealthStep, type SchoolingStep, type StudentStep } from "./form";
import { childNameBoth, dateBoth, gradeBoth } from "./labels";
import { nextApplicationNo } from "./numbers";
import { eidDigits, nameDobKey } from "./rules";
import { decryptJson, decryptText, eidHash, encryptField, encryptJson } from "./secure";
import { capacityRows, entryYearOf, gradesOffered, loadSettings, openYears } from "./settings";
import { familyCan } from "./stages";

export type Family = { userId: string; email: string; locale: "en" | "ar"; quiet: boolean };

export const MESSAGE_MAX = 2000;

const appHref = (slug: string, id: string) => `/apply/${slug}/${id}`;

async function own(tx: Prisma.TransactionClient, orgId: string, userId: string, id: string) {
  const app = await tx.admissionApplication.findFirst({ where: { id, orgId, applicantUserId: userId } });
  if (!app) throw new AdmissionError("NOT_FOUND");
  return app;
}

/** The family's applications at this school, newest first. */
export async function listFamilyApplications(orgId: string, userId: string) {
  return tenantTx(orgId, (tx) =>
    tx.admissionApplication.findMany({
      where: { orgId, applicantUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, number: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, academicYearId: true, stage: true, updatedAt: true, offerDeadline: true },
    }),
  );
}

/** Start a draft for a year and grade the school is accepting. */
export async function startApplication(orgId: string, fam: Family, input: { academicYearId: string; gradeLevel: number }) {
  return tenantTx(orgId, async (tx) => {
    const s = await loadSettings(tx, orgId);
    if (!s.publicOpen) throw new AdmissionError("CLOSED");
    const years = await openYears(tx, orgId, s);
    const year = years.find((y) => y.id === input.academicYearId);
    if (!year) throw new AdmissionError("YEAR");
    const grades = gradesOffered(await capacityRows(tx, orgId, year.id), ALL_GRADE_LEVELS);
    if (!grades.includes(input.gradeLevel)) throw new AdmissionError("GRADE");
    const drafts = await tx.admissionApplication.count({ where: { orgId, applicantUserId: fam.userId, stage: "DRAFT" } });
    if (drafts >= 6) throw new AdmissionError("TOO_MANY_DRAFTS");
    const number = await nextApplicationNo(tx, orgId, year.entryYear);
    const app = await tx.admissionApplication.create({
      data: { orgId, number, applicantUserId: fam.userId, academicYearId: year.id, gradeLevel: input.gradeLevel, stage: "DRAFT", step: "", source: "ONLINE" },
    });
    await recordEvent(tx, orgId, { applicationId: app.id, kind: "created", toStage: "DRAFT", actorUserId: fam.userId });
    await audit(tx, orgId, { actorUserId: fam.userId, action: "admission.start", entityType: "AdmissionApplication", entityId: app.id, meta: { gradeLevel: input.gradeLevel } });
    return app;
  });
}

/** What the family entered, decrypted for the family's own form. Never used for staff views. */
export function familyFormValues(app: AdmissionApplication) {
  const health = decryptJson<{ allergies?: string; conditions?: string; medications?: string }>(app.medicalEnc) ?? {};
  const support = decryptJson<{ needed?: boolean; details?: string; previousAssessment?: boolean }>(app.supportEnc) ?? {};
  return {
    student: {
      academicYearId: app.academicYearId,
      gradeLevel: app.gradeLevel,
      curriculum: app.curriculum,
      firstNameEn: app.firstNameEn,
      lastNameEn: app.lastNameEn,
      firstNameAr: app.firstNameAr ?? "",
      lastNameAr: app.lastNameAr ?? "",
      dateOfBirth: app.dateOfBirth ? app.dateOfBirth.toISOString().slice(0, 10) : "",
      gender: app.gender ?? "",
      nationality: app.nationality ?? "",
      homeLanguage: app.homeLanguage ?? "",
      emiratesId: decryptText(app.emiratesIdEnc) ?? "",
      passport: decryptText(app.passportEnc) ?? "",
    },
    schooling: (app.schooling as SchoolingStep | null) ?? null,
    family: (app.guardians ? { guardians: app.guardians, siblings: app.siblings ?? [], staffChild: app.staffChild } : null) as FamilyStep | null,
    health: {
      allergies: health.allergies ?? "",
      conditions: health.conditions ?? "",
      medications: health.medications ?? "",
      supportNeeded: Boolean(support.needed),
      supportDetails: support.details ?? "",
      previousAssessment: Boolean(support.previousAssessment),
    } satisfies HealthStep,
  };
}

type StepData = { step: "student"; data: StudentStep } | { step: "schooling"; data: SchoolingStep } | { step: "family"; data: FamilyStep } | { step: "health"; data: HealthStep };

/** Validate one step. Returns field paths with problems so the form can point at them. */
export function parseStep(step: string, raw: unknown): { ok: true; value: StepData } | { ok: false; fields: string[] } {
  const schema = step === "student" ? studentSchema : step === "schooling" ? schoolingSchema : step === "family" ? familySchema : step === "health" ? healthSchema : null;
  if (!schema) return { ok: false, fields: ["step"] };
  const r = schema.safeParse(raw);
  if (!r.success) return { ok: false, fields: [...new Set(r.error.issues.map((i) => i.path.join(".") || "form"))] };
  return { ok: true, value: { step, data: r.data } as StepData };
}

const NEXT_STEP: Record<string, string> = { student: "schooling", schooling: "family", family: "health", health: "documents" };

/** Save one step of a draft. Submitted applications are locked except for document uploads. */
export async function saveStep(orgId: string, fam: Family, id: string, value: StepData) {
  return tenantTx(orgId, async (tx) => {
    const app = await own(tx, orgId, fam.userId, id);
    if (app.stage !== "DRAFT") throw new AdmissionError("LOCKED");
    const saved = savedSteps(app);
    saved.add(value.step);
    const data: Prisma.AdmissionApplicationUpdateInput = { step: [...saved].join(",") };
    if (value.step === "student") {
      const v = value.data;
      const s = await loadSettings(tx, orgId);
      const years = await openYears(tx, orgId, s);
      const year = years.find((y) => y.id === v.academicYearId);
      if (!year) throw new AdmissionError("YEAR");
      if (!gradesOffered(await capacityRows(tx, orgId, year.id), ALL_GRADE_LEVELS).includes(v.gradeLevel)) throw new AdmissionError("GRADE");
      const dob = new Date(`${v.dateOfBirth}T00:00:00Z`);
      if (Number.isNaN(dob.getTime()) || dob.getTime() > Date.now() || dob.getUTCFullYear() < 1990) throw new AdmissionError("DOB");
      const digits = eidDigits(v.emiratesId);
      const key = nameDobKey(v.firstNameEn, v.lastNameEn, dob);
      // The same family applying twice for the same child and year: point them to the existing application.
      const mine = await tx.admissionApplication.findFirst({
        where: { orgId, applicantUserId: fam.userId, id: { not: app.id }, academicYearId: year.id, stage: { notIn: ["WITHDRAWN", "DECLINED"] }, OR: [...(key ? [{ nameDobKey: key }] : []), ...(digits ? [{ emiratesIdHash: eidHash(digits) }] : [])] },
        select: { number: true },
      });
      if (mine && (key || digits)) throw new AdmissionError(`DUPLICATE_OWN:${mine.number}`);
      Object.assign(data, {
        academicYearId: year.id,
        gradeLevel: v.gradeLevel,
        curriculum: v.curriculum ?? null,
        firstNameEn: v.firstNameEn,
        lastNameEn: v.lastNameEn,
        firstNameAr: v.firstNameAr || null,
        lastNameAr: v.lastNameAr || null,
        dateOfBirth: dob,
        gender: v.gender,
        nationality: v.nationality,
        homeLanguage: v.homeLanguage || null,
        emiratesIdEnc: digits ? encryptField(digits) : null,
        emiratesIdLast4: digits ? digits.slice(-4) : null,
        emiratesIdHash: digits ? eidHash(digits) : null,
        passportEnc: v.passport ? encryptField(v.passport.toUpperCase()) : null,
        passportLast4: v.passport ? v.passport.slice(-4).toUpperCase() : null,
        nameDobKey: key,
      } satisfies Prisma.AdmissionApplicationUpdateInput);
    } else if (value.step === "schooling") {
      data.schooling = value.data as Prisma.InputJsonValue;
    } else if (value.step === "family") {
      data.guardians = value.data.guardians as Prisma.InputJsonValue;
      data.siblings = value.data.siblings as Prisma.InputJsonValue;
      data.staffChild = value.data.staffChild;
    } else {
      const h = value.data;
      const medical = { allergies: h.allergies, conditions: h.conditions, medications: h.medications };
      const support = { needed: h.supportNeeded, details: h.supportNeeded ? h.supportDetails : "", previousAssessment: h.supportNeeded && h.previousAssessment };
      data.medicalEnc = hasMedicalInfo(medical) ? encryptJson(medical) : null;
      data.hasMedical = hasMedicalInfo(medical);
      data.supportEnc = h.supportNeeded ? encryptJson(support) : null;
      data.hasSupport = h.supportNeeded;
    }
    await tx.admissionApplication.update({ where: { id: app.id }, data });
    return { next: NEXT_STEP[value.step] ?? "review" };
  });
}

/** Steps the family has saved at least once (stored as a comma list in `step`). */
export function savedSteps(app: Pick<AdmissionApplication, "step">): Set<string> {
  return new Set((app.step ?? "").split(",").filter(Boolean));
}

/** Which steps are complete, from the stored data. */
export function completeness(app: AdmissionApplication) {
  const saved = savedSteps(app);
  return {
    student: saved.has("student") && Boolean(app.firstNameEn && app.lastNameEn && app.dateOfBirth && app.gender && app.nationality),
    schooling: saved.has("schooling") && app.schooling !== null,
    family: saved.has("family") && Array.isArray(app.guardians) && (app.guardians as unknown[]).length > 0,
    health: saved.has("health"),
  };
}

/** Submit a draft. Runs duplicate detection and sibling matching, then tells the admissions team. */
export async function submitApplication(orgId: string, fam: Family, id: string, school: { slug: string; nameEn: string; nameAr: string }) {
  const effects: Effect[] = [];
  const res = await tenantTx(orgId, async (tx) => {
    const app = await own(tx, orgId, fam.userId, id);
    if (!familyCan(app.stage, "submit", { now: new Date() })) throw new AdmissionError("LOCKED");
    const done = completeness(app);
    const incomplete = (Object.keys(done) as Array<keyof typeof done>).filter((k) => !done[k]);
    if (incomplete.length) throw new AdmissionError(`INCOMPLETE:${incomplete.join(",")}`);
    const now = new Date();
    const digits = app.emiratesIdEnc ? decryptText(app.emiratesIdEnc) : null;
    const flags = await findDuplicates(tx, orgId, { id: app.id, emiratesIdHash: app.emiratesIdHash, emiratesIdLast4: app.emiratesIdLast4, eidDigits: digits, nameDobKey: app.nameDobKey, firstNameEn: app.firstNameEn, lastNameEn: app.lastNameEn, dateOfBirth: app.dateOfBirth });
    const guardians = (app.guardians as Array<{ email: string }> | null) ?? [];
    const siblingIds = await matchSiblings(tx, orgId, { siblings: (app.siblings as Array<{ name: string; studentNo?: string }> | null) ?? [], guardianEmails: guardians.map((g) => g.email) });
    const updated = await tx.admissionApplication.update({
      where: { id: app.id },
      data: { stage: "NEW", stageChangedAt: now, submittedAt: now, consentAt: now, duplicateFlags: flags, siblingStudentIds: siblingIds },
    });
    await recordEvent(tx, orgId, { applicationId: app.id, kind: "stage", fromStage: "DRAFT", toStage: "NEW", actorUserId: fam.userId, data: { duplicates: flags.length, siblings: siblingIds.length }, at: now });
    await audit(tx, orgId, { actorUserId: fam.userId, action: "admission.submit", entityType: "AdmissionApplication", entityId: app.id, meta: { duplicates: flags.length, siblings: siblingIds.length } });
    const ec = execCtx(tx, orgId, { now, effects, quiet: fam.quiet });
    const grade = gradeBoth(app.gradeLevel);
    await notifyTeam(ec, { templateKey: "admission_submitted", vars: { number: app.number, grade }, href: `/admissions/applications/${app.id}`, idempotencyBase: `adm:${app.id}:submitted` });
    const year = await tx.academicYear.findUnique({ where: { id: app.academicYearId } });
    await mailFamily(ec, {
      to: fam.email,
      kind: "submitted",
      locale: fam.locale,
      vars: { school: { en: school.nameEn, ar: school.nameAr }, child: childNameBoth(app), number: app.number, grade, year: { en: year?.nameEn ?? "", ar: year?.nameAr ?? "" } },
      href: appHref(school.slug, app.id),
      idempotencyKey: `adm:${app.id}:submitted:family`,
    });
    return updated;
  });
  return { app: res, effects };
}

/** Accept or decline an offer before its deadline. */
export async function respondToOffer(orgId: string, fam: Family, id: string, accept: boolean, reason: string | null) {
  const effects: Effect[] = [];
  await tenantTx(orgId, async (tx) => {
    const app = await own(tx, orgId, fam.userId, id);
    const now = new Date();
    if (!familyCan(app.stage, accept ? "accept" : "decline", { now, offerDeadline: app.offerDeadline })) throw new AdmissionError(app.stage === "OFFER_MADE" ? "OFFER_EXPIRED" : "LOCKED");
    const to = accept ? "OFFER_ACCEPTED" : "DECLINED";
    await tx.admissionApplication.update({
      where: { id: app.id },
      data: { stage: to, stageChangedAt: now, offerRespondedAt: now, ...(accept ? {} : { closedBy: "FAMILY", closeReason: (reason ?? "").slice(0, 300) || "family_choice" }) },
    });
    await recordEvent(tx, orgId, { applicationId: app.id, kind: "offer", fromStage: app.stage, toStage: to, actorUserId: fam.userId, data: { response: accept ? "accepted" : "declined" }, at: now });
    await audit(tx, orgId, { actorUserId: fam.userId, action: accept ? "admission.offer_accept" : "admission.offer_decline", entityType: "AdmissionApplication", entityId: app.id });
    const ec = execCtx(tx, orgId, { now, effects, quiet: fam.quiet });
    await notifyTeam(ec, { templateKey: accept ? "admission_offer_accepted" : "admission_offer_declined", vars: { number: app.number, grade: gradeBoth(app.gradeLevel) }, href: `/admissions/applications/${app.id}`, idempotencyBase: `adm:${app.id}:offer:${accept ? "yes" : "no"}:${now.getTime()}` });
    if (accept) {
      const { createSeatBookingCharge } = await import("./seat-booking");
      await createSeatBookingCharge(ec, app.id);
    }
  });
  return effects;
}

/** Withdraw an open application (or discard a draft). */
export async function withdrawApplication(orgId: string, fam: Family, id: string, reason: string | null) {
  await tenantTx(orgId, async (tx) => {
    const app = await own(tx, orgId, fam.userId, id);
    if (!familyCan(app.stage, "withdraw", { now: new Date() })) throw new AdmissionError("LOCKED");
    const now = new Date();
    await tx.admissionApplication.update({ where: { id: app.id }, data: { stage: "WITHDRAWN", stageChangedAt: now, closedBy: "FAMILY", closeReason: (reason ?? "").slice(0, 300) || "family_choice" } });
    await recordEvent(tx, orgId, { applicationId: app.id, kind: "stage", fromStage: app.stage, toStage: "WITHDRAWN", actorUserId: fam.userId, at: now });
    await audit(tx, orgId, { actorUserId: fam.userId, action: "admission.family_withdraw", entityType: "AdmissionApplication", entityId: app.id });
  });
}

/** A message from the family. The admissions team is told a reply arrived, never what it says. */
export async function familyMessage(orgId: string, fam: Family, id: string, body: string) {
  const text = body.trim();
  if (!text || text.length > MESSAGE_MAX) throw new AdmissionError("MESSAGE");
  const effects: Effect[] = [];
  await tenantTx(orgId, async (tx) => {
    const app = await own(tx, orgId, fam.userId, id);
    if (app.stage === "DRAFT") throw new AdmissionError("LOCKED");
    const now = new Date();
    const msg = await tx.admissionMessage.create({ data: { orgId, applicationId: app.id, authorUserId: fam.userId, visibility: "SHARED", body: text, createdAt: now } });
    const ec = execCtx(tx, orgId, { now, effects, quiet: fam.quiet });
    await notifyTeam(ec, { templateKey: "admission_family_message", vars: { number: app.number }, href: `/admissions/applications/${app.id}#conversation`, idempotencyBase: `admmsg:${msg.id}` });
  });
  return effects;
}

/**
 * The fields of an application a family may see. Staff-only data (assessment notes and outcome, duplicate flags,
 * matched siblings, priority, internal hashes) never leaves the server on the family side.
 */
export function familySafe(app: AdmissionApplication) {
  return {
    id: app.id,
    number: app.number,
    stage: app.stage,
    step: app.step,
    academicYearId: app.academicYearId,
    gradeLevel: app.gradeLevel,
    firstNameEn: app.firstNameEn,
    lastNameEn: app.lastNameEn,
    firstNameAr: app.firstNameAr,
    lastNameAr: app.lastNameAr,
    nationality: app.nationality,
    createdAt: app.createdAt,
    submittedAt: app.submittedAt,
    stageChangedAt: app.stageChangedAt,
    offerMadeAt: app.offerMadeAt,
    offerDeadline: app.offerDeadline,
    offerRespondedAt: app.offerRespondedAt,
    seatFeeFils: app.seatFeeFils,
    seatPayUrl: app.seatPayUrl,
    seatPaidAt: app.seatPaidAt,
    closedBy: app.closedBy,
    enrolledAt: app.enrolledAt,
  };
}
export type FamilySafeApp = ReturnType<typeof familySafe>;

/** What the family sees after submitting: shared messages, documents, the assessment and the offer. */
export async function familyApplicationView(orgId: string, userId: string, id: string) {
  return tenantTx(orgId, async (tx) => {
    const app = await own(tx, orgId, userId, id);
    const [documents, messages, year, appointment, settings] = await Promise.all([
      tx.admissionDocument.findMany({ where: { orgId, applicationId: app.id }, orderBy: { createdAt: "asc" }, select: { id: true, typeKey: true, fileName: true, sizeBytes: true, status: true, createdAt: true, mimeType: true } }),
      tx.admissionMessage.findMany({ where: { orgId, applicationId: app.id, visibility: "SHARED" }, orderBy: { createdAt: "asc" }, take: 200 }),
      tx.academicYear.findUnique({ where: { id: app.academicYearId } }),
      app.assessmentAppointmentId ? tx.appointment.findUnique({ where: { id: app.assessmentAppointmentId } }) : null,
      loadSettings(tx, orgId),
    ]);
    const staffIds = [...new Set(messages.map((m) => m.authorMembershipId).filter(Boolean))] as string[];
    const staff = staffIds.length ? await tx.membership.findMany({ where: { id: { in: staffIds } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [];
    const capacity = await tx.admissionCapacity.findUnique({ where: { orgId_academicYearId_gradeLevel: { orgId, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel } } });
    return {
      app: familySafe(app),
      form: app.stage === "DRAFT" ? familyFormValues(app) : null,
      year,
      entryYear: year ? entryYearOf(year) : null,
      documents,
      messages: messages.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, mine: m.authorUserId === userId, staff: staff.find((s) => s.id === m.authorMembershipId)?.user ?? null })),
      appointment: appointment && appointment.status !== "CANCELLED" ? { startsAt: appointment.startsAt, endsAt: appointment.endsAt, locationEn: appointment.locationEn, locationAr: appointment.locationAr } : null,
      settings,
      seatFeeFils: app.seatFeeFils ?? capacity?.seatFeeFils ?? 0,
      missing: missingDocs(settings.docTypes, app.gradeLevel, app.nationality, documents),
    };
  });
}

export { dateBoth };
