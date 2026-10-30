"use server";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { decisionRecord, recheckWithCurrentPolicies } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

export async function recheckDecisionAction(requestId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    return withTenant(c.ctx.orgId, (db) => recheckWithCurrentPolicies(db, c.ctx, uuid.parse(requestId)), { readOnly: true });
  });
}

export async function decisionRecordAction(requestId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const { record, sha256 } = await withTenant(c.ctx.orgId, (db) => decisionRecord(db, c.ctx, uuid.parse(requestId)));
    return { json: JSON.stringify(record, null, 2), sha256 };
  });
}
