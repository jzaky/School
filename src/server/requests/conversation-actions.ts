"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/server/context";
import type { Effect } from "@/server/db";
import { flushEffects } from "@/server/queue";
import { ConversationError, MESSAGE_MAX, postMessage } from "./conversation";

const schema = z.object({
  requestId: z.string().min(1).max(64),
  body: z.string().max(MESSAGE_MAX),
  visibility: z.enum(["SHARED", "STAFF", "PRIVATE"]),
  privateToIds: z.array(z.string().max(64)).max(20).optional(),
  notifyFamily: z.boolean().optional(),
  notifyReason: z.string().max(500).optional(),
});

/** Post a message on a request conversation. Access and visibility rules live in ./conversation.ts. */
export async function postRequestMessageAction(input: z.infer<typeof schema>): Promise<{ ok: true; id: string; notified: number } | { ok: false; error: string }> {
  const ctx = await getCtx();
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "INVALID" };
  const effects: Effect[] = [];
  try {
    const res = await postMessage(ctx, p.data, { effects });
    await flushEffects(effects);
    revalidatePath("/", "layout");
    return { ok: true, id: res.id, notified: res.notified };
  } catch (e) {
    if (e instanceof ConversationError) return { ok: false, error: e.message };
    throw e;
  }
}
