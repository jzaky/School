"use server";
import { z } from "zod";
import { rawPrisma, withTenant } from "@aegis/db";
import { notFound, verifyChain } from "@aegis/core";
import { requirePlatformAdmin } from "@/server/session";
import { act } from "./util";

export async function verifyTenantChainAction(orgId: string) {
  return act(async () => {
    const admin = await requirePlatformAdmin();
    const id = z.string().uuid().parse(orgId);
    const org = await rawPrisma().organization.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
    if (!org) throw notFound("Organization");
    const started = Date.now();
    const result = await withTenant(id, (db) => verifyChain(db, id), { timeout: 60_000 });
    await rawPrisma().platformEvent.create({ data: { type: "platform.chain_verified", actorId: admin.user.id, orgId: id, detail: { valid: result.valid, checked: result.checked, firstBadSeq: result.firstBadSeq } } });
    return { org, durationMs: Date.now() - started, ...result };
  });
}
