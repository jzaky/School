// Finance hold (off by default): when a school switches it on, families with an invoice overdue for more than the
// configured number of days cannot download the child's report card PDF until the account is settled. Staff can
// always download. The family sees a plain message asking them to contact the accounts office; a student sees a
// message without any mention of fees.
import type { TenantDb } from "@/lib/tenant-db";
import { loadFinanceConfig } from "./config";

export async function reportCardOnHold(db: TenantDb, orgId: string, studentId: string, now = new Date()): Promise<boolean> {
  const cfg = await loadFinanceConfig(db, orgId);
  if (!cfg.holdReportCards) return false;
  const profile = await db.studentFeeProfile.findFirst({ where: { orgId, studentId }, select: { accountId: true } });
  if (!profile) return false;
  const cutoff = new Date(now.getTime() - cfg.holdAfterDays * 86_400_000);
  const overdue = await db.invoice.findFirst({ where: { orgId, accountId: profile.accountId, kind: "TAX", status: { in: ["OPEN", "PARTIAL"] }, dueDate: { lt: cutoff } }, select: { id: true } });
  return Boolean(overdue);
}
