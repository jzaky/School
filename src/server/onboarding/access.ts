import "server-only";
import { getCtx, type Ctx } from "@/server/context";

/** Who may run the setup wizard: school administrators and principals. */
export const canSetup = (ctx: Ctx) => ctx.can("school.manage") || ctx.roles.includes("principal");

/** The request context when the member may run the setup wizard, else null. */
export async function setupCtx(): Promise<Ctx | null> {
  const ctx = await getCtx();
  return canSetup(ctx) ? ctx : null;
}
