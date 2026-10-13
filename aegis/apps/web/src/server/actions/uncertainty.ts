"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { labelOutcome, labelSchema, recomputeCalibration, uncertaintyPolicySchema, updateToolUncertaintyPolicy, forbidden } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

export async function labelOutcomeAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = labelSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => labelOutcome(db, c.ctx, data, "reviewer"));
    revalidatePath(`/gateway/${data.actionRequestId}`);
    revalidatePath("/uncertainty");
  });
}

export async function updateToolUncertaintyPolicyAction(toolId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = uncertaintyPolicySchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => updateToolUncertaintyPolicy(db, c.ctx, z.string().uuid().parse(toolId), data));
    revalidatePath("/uncertainty");
  });
}

export async function recomputeCalibrationAction() {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("monitoring:write")) throw forbidden("Requires monitoring:write");
    const written = await withTenant(c.ctx.orgId, (db) => recomputeCalibration(db, c.ctx), { lock: "lazy", timeout: 60_000 });
    revalidatePath("/uncertainty");
    return { profiles: written.length };
  });
}
