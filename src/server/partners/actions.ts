"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { deletePartner, PartnerError, savePartner, type PartnerInput } from "./service";

type Result = { ok: true; id?: string } | { ok: false; error: string };

async function manager() {
  const ctx = await getCtx();
  return ctx.isStaff && ctx.can("career.partners") ? ctx : null;
}

function fail(e: unknown): Result {
  if (e instanceof PartnerError) return { ok: false, error: e.code };
  throw e;
}

export async function savePartnerAction(input: PartnerInput): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    const row = await tenantTx(ctx.orgId, (tx) => savePartner(tx, ctx.orgId, input, ctx.membershipId));
    revalidatePath("/", "layout");
    return { ok: true, id: row.id };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePartnerAction(id: string): Promise<Result> {
  const ctx = await manager();
  if (!ctx) return { ok: false, error: "FORBIDDEN" };
  try {
    await tenantTx(ctx.orgId, (tx) => deletePartner(tx, ctx.orgId, id, ctx.membershipId));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
