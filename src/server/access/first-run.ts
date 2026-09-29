// First-run tip card for people who just joined: shown for their first two weeks until dismissed.
import { cookies } from "next/headers";

export const FIRST_RUN_COOKIE = "firstrun_done";
const FIRST_RUN_DAYS = 14;

export async function showFirstRun(membership: { id: string; createdAt: Date }, now = new Date()): Promise<boolean> {
  if (now.getTime() - membership.createdAt.getTime() > FIRST_RUN_DAYS * 86_400_000) return false;
  const done = ((await cookies()).get(FIRST_RUN_COOKIE)?.value ?? "").split(".");
  return !done.includes(membership.id);
}
