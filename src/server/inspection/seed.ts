// Installs the default inspection mapping rows for a school. Idempotent: rows the school already has (edited
// or not) are never overwritten. Runs with a tenant transaction client or the owner client in seeds.
import type { Prisma, PrismaClient, Regulator } from "@prisma/client";
import { defaultMapping } from "./mapping";

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureInspectionMapping(db: Db, orgId: string): Promise<number> {
  const res = await db.inspectionMapping.createMany({
    data: defaultMapping().map((r) => ({ orgId, headingKey: r.headingKey, framework: r.framework as Regulator, areaEn: r.areaEn, areaAr: r.areaAr, noteEn: r.noteEn ?? null, noteAr: r.noteAr ?? null, sortOrder: r.sortOrder ?? 0 })),
    skipDuplicates: true,
  });
  return res.count;
}
