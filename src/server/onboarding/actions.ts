"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Ctx } from "@/server/context";
import { setupCtx } from "@/server/onboarding/access";
import { audit } from "@/server/audit/audit";
import { tenantTx } from "@/lib/tenant-db";
import { CURRICULA } from "@/lib/signup";
import { normalizeModuleList, OPTIONAL_MODULES } from "@/lib/modules";
import { HEX_COLOR, isSetupStep, markStep, TIMEZONES, type SetupStep } from "@/lib/onboarding";
import { installCourseCatalog, installHolidays } from "../../../prisma/seed/starter";

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

const actor = (ctx: Ctx) => ({ actorId: ctx.membershipId, actorUserId: ctx.user.id });
const refresh = () => revalidatePath("/", "layout");

async function mark(ctx: Ctx, step: SetupStep, skipped = false) {
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { onboardingSteps: true } });
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data: { onboardingSteps: markStep(org.onboardingSteps, step, skipped) } });
}

/** Mark a step finished or skipped without other changes (for steps that only link elsewhere). */
export async function markStepAction(input: { step: string; skipped: boolean }): Promise<Result> {
  const ctx = await setupCtx();
  if (!ctx) return fail("FORBIDDEN");
  if (!isSetupStep(input.step) || input.step === "done") return fail("INVALID");
  await mark(ctx, input.step, input.skipped);
  await audit(ctx.db, ctx.orgId, { ...actor(ctx), action: input.skipped ? "setup.step_skipped" : "setup.step_done", entityType: "Organization", entityId: ctx.orgId, meta: { step: input.step } });
  refresh();
  return { ok: true };
}

const profileSchema = z.object({
  nameEn: z.string().trim().min(3).max(120),
  nameAr: z.string().trim().min(3).max(120),
  shortNameEn: z.string().trim().max(40).optional(),
  shortNameAr: z.string().trim().max(40).optional(),
  primaryColor: z.string().regex(HEX_COLOR),
  accentColor: z.string().regex(HEX_COLOR),
  defaultLocale: z.enum(["en", "ar"]),
  weekDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  timezone: z.enum(TIMEZONES),
  regulator: z.enum(["KHDA", "ADEK", "SPEA", "MOE", "OTHER"]),
  emirate: z.string().trim().min(2).max(40),
  hijriEnabled: z.boolean(),
  numerals: z.enum(["WESTERN", "ARABIC_INDIC"]),
});

/** Step a: the school's names, brand, language and calendar conventions. */
export async function saveProfileStepAction(input: z.input<typeof profileSchema>): Promise<Result> {
  const ctx = await setupCtx();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(String(parsed.error.issues[0]?.path[0] ?? "INVALID").toUpperCase());
  const d = parsed.data;
  const data = {
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    shortNameEn: d.shortNameEn || null,
    shortNameAr: d.shortNameAr || null,
    primaryColor: d.primaryColor.toUpperCase(),
    accentColor: d.accentColor.toUpperCase(),
    defaultLocale: d.defaultLocale,
    weekDays: [...new Set(d.weekDays)].sort(),
    timezone: d.timezone,
    regulator: d.regulator,
    emirate: d.emirate,
    hijriEnabled: d.hijriEnabled,
    numerals: d.numerals,
  };
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data });
  await mark(ctx, "profile");
  await audit(ctx.db, ctx.orgId, { ...actor(ctx), action: "org.update", entityType: "Organization", entityId: ctx.orgId, meta: { step: "profile", ...data } });
  refresh();
  return { ok: true };
}

/** Set or clear the school logo. The file was stored through /api/uploads; only its storage key is kept. */
export async function setLogoAction(input: { key: string | null }): Promise<Result> {
  const ctx = await setupCtx();
  if (!ctx) return fail("FORBIDDEN");
  const key = input.key;
  if (key !== null && !(typeof key === "string" && /^(r2|local):[\w./-]+$/.test(key) && key.split(":")[1].startsWith(`${ctx.orgId}/`) && !key.includes(".."))) return fail("INVALID");
  if (key && !/\.(png|jpe?g|webp)$/i.test(key)) return fail("TYPE");
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data: { logoUrl: key } });
  await audit(ctx.db, ctx.orgId, { ...actor(ctx), action: "org.logo", entityType: "Organization", entityId: ctx.orgId, meta: { removed: key === null } });
  refresh();
  return { ok: true };
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yearSchema = z.object({
  yearId: z.string().min(1),
  nameEn: z.string().trim().min(1).max(60),
  nameAr: z.string().trim().min(1).max(60),
  startsOn: dateKey,
  endsOn: dateKey,
  terms: z
    .array(z.object({ id: z.string().optional(), nameEn: z.string().trim().min(1).max(60), nameAr: z.string().trim().min(1).max(60), startsOn: dateKey, endsOn: dateKey }))
    .min(1)
    .max(6),
});

const day = (k: string) => new Date(`${k}T00:00:00.000Z`);

