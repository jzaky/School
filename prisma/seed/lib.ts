// Shared helpers for the demo seed: deterministic randomness, Dubai-relative dates, ids and tenant wipe.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const id = () => randomUUID().replace(/-/g, "").slice(0, 25);

/** Deterministic PRNG so every reset produces the same story. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
    shuffle: <T>(arr: T[]): T[] => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

const DUBAI_OFFSET_H = 4; // Asia/Dubai has no daylight saving.

/** Today's calendar date in Dubai as {y, m, d}. */
export function dubaiToday(now = new Date()) {
  const shifted = new Date(now.getTime() + DUBAI_OFFSET_H * 3600_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

/** A moment `dayOffset` days from today at hour:minute Dubai time. */
export function at(dayOffset: number, hour = 9, minute = 0, now = new Date()) {
  const { y, m, d } = dubaiToday(now);
  return new Date(Date.UTC(y, m, d + dayOffset, hour - DUBAI_OFFSET_H, minute));
}

/** Date-only value (midnight UTC) for @db.Date columns. */
export function dateOnly(dayOffset: number, now = new Date()) {
  const { y, m, d } = dubaiToday(now);
  return new Date(Date.UTC(y, m, d + dayOffset));
}

export function weekdayOf(dayOffset: number, now = new Date()) {
  const { y, m, d } = dubaiToday(now);
  return new Date(Date.UTC(y, m, d + dayOffset)).getUTCDay(); // 0 Sunday ... 6 Saturday
}

export const isSchoolDay = (dayOffset: number, now = new Date()) => {
  const wd = weekdayOf(dayOffset, now);
  return wd >= 1 && wd <= 5;
};

/** The nth school day from today (n can be negative). n = 0 returns today if it is a school day, else the next one. */
export function schoolDay(n: number, now = new Date()) {
  let offset = 0;
  if (n >= 0) {
    let count = -1;
    while (true) {
      if (isSchoolDay(offset, now)) count++;
      if (count === n) return offset;
      offset++;
    }
  }
  let count = 0;
  while (count > n) {
    offset--;
    if (isSchoolDay(offset, now)) count--;
  }
  return offset;
}

export function emailFor(first: string, last: string, domain: string, taken: Set<string>) {
  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z]+/g, "");
  const base = `${clean(first)}.${clean(last)}`;
  let email = `${base}@${domain}`;
  let i = 2;
  while (taken.has(email)) email = `${base}${i++}@${domain}`;
  taken.add(email);
  return email;
}

/** Tables that hold tenant rows, ordered so children are deleted before parents. */
export async function tenantTablesInDeleteOrder(db: PrismaClient): Promise<string[]> {
  const tables = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'orgId'`;
  const fks = await db.$queryRaw<Array<{ child: string; parent: string }>>`
    SELECT tc.table_name AS child, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const names = new Set(tables.map((t) => t.table_name));
  const children = new Map<string, Set<string>>();
  for (const n of names) children.set(n, new Set());
  for (const fk of fks) if (names.has(fk.child) && names.has(fk.parent) && fk.child !== fk.parent) children.get(fk.parent)!.add(fk.child);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const c of children.get(n) ?? []) visit(c);
    out.push(n);
  };
  for (const n of [...names].sort()) visit(n);
  return out;
}

/** Remove every row belonging to one organization. The organization row itself is kept so its id stays stable. */
export async function wipeTenant(db: PrismaClient, orgId: string) {
  const order = await tenantTablesInDeleteOrder(db);
  for (const table of order) {
    await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "orgId" = $1`, orgId);
  }
}
