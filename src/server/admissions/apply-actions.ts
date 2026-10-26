"use server";

// Public actions for families applying online (/apply/<school>). No school membership is needed: the family
// signs in with an applicant session (src/server/admissions/applicant.ts). Every action resolves the school from
// its slug, rate-limits by IP or account, and only ever touches the signed-in family's own applications.
import { headers } from "next/headers";
import { z } from "zod";
import { identityDb, tenantTx } from "@/lib/tenant-db";
import { execCtx } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { deleteObject } from "@/server/documents/storage-core";
import { audit } from "@/server/audit/audit";
import { resolveAccount, JoinError } from "@/server/access/join";
import { clientIp, hit } from "@/server/access/rate-limit";
import { isLocale } from "@/i18n/routing";
import { AdmissionError } from "./access";
import { clearApplicantSession, confirmEmailCode, currentApplicant, issueEmailCode, setApplicantSession } from "./applicant";
import { mailFamily } from "./email";
import { familyMessage, parseStep, removeFamilyDocument, respondToOffer, saveStep, startApplication, submitApplication, withdrawApplication, type Family } from "./family";
import { applySchoolBySlug, type ApplySchool } from "./public-school";
import { loadSettings } from "./settings";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; fields?: string[] };

async function ip() {
  return clientIp(await headers());
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AdmissionError) return { ok: false, error: e.code };
  if (e instanceof JoinError) return { ok: false, error: e.code };
  throw e;
}

async function schoolOpen(slug: string): Promise<ApplySchool> {
  const school = await applySchoolBySlug(String(slug ?? ""));
  if (!school) throw new AdmissionError("SCHOOL");
  const s = await tenantTx(school.id, (tx) => loadSettings(tx, school.id));
  if (!s.publicOpen) throw new AdmissionError("CLOSED");
  return school;
}

/** The signed-in, verified family for an action. */
async function family(school: ApplySchool, locale: string): Promise<Family> {
  const a = await currentApplicant();
  if (!a) throw new AdmissionError("SIGNED_OUT");
  if (!a.verified) throw new AdmissionError("UNVERIFIED");
  // The demo school's families are fictional: nothing is emailed.
  return { userId: a.userId, email: a.email, locale: isLocale(locale) ? locale : "en", quiet: school.isDemo };
}

/** Send a verification code. In the demo school the code is shown on screen instead, since no email is sent. */
async function sendCode(school: ApplySchool, userId: string, email: string, locale: "en" | "ar") {
  const limit = await hit(`apply-code:${userId}`, 5, 15 * 60);
  if (!limit.ok) throw new AdmissionError("RATE_LIMITED");
  const code = await issueEmailCode(userId);
  if (school.isDemo) return code;
  const effects = await tenantTx(school.id, async (tx) => {
    const ec = execCtx(tx, school.id, { now: new Date() });
    await mailFamily(ec, { to: email, kind: "code", locale, vars: { school: { en: school.nameEn, ar: school.nameAr }, code }, href: `/apply/${school.slug}`, idempotencyKey: `apply-code:${userId}:${Date.now()}` });
    return ec.effects;
  });
  await flushEffects(effects);
  return null;
}

const accountSchema = z.object({ mode: z.enum(["create", "signin"]), name: z.string().max(120).optional(), email: z.string().max(254), password: z.string().max(200) });

/** Create an account (or sign in) on the application pages. */
export async function applicantAccountAction(input: { slug: string; locale: string; account: z.input<typeof accountSchema> }): Promise<Res<{ verified: boolean; demoCode: string | null }>> {
  try {
    const school = await schoolOpen(input.slug);
    const limit = await hit(`apply-account:${await ip()}`, 20, 10 * 60);
    if (!limit.ok) return { ok: false, error: "RATE_LIMITED" };
    const a = accountSchema.safeParse(input.account);
    if (!a.success) return { ok: false, error: "CREDENTIALS" };
    const acc = await resolveAccount(a.data.mode === "create" ? { mode: "create", name: a.data.name ?? "", email: a.data.email, password: a.data.password } : { mode: "signin", email: a.data.email, password: a.data.password }, { ip: await ip() });
    await setApplicantSession(acc.userId);
    const locale = isLocale(input.locale) ? input.locale : "en";
    const verified = Boolean((await identityDb.user.findUnique({ where: { id: acc.userId }, select: { emailVerified: true } }))?.emailVerified);
    const demoCode = verified ? null : await sendCode(school, acc.userId, acc.email, locale);
    await tenantTx(school.id, (tx) => audit(tx, school.id, { actorUserId: acc.userId, action: acc.created ? "admission.account_create" : "admission.account_signin", entityType: "User", entityId: acc.userId }));
    return { ok: true, verified, demoCode };
  } catch (e) {
    return fail(e);
  }
}

