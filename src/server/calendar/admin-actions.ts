"use server";

import { revalidatePath } from "next/cache";
import type { CalendarEventKind } from "@prisma/client";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";

type Result = { ok: true; id?: string; count?: number } | { ok: false; error: string };

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const AUDIENCES = ["staff", "student", "parent"] as const;
const KINDS: CalendarEventKind[] = ["EVENT", "DEADLINE", "HOLIDAY", "EXAM"];

/** Dubai midnight of a date key, plus minutes. */
function dubai(key: string, minutes = 0) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes - 240));
}
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

async function manager() {
  const ctx = await getCtx();
  if (!ctx.can("calendar.manage")) return null;
  return ctx;
}

function done(r: Result = { ok: true }): Result {
  revalidatePath("/", "layout");
  return r;
}

export type YearInput = { nameEn: string; nameAr: string; startsOn: string; endsOn: string; makeCurrent: boolean; terms: Array<{ nameEn: string; nameAr: string; startsOn: string; endsOn: string }> };

export async function createYearAction(input: YearInput): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const nameEn = input.nameEn.trim();
  if (!nameEn || !KEY_RE.test(input.startsOn) || !KEY_RE.test(input.endsOn) || input.endsOn <= input.startsOn) return { ok: false, error: "INVALID_DATES" };
  const terms = input.terms.filter((t) => t.nameEn.trim());
  if (!terms.length) return { ok: false, error: "NO_TERMS" };
  for (const t of terms) {
    if (!KEY_RE.test(t.startsOn) || !KEY_RE.test(t.endsOn) || t.endsOn < t.startsOn) return { ok: false, error: "INVALID_DATES" };
    if (t.startsOn < input.startsOn || t.endsOn > input.endsOn) return { ok: false, error: "TERM_OUTSIDE_YEAR" };
  }
  const sorted = [...terms].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  for (let i = 1; i < sorted.length; i++) if (sorted[i].startsOn <= sorted[i - 1].endsOn) return { ok: false, error: "TERMS_OVERLAP" };
  const id = await tenantTx(ctx.orgId, async (tx) => {
    if (input.makeCurrent) await tx.academicYear.updateMany({ where: { orgId: ctx.orgId, isCurrent: true }, data: { isCurrent: false } });
    const year = await tx.academicYear.create({ data: { orgId: ctx.orgId, nameEn, nameAr: input.nameAr.trim() || nameEn, startsOn: dubai(input.startsOn), endsOn: dubai(input.endsOn), isCurrent: input.makeCurrent } });
    await tx.term.createMany({ data: sorted.map((t) => ({ orgId: ctx.orgId, academicYearId: year.id, nameEn: t.nameEn.trim(), nameAr: t.nameAr.trim() || t.nameEn.trim(), startsOn: dubai(t.startsOn), endsOn: dubai(t.endsOn) })) });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "calendar.year.create", entityType: "AcademicYear", entityId: year.id, meta: { terms: sorted.length } });
    return year.id;
  });
  return done({ ok: true, id });
}

export async function setCurrentYearAction(yearId: string): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const year = await ctx.db.academicYear.findUnique({ where: { id: yearId } });
  if (!year) return { ok: false, error: "NOT_FOUND" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.academicYear.updateMany({ where: { orgId: ctx.orgId, isCurrent: true }, data: { isCurrent: false } });
    await tx.academicYear.update({ where: { id: yearId }, data: { isCurrent: true } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "calendar.year.current", entityType: "AcademicYear", entityId: yearId });
  });
  return done();
}

export type EventInput = {
  id?: string | null;
  kind: CalendarEventKind;
  titleEn: string;
  titleAr: string;
  descEn?: string;
  descAr?: string;
  locationEn?: string;
  locationAr?: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  audience: string[];
  gradeLevels: number[];
  published: boolean;
};

function eventData(input: EventInput) {
  if (!input.titleEn.trim()) return { error: "TITLE_REQUIRED" } as const;
  if (!KINDS.includes(input.kind)) return { error: "INVALID" } as const;
  if (!KEY_RE.test(input.startDate) || !KEY_RE.test(input.endDate) || input.endDate < input.startDate) return { error: "INVALID_DATES" } as const;
  const audience = input.audience.filter((a) => (AUDIENCES as readonly string[]).includes(a));
  if (!audience.length) return { error: "AUDIENCE_REQUIRED" } as const;
  let startsAt: Date;
  let endsAt: Date;
  if (input.allDay) {
    startsAt = dubai(input.startDate);
    endsAt = dubai(addDays(input.endDate, 1));
  } else {
    if (!TIME_RE.test(input.startTime ?? "") || !TIME_RE.test(input.endTime ?? "")) return { error: "INVALID_TIMES" } as const;
    startsAt = dubai(input.startDate, mins(input.startTime!));
    endsAt = dubai(input.endDate, mins(input.endTime!));
    if (endsAt <= startsAt) return { error: "INVALID_TIMES" } as const;
  }
  const grades = [...new Set(input.gradeLevels.filter((g) => Number.isInteger(g) && g >= 0 && g <= 13))].sort((a, b) => a - b);
  return {
    data: {
      kind: input.kind,
      titleEn: input.titleEn.trim(),
      titleAr: input.titleAr.trim() || input.titleEn.trim(),
      descEn: input.descEn?.trim() || null,
      descAr: input.descAr?.trim() || null,
      locationEn: input.locationEn?.trim() || null,
      locationAr: input.locationAr?.trim() || null,
      allDay: input.allDay,
      startsAt,
      endsAt,
      audience,
      gradeLevels: grades,
      published: input.published,
    },
  } as const;
}

