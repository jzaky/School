"use server";
import { z } from "zod";
import { rawPrisma } from "@aegis/db";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const schema = z.object({ name: z.string().min(2).max(120), email: z.string().email().max(254), seats: z.coerce.number().int().min(1).max(100000).optional(), message: z.string().max(2000).default("") });

/** Records an enterprise pricing inquiry as a platform event. Only the fields the user typed are stored. */
export async function requestEnterprisePricingAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = schema.parse(input);
    const row = await rawPrisma().platformEvent.create({ data: { type: "billing.inquiry", actorId: c.session.user.id, orgId: c.org.id, detail: { name: data.name, email: data.email, seats: data.seats ?? null, message: data.message, orgSlug: c.org.slug } } });
    return { reference: row.id.slice(0, 8).toUpperCase() };
  });
}
