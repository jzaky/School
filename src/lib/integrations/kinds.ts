// What a sync source can import: the Import center kinds that come from a school's own system export, and
// the columns each reads. Pure: shared by the mapping editor and the worker.
import { STUDENT_COLUMNS } from "@/lib/people-csv";
import { STAFF_COLUMNS } from "@/lib/imports/staff";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS } from "@/lib/imports/classes";
import type { ColumnSpec } from "@/lib/imports/headers";

export const SYNC_KINDS = ["staff", "students", "classes", "enrollments"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];
export const isSyncKind = (v: unknown): v is SyncKind => typeof v === "string" && (SYNC_KINDS as readonly string[]).includes(v);

export const SYNC_COLUMNS: Record<SyncKind, ColumnSpec[]> = { staff: STAFF_COLUMNS, students: STUDENT_COLUMNS, classes: CLASS_COLUMNS, enrollments: ENROLLMENT_COLUMNS };