/** Step b: edit the current academic year and its terms. Terms must sit inside the year and not overlap. */
export async function saveYearStepAction(input: z.input<typeof yearSchema>): Promise<Result> {
  const ctx = await setupCtx();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = yearSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  if (d.endsOn <= d.startsOn) return fail("YEAR_DATES");
  const terms = [...d.terms].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  for (const [i, t] of terms.entries()) {
    if (t.endsOn < t.startsOn || t.startsOn < d.startsOn || t.endsOn > d.endsOn) return fail("TERM_DATES");
    if (i > 0 && t.startsOn <= terms[i - 1].endsOn) return fail("TERM_OVERLAP");
  }
  const year = await ctx.db.academicYear.findUnique({ where: { id: d.yearId }, include: { terms: true } });
  if (!year) return fail("NOT_FOUND");
  const keep = new Set(terms.map((t) => t.id).filter(Boolean));
  const removed = year.terms.filter((t) => !keep.has(t.id));
  // A term that already has assessments or exams stays; the school ends it by changing its dates instead.
  for (const t of removed) {
    const used = (await ctx.db.assessment.count({ where: { termId: t.id } })) + (await ctx.db.examSitting.count({ where: { termId: t.id } }));
    if (used) return fail("TERM_IN_USE");
  }
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.academicYear.update({ where: { id: year.id }, data: { nameEn: d.nameEn, nameAr: d.nameAr, startsOn: day(d.startsOn), endsOn: day(d.endsOn) } });
    if (removed.length) await tx.term.deleteMany({ where: { id: { in: removed.map((t) => t.id) } } });
    for (const t of terms) {
      const data = { nameEn: t.nameEn, nameAr: t.nameAr, startsOn: day(t.startsOn), endsOn: day(t.endsOn) };
      if (t.id && year.terms.some((x) => x.id === t.id)) await tx.term.update({ where: { id: t.id }, data });
      else await tx.term.create({ data: { orgId: ctx.orgId, academicYearId: year.id, ...data } });
    }
    await audit(tx, ctx.orgId, { ...actor(ctx), action: "org.update", entityType: "AcademicYear", entityId: year.id, meta: { step: "year", terms: terms.length, removedTerms: removed.length } });
  });
  await mark(ctx, "year");
  refresh();
  return { ok: true };
}

/** Add any missing UAE public holidays and term breaks to the current year (never duplicates). */
export async function addUaeHolidaysAction(): Promise<Result & { added?: number }> {
  const ctx = await setupCtx();
  if (!ctx || !ctx.can("calendar.manage")) return fail("FORBIDDEN");
  const year = await ctx.db.academicYear.findFirst({ where: { isCurrent: true } });
  if (!year) return fail("NO_YEAR");
  const added = await tenantTx(ctx.orgId, (tx) => installHolidays(tx, ctx.orgId, year.id));
  await audit(ctx.db, ctx.orgId, { ...actor(ctx), action: "calendar.holidays_added", entityType: "AcademicYear", entityId: year.id, meta: { added } });
  refresh();
  return { ok: true, added };
}

const curriculaSchema = z.object({ curricula: z.array(z.enum(CURRICULA)).min(1).max(CURRICULA.length) });

/** Step c: the curricula the school teaches. Newly added curricula get their starter course catalog. */
export async function saveCurriculaStepAction(input: z.input<typeof curriculaSchema>): Promise<Result & { courses?: number }> {
  const ctx = await setupCtx();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = curriculaSchema.safeParse(input);
  if (!parsed.success) return fail("CURRICULA");
  const curricula = [...new Set(parsed.data.curricula)];
  const before = ctx.org.curricula;
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data: { curricula } });
  const courses = await tenantTx(ctx.orgId, (tx) => installCourseCatalog(tx, ctx.orgId, curricula), { timeout: 30000 });
  await mark(ctx, "curricula");
  await audit(ctx.db, ctx.orgId, { ...actor(ctx), action: "org.update", entityType: "Organization", entityId: ctx.orgId, meta: { step: "curricula", before, after: curricula, coursesAdded: courses } });
  refresh();
  return { ok: true, courses };
}

const modulesSchema = z.object({ enabled: z.array(z.enum(OPTIONAL_MODULES)).max(OPTIONAL_MODULES.length) });

/** Step d: switch optional modules on and off. Core modules always stay on. */
export async function saveModulesStepAction(input: z.input<typeof modulesSchema>): Promise<Result> {
  const ctx = await setupCtx();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = modulesSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID");
  const enabledModules = normalizeModuleList(parsed.data.enabled);
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data: { enabledModules } });
  await mark(ctx, "modules");
  await audit(ctx.db, ctx.orgId, { ...actor(ctx), action: "org.modules", entityType: "Organization", entityId: ctx.orgId, meta: { before: ctx.org.enabledModules, after: enabledModules } });
  refresh();
  return { ok: true };
}

/** Step g: finish setup. The home page stops showing the "Finish setting up" card. */
export async function finishSetupAction(): Promise<Result> {
  const ctx = await setupCtx();
  if (!ctx) return fail("FORBIDDEN");
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data: { onboardingCompletedAt: new Date() } });
  await audit(ctx.db, ctx.orgId, { ...actor(ctx), action: "setup.completed", entityType: "Organization", entityId: ctx.orgId, meta: { steps: ctx.org.onboardingSteps } });
  refresh();
  return { ok: true };
}