export async function resendCodeAction(input: { slug: string; locale: string }): Promise<Res<{ demoCode: string | null }>> {
  try {
    const school = await schoolOpen(input.slug);
    const a = await currentApplicant();
    if (!a) return { ok: false, error: "SIGNED_OUT" };
    if (a.verified) return { ok: true, demoCode: null };
    return { ok: true, demoCode: await sendCode(school, a.userId, a.email, isLocale(input.locale) ? input.locale : "en") };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyCodeAction(input: { slug: string; code: string }): Promise<Res> {
  try {
    await schoolOpen(input.slug);
    const a = await currentApplicant();
    if (!a) return { ok: false, error: "SIGNED_OUT" };
    const limit = await hit(`apply-verify:${a.userId}`, 10, 15 * 60);
    if (!limit.ok) return { ok: false, error: "RATE_LIMITED" };
    if (!(await confirmEmailCode(a.userId, String(input.code ?? "")))) return { ok: false, error: "CODE" };
    await setApplicantSession(a.userId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function applicantSignOutAction(): Promise<Res> {
  await clearApplicantSession();
  return { ok: true };
}

export async function startApplicationAction(input: { slug: string; locale: string; academicYearId: string; gradeLevel: number }): Promise<Res<{ id: string }>> {
  try {
    const school = await schoolOpen(input.slug);
    const fam = await family(school, input.locale);
    const v = z.object({ academicYearId: z.string().min(5).max(40), gradeLevel: z.number().int() }).parse(input);
    const app = await startApplication(school.id, fam, v);
    return { ok: true, id: app.id };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: "INVALID" };
    return fail(e);
  }
}

export async function saveStepAction(input: { slug: string; locale: string; applicationId: string; step: string; data: unknown }): Promise<Res<{ next: string }>> {
  try {
    const school = await schoolOpen(input.slug);
    const fam = await family(school, input.locale);
    const parsed = parseStep(String(input.step), input.data);
    if (!parsed.ok) return { ok: false, error: "INVALID", fields: parsed.fields };
    const res = await saveStep(school.id, fam, String(input.applicationId), parsed.value);
    return { ok: true, next: res.next };
  } catch (e) {
    return fail(e);
  }
}

export async function submitApplicationAction(input: { slug: string; locale: string; applicationId: string; consent: boolean }): Promise<Res> {
  try {
    if (input.consent !== true) return { ok: false, error: "CONSENT" };
    const school = await schoolOpen(input.slug);
    const fam = await family(school, input.locale);
    const { effects } = await submitApplication(school.id, fam, String(input.applicationId), { slug: school.slug, nameEn: school.nameEn, nameAr: school.nameAr });
    await flushEffects(effects);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function respondToOfferAction(input: { slug: string; locale: string; applicationId: string; accept: boolean; reason?: string | null }): Promise<Res> {
  try {
    const school = await schoolOpen(input.slug);
    const fam = await family(school, input.locale);
    const effects = await respondToOffer(school.id, fam, String(input.applicationId), input.accept === true, input.reason ? String(input.reason).slice(0, 300) : null);
    await flushEffects(effects);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function familyMessageAction(input: { slug: string; locale: string; applicationId: string; body: string }): Promise<Res> {
  try {
    const school = await schoolOpen(input.slug);
    const fam = await family(school, input.locale);
    const limit = await hit(`apply-msg:${fam.userId}`, 30, 60 * 60);
    if (!limit.ok) return { ok: false, error: "RATE_LIMITED" };
    const effects = await familyMessage(school.id, fam, String(input.applicationId), String(input.body ?? ""));
    await flushEffects(effects);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function withdrawApplicationAction(input: { slug: string; locale: string; applicationId: string; reason?: string | null }): Promise<Res> {
  try {
    const school = await schoolOpen(input.slug);
    const fam = await family(school, input.locale);
    await withdrawApplication(school.id, fam, String(input.applicationId), input.reason ? String(input.reason) : null);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeDocumentAction(input: { slug: string; locale: string; applicationId: string; documentId: string }): Promise<Res> {
  try {
    const school = await schoolOpen(input.slug);
    const fam = await family(school, input.locale);
    const key = await removeFamilyDocument(school.id, fam, String(input.applicationId), String(input.documentId));
    await deleteObject(key);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
