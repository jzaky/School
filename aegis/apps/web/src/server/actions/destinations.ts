"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { createDestination, destinationCommonSchema, destinationInputSchema, replaceDestinationSecret, retryDelivery, sendTestEvent, updateDestination } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

export async function createDestinationAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = { ...destinationInputSchema.parse(input), ...destinationCommonSchema.parse(input) };
    const out = await withTenant(c.ctx.orgId, (db) => createDestination(db, c.ctx, data));
    revalidatePath("/integrations/destinations");
    return { id: out.destination.id, signingSecret: out.signingSecret };
  });
}

export async function updateDestinationAction(id: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = destinationCommonSchema.partial().extend({ enabled: z.boolean().optional() }).parse(input);
    await withTenant(c.ctx.orgId, (db) => updateDestination(db, c.ctx, uuid.parse(id), data));
    revalidatePath(`/integrations/destinations/${id}`);
    revalidatePath("/integrations/destinations");
  });
}

export async function replaceDestinationSecretAction(id: string, secret: string | null) {
  return act(async () => {
    const c = await getConsoleContext();
    const out = await withTenant(c.ctx.orgId, (db) => replaceDestinationSecret(db, c.ctx, uuid.parse(id), secret));
    revalidatePath(`/integrations/destinations/${id}`);
    return out;
  });
}

export async function sendTestEventAction(id: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const out = await sendTestEvent((fn) => withTenant(c.ctx.orgId, fn), c.ctx, uuid.parse(id));
    revalidatePath(`/integrations/destinations/${id}`);
    return out;
  });
}

export async function retryDeliveryAction(destinationId: string, deliveryId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => retryDelivery(db, c.ctx, uuid.parse(deliveryId)));
    revalidatePath(`/integrations/destinations/${destinationId}`);
  });
}
