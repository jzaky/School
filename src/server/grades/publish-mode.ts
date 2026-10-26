// Who publishes grades and report cards at a school: "Teachers publish their own" (TEACHER, the default) or
// "Teachers submit, a publisher releases" (PUBLISHER, holders of grades.publish release).
import type { GradePublishMode } from "@prisma/client";
import type { TenantDb, TenantTx } from "@/lib/tenant-db";

export async function publishModeOf(db: TenantDb | TenantTx): Promise<GradePublishMode> {
  const row = await (db as TenantTx).gradeSettings.findFirst({ select: { publishMode: true } });
  return row?.publishMode ?? "TEACHER";
}
