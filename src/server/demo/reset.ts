"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { runDemoResetCore } from "./run-reset";

/** Restore the demo school to its seeded story. Only available inside the demo organization. */
export async function resetDemoAction() {
  const ctx = await getCtx();
  if (!ctx.org.isDemo) return { ok: false, error: "not_demo" };
  if (!ctx.persona && !ctx.can("demo.reset")) return { ok: false, error: "forbidden" };
  const res = await runDemoReset();
  revalidatePath("/", "layout");
  return { ok: true, ms: res.ms };
}

// Not exported: every export of a "use server" module is callable from the browser, and a reset must
// always pass the checks in resetDemoAction. The worker and scripts use runDemoResetCore directly.
async function runDemoReset(): Promise<{ ms: number }> {
  return runDemoResetCore();
}
