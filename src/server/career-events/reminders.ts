// Worker job "careerEvents.reminders" (hourly): reminders for registered students and families a day before
// a university fair, visit or info session. Idempotent through JobRun keys (see sendDueReminders).
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { flushEffects } from "@/server/queue-core";
import { sendDueReminders } from "./service";

export async function runCareerEventReminders(orgId: string, opts: { now?: Date; flush?: (e: Effect[]) => Promise<void> } = {}) {
  const effects: Effect[] = [];
  const res = await tenantTx(orgId, (tx) => sendDueReminders(execCtx(tx, orgId, { now: opts.now ?? new Date(), effects })), { timeout: 120_000 });
  await (opts.flush ?? flushEffects)(effects);
  return res;
}
