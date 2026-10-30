"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { installKitSchema, installPilotKit, setWatchOnly } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

export async function installPilotKitAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const { key, ...rest } = installKitSchema.extend({ key: z.string().min(1).max(60) }).parse(input);
    const out = await withTenant(c.ctx.orgId, (db) => installPilotKit(db, c.ctx, key, rest));
    revalidatePath("/pilots");
    return out;
  });
}

export async function setWatchOnlyAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.object({ agentId: z.string().uuid(), enabled: z.boolean(), reason: z.string().max(500) }).parse(input);
    const out = await withTenant(c.ctx.orgId, (db) => setWatchOnly(db, c.ctx, data.agentId, data));
    revalidatePath("/pilots");
    return out;
  });
}
