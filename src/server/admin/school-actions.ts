"use server";

import { revalidatePath } from "next/cache";
import type { Numerals, Regulator } from "@prisma/client";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";

async function adminCtx() {
  const ctx = await getCtx();
  return ctx.can("school.manage") ? ctx : null;
}

const done = () => revalidatePath("/", "layout");

export async function updateSchoolProfileAction(input: {
  nameEn: string;
  nameAr: string;
  shortNameEn?: string;
  shortNameAr?: string;
  defaultLocale: "en" | "ar";
  weekDays: number[];
  hijriEnabled: boolean;
  numerals: Numerals;
  regulator: Regulator;
  emirate: string;
}) {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  if (!input.nameEn.trim() || !input.nameAr.trim()) return { ok: false as const, error: "NAME" };
  const days = [...new Set(input.weekDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!days.length) return { ok: false as const, error: "DAYS" };
  if (!["en", "ar"].includes(input.defaultLocale) || !["WESTERN", "ARABIC_INDIC"].includes(input.numerals) || !["KHDA", "ADEK", "SPEA", "MOE", "OTHER"].includes(input.regulator)) return { ok: false as const, error: "INVALID" };
  const data = {
    nameEn: input.nameEn.trim(),
    nameAr: input.nameAr.trim(),
    shortNameEn: input.shortNameEn?.trim() || null,
    shortNameAr: input.shortNameAr?.trim() || null,
    defaultLocale: input.defaultLocale,
    weekDays: days,
    hijriEnabled: input.hijriEnabled,
    numerals: input.numerals,
    regulator: input.regulator,
    emirate: input.emirate.trim() || "Dubai",
  };
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.update", entityType: "Organization", entityId: ctx.orgId, meta: data });
  done();
  return { ok: true as const };
}

export async function saveDepartmentAction(input: { id?: string; nameEn: string; nameAr: string; headMembershipId?: string | null }) {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  if (!input.nameEn.trim() || !input.nameAr.trim()) return { ok: false as const, error: "NAME" };
  if (input.headMembershipId) {
    const head = await ctx.db.staffProfile.findUnique({ where: { membershipId: input.headMembershipId } });
    if (!head) return { ok: false as const, error: "HEAD" };
  }
  const data = { nameEn: input.nameEn.trim(), nameAr: input.nameAr.trim(), headMembershipId: input.headMembershipId || null };
  let id = input.id;
  if (id) await ctx.db.department.update({ where: { id }, data });
  else {
    const key = input.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "department";
    const clash = await ctx.db.department.count({ where: { key: { startsWith: key } } });
    id = (await ctx.db.department.create({ data: { orgId: ctx.orgId, key: clash ? `${key}_${clash + 1}` : key, ...data } })).id;
  }
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.update", entityType: "Organization", entityId: ctx.orgId, meta: { department: id, ...data } });
  done();
  return { ok: true as const };
}

export async function saveCampusAction(input: { id?: string; nameEn: string; nameAr: string; addressEn?: string; addressAr?: string }) {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  if (!input.nameEn.trim() || !input.nameAr.trim()) return { ok: false as const, error: "NAME" };
  const data = { nameEn: input.nameEn.trim(), nameAr: input.nameAr.trim(), addressEn: input.addressEn?.trim() || null, addressAr: input.addressAr?.trim() || null };
  if (input.id) await ctx.db.campus.update({ where: { id: input.id }, data });
  else await ctx.db.campus.create({ data: { orgId: ctx.orgId, ...data } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.update", entityType: "Organization", entityId: ctx.orgId, meta: { campus: data.nameEn } });
  done();
  return { ok: true as const };
}

export async function setCurrentYearAction(input: { id: string }) {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false as const, error: "FORBIDDEN" };
  const year = await ctx.db.academicYear.findUnique({ where: { id: input.id } });
  if (!year) return { ok: false as const, error: "NOT_FOUND" };
  await ctx.db.academicYear.updateMany({ where: { orgId: ctx.orgId, isCurrent: true }, data: { isCurrent: false } });
  await ctx.db.academicYear.update({ where: { id: year.id }, data: { isCurrent: true } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.update", entityType: "Organization", entityId: ctx.orgId, meta: { currentYear: year.nameEn } });
  done();
  return { ok: true as const };
}