/** Linked events (exam sittings, trips) are managed from their own pages. */
async function isLinked(ctx: NonNullable<Awaited<ReturnType<typeof manager>>>, eventId: string) {
  const ev = await ctx.db.calendarEvent.findUnique({ where: { id: eventId }, select: { audience: true } });
  if (ev?.audience.some((a) => !["all", ...AUDIENCES].includes(a))) return true;
  const [exam, trip] = await Promise.all([ctx.db.examSitting.count({ where: { calendarEventId: eventId } }), ctx.db.trip.count({ where: { calendarEventId: eventId } })]);
  return exam + trip > 0;
}

export async function saveEventAction(input: EventInput): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const built = eventData(input);
  if ("error" in built) return { ok: false, error: built.error as string };
  if (input.id) {
    const existing = await ctx.db.calendarEvent.findUnique({ where: { id: input.id } });
    if (!existing) return { ok: false, error: "NOT_FOUND" };
    if (await isLinked(ctx, existing.id)) return { ok: false, error: "LINKED" };
    await tenantTx(ctx.orgId, async (tx) => {
      await tx.calendarEvent.update({ where: { id: existing.id }, data: built.data });
      await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "calendar.event.update", entityType: "CalendarEvent", entityId: existing.id, meta: { kind: built.data.kind, published: built.data.published } });
    });
    return done({ ok: true, id: existing.id });
  }
  const id = await tenantTx(ctx.orgId, async (tx) => {
    const ev = await tx.calendarEvent.create({ data: { orgId: ctx.orgId, ...built.data, ownerId: ctx.membershipId } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "calendar.event.create", entityType: "CalendarEvent", entityId: ev.id, meta: { kind: built.data.kind, published: built.data.published } });
    return ev.id;
  });
  return done({ ok: true, id });
}

export async function setEventPublishedAction(id: string, published: boolean): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const ev = await ctx.db.calendarEvent.findUnique({ where: { id } });
  if (!ev) return { ok: false, error: "NOT_FOUND" };
  if (await isLinked(ctx, id)) return { ok: false, error: "LINKED" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.calendarEvent.update({ where: { id }, data: { published } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: published ? "calendar.event.publish" : "calendar.event.unpublish", entityType: "CalendarEvent", entityId: id });
  });
  return done();
}

export async function deleteEventAction(id: string): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const ev = await ctx.db.calendarEvent.findUnique({ where: { id } });
  if (!ev) return { ok: false, error: "NOT_FOUND" };
  if (await isLinked(ctx, id)) return { ok: false, error: "LINKED" };
  await tenantTx(ctx.orgId, async (tx) => {
    await tx.calendarEvent.delete({ where: { id } });
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "calendar.event.delete", entityType: "CalendarEvent", entityId: id, meta: { titleEn: ev.titleEn } });
  });
  return done();
}

export type HolidayInput = { titleEn: string; titleAr: string; startKey: string; days: number; estimated: boolean };

/** Add the chosen UAE holidays as whole-school HOLIDAY events. Skips any already on the calendar that day. */
export async function addHolidaysAction(items: HolidayInput[], publish: boolean): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  const valid = items.filter((h) => h.titleEn.trim() && KEY_RE.test(h.startKey) && h.days >= 1 && h.days <= 10);
  if (!valid.length) return { ok: false, error: "NOTHING_SELECTED" };
  const count = await tenantTx(ctx.orgId, async (tx) => {
    let n = 0;
    for (const h of valid) {
      const startsAt = dubai(h.startKey);
      const dup = await tx.calendarEvent.findFirst({ where: { orgId: ctx.orgId, kind: "HOLIDAY", titleEn: h.titleEn.trim(), startsAt } });
      if (dup) continue;
      await tx.calendarEvent.create({
        data: {
          orgId: ctx.orgId,
          kind: "HOLIDAY",
          titleEn: h.titleEn.trim(),
          titleAr: h.titleAr.trim() || h.titleEn.trim(),
          descEn: h.estimated ? "Estimated date. The final date depends on the moon sighting and the official announcement." : "UAE public holiday. School closed.",
          descAr: h.estimated ? "تاريخ تقديري. يعتمد التاريخ النهائي على رؤية الهلال والإعلان الرسمي." : "عطلة رسمية في دولة الإمارات. المدرسة مغلقة.",
          startsAt,
          endsAt: dubai(addDays(h.startKey, h.days)),
          allDay: true,
          audience: ["staff", "student", "parent"],
          gradeLevels: [],
          published: publish,
          ownerId: ctx.membershipId,
        },
      });
      n++;
    }
    await audit(tx, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "calendar.holidays.add", entityType: "CalendarEvent", meta: { count: n } });
    return n;
  });
  return done({ ok: true, count });
}
