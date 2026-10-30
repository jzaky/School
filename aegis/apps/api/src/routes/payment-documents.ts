import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { forbidden, listPaymentDocuments, registerPaymentDocuments, setDocumentMatching, voidPaymentDocument } from "@aegis/core";
import { z } from "zod";
import { requirePerson, requireScope } from "../plugins/auth.js";

/**
 * Payment document matching (docs/PAYMENT_MATCHING.md). The system of record registers invoices, receipts
 * and purchase orders with its integration key; agents are refused. Turning matching on for a tool is a person's call.
 */
export async function paymentDocumentRoutes(app: FastifyInstance) {
  app.post("/register", async (req) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type === "agent") throw forbidden("Agents cannot register the documents they pay against");
    if (ctx.actor.type === "integration") requireScope(req, "grants:verify");
    else if (req.apiKey) throw forbidden("Use the system of record's integration key, or sign in");
    return withTenant(ctx.orgId, (db) => registerPaymentDocuments(db, ctx, req.body ?? {}));
  });
  app.get("/", async (req) => {
    requirePerson(req);
    const ctx = await req.orgContext();
    return { documents: await withTenant(ctx.orgId, (db) => listPaymentDocuments(db, ctx), { readOnly: true }) };
  });
  app.post("/:id/void", async (req) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type === "agent") throw forbidden("Agents cannot void documents");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(500) }).parse(req.body ?? {});
    await withTenant(ctx.orgId, (db) => voidPaymentDocument(db, ctx, id, reason));
    return { ok: true };
  });
  app.post("/tools/:toolId/matching", async (req) => {
    requirePerson(req);
    const ctx = await req.orgContext();
    const { toolId } = z.object({ toolId: z.string().uuid() }).parse(req.params);
    const body = z.object({ config: z.unknown().nullable() }).parse(req.body ?? {});
    return { documentMatch: await withTenant(ctx.orgId, (db) => setDocumentMatching(db, ctx, toolId, body.config)) };
  });
}
