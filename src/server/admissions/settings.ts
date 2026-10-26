// Reading a school's admissions setup: settings with defaults, the years open for applications, capacity rows.
// Reads never write: a school without a settings row gets the defaults until an administrator saves.
import type { AdmissionSettings } from "@prisma/client";
import type { Tx } from "@/server/db";
import type { TenantDb } from "@/lib/tenant-db";
import { docTypes, type DocType } from "./config";
import { stageConfig, type StageDef } from "./stages";
import { DEFAULT_PATTERN } from "./numbers";
import { isAuthority, type Authority } from "./registration";

/** Request code passes ctx.db (tenantDb) and services pass a tenant transaction; both are scoped to one school. */
type Db = Tx;
export const asTx = (db: TenantDb | Tx): Tx => db as unknown as Tx;

export type Settings = {
  row: AdmissionSettings | null;
  publicOpen: boolean;
  openYearIds: string[];
  cutoff: { month: number; day: number };
  pattern: string;
  offerDays: number;
  docTypes: DocType[];
  stages: StageDef[];
  intro: { en: string | null; ar: string | null };
  authority: { key: Authority; labelEn: string | null; labelAr: string | null } | null;
};

export function settingsFrom(row: AdmissionSettings | null): Settings {
  return {
    row,
    publicOpen: row?.publicOpen ?? false,
    openYearIds: row?.openYearIds ?? [],
    cutoff: { month: row?.cutoffMonth ?? 12, day: row?.cutoffDay ?? 31 },
    pattern: row?.admissionNoPattern ?? DEFAULT_PATTERN,
    offerDays: row?.offerDays ?? 14,
    docTypes: docTypes(row?.documentTypes ?? null),
    stages: stageConfig(row?.stages ?? null),
    intro: { en: row?.introEn ?? null, ar: row?.introAr ?? null },
    authority: row && isAuthority(row.authority) ? { key: row.authority, labelEn: row.authorityLabelEn, labelAr: row.authorityLabelAr } : null,
  };
}

export async function loadSettings(db: Db, orgId: string): Promise<Settings> {
  return settingsFrom(await db.admissionSettings.findUnique({ where: { orgId } }));
}

export type YearOption = { id: string; nameEn: string; nameAr: string; startsOn: Date; endsOn: Date; isCurrent: boolean; entryYear: number };

/** The year of entry for age checks and admission numbers: the calendar year the academic year starts in. */
export const entryYearOf = (y: { startsOn: Date }) => new Date(y.startsOn.getTime() + 4 * 3600_000).getUTCFullYear();

/** The current year and later years, oldest first. */
export async function admissionYears(db: Db, orgId: string): Promise<YearOption[]> {
  const current = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, orderBy: { startsOn: "desc" } });
  const rows = await db.academicYear.findMany({ where: { orgId, ...(current ? { startsOn: { gte: current.startsOn } } : {}) }, orderBy: { startsOn: "asc" }, take: 4 });
  return rows.map((y) => ({ id: y.id, nameEn: y.nameEn, nameAr: y.nameAr, startsOn: y.startsOn, endsOn: y.endsOn, isCurrent: y.isCurrent, entryYear: entryYearOf(y) }));
}

/** Years families may apply for: the school's choice, or the current year and the next one. */
export async function openYears(db: Db, orgId: string, s: Settings): Promise<YearOption[]> {
  const years = await admissionYears(db, orgId);
  if (s.openYearIds.length) return years.filter((y) => s.openYearIds.includes(y.id));
  return years.slice(0, 2);
}

/** The year after the current one, when the school has set it up. */
export async function nextYear(db: Db, orgId: string): Promise<YearOption | null> {
  const years = await admissionYears(db, orgId);
  return years.find((y) => !y.isCurrent) ?? null;
}

export async function currentYear(db: Db, orgId: string): Promise<YearOption | null> {
  const years = await admissionYears(db, orgId);
  return years.find((y) => y.isCurrent) ?? years[0] ?? null;
}

/** Capacity rows for a year, by grade. */
export async function capacityRows(db: Db, orgId: string, academicYearId: string) {
  const rows = await db.admissionCapacity.findMany({ where: { orgId, academicYearId }, orderBy: { gradeLevel: "asc" } });
  return new Map(rows.map((r) => [r.gradeLevel, r]));
}

/** Grades open for applications in a year: the grades with capacity set, or every grade when none is set yet. */
export function gradesOffered(rows: Map<number, { sectionSeats: number[] }>, all: readonly number[]): number[] {
  const set = [...rows.entries()].filter(([, r]) => r.sectionSeats.length > 0).map(([g]) => g);
  return set.length ? set.sort((a, b) => a - b) : [...all];
}
