"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { deleteSchool, platformDb, schoolDeletionReport, type SchoolDeletionReport } from "./school-delete";
import { isPlatformAdmin } from "./admin";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function platformCtx() {
  const ctx = await getCtx();
  if (!isPlatformAdmin(ctx.user)) return null;
  const db = platformDb();
  return db ? { ctx, db } : null;
}

export async function schoolDeletionDryRunAction(input: { orgId: string }): Promise<Res<{ report: SchoolDeletionReport }>> {
  const p = await platformCtx();
  if (!p) return { ok: false, error: "FORBIDDEN" };
  const report = await schoolDeletionReport(p.db, input.orgId);
  if (!report) return { ok: false, error: "NOT_FOUND" };
  return { ok: true, report };
}

export async function deleteSchoolAction(input: { orgId: string; confirm: string }): Promise<Res<{ totalRows: number; files: number; users: number }>> {
  const p = await platformCtx();
  if (!p) return { ok: false, error: "FORBIDDEN" };
  const res = await deleteSchool(p.db, input.orgId, { confirm: input.confirm, actorUserId: p.ctx.user.id, actorOrgId: p.ctx.orgId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/[locale]/platform/schools", "page");
  return { ok: true, totalRows: res.report.totalRows, files: res.filesRemoved, users: res.usersRemoved };
}
