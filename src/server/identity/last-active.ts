// Membership.lastSeenAt ("last active"), written at most once per 15 minutes per membership.
// The request context already loads the membership row, so a fresh timestamp costs no query at all;
// a stale one costs one conditional update (which also makes concurrent requests write only once).
// A small in-process memo stops bursts of parallel requests from each trying the update.
import type { TenantDb, TenantTx } from "@/lib/tenant-db";

export const LAST_ACTIVE_THROTTLE_MS = 15 * 60_000;

const memo = new Map<string, number>();
const MEMO_MAX = 5000;

export function lastActiveIsStale(lastSeenAt: Date | null | undefined, now: Date) {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= LAST_ACTIVE_THROTTLE_MS;
}

/** Record activity for a membership. Returns true when a row was written. */
export async function touchLastActive(db: TenantDb | TenantTx, membershipId: string, lastSeenAt: Date | null | undefined, now = new Date()): Promise<boolean> {
  if (!lastActiveIsStale(lastSeenAt, now)) return false;
  const recent = memo.get(membershipId);
  if (recent && now.getTime() - recent < LAST_ACTIVE_THROTTLE_MS) return false;
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(membershipId, now.getTime());
  const threshold = new Date(now.getTime() - LAST_ACTIVE_THROTTLE_MS);
  const res = await db.membership.updateMany({
    where: { id: membershipId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: threshold } }] },
    data: { lastSeenAt: now },
  });
  return res.count === 1;
}

/** Test helper: forget the in-process memo. */
export function resetLastActiveMemo() {
  memo.clear();
}
