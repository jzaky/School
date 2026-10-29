import type { FastifyInstance, FastifyRequest } from "fastify";
import { withTenant } from "@aegis/db";
import { forbidden, listExpenseClaims, registerTransactions, setClaimRule, submitExpenseClaim } from "@aegis/core";
import { z } from "zod";
import { requirePerson, requireScope } from "../plugins/auth.js";

/**
 * Expense receipt validation (docs/RECEIPT_VALIDATION.md). The bank or card feed registers transactions and the
 * expense system submits claims, each with its integration key; agents are refused. Setting a tool's claim rule is a person's call.
 */
export async function expenseRoutes(app: FastifyInstance) {
  const systemOfRecord = async (req: FastifyRequest) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type === "agent") throw forbidden("Agents cannot submit financial records");
    if (ctx.actor.type === "integration") requireScope(req, "grants:verify");
    else if (req.apiKey) throw forbidden("Use the system of record's integration key, or sign in");
    return ctx;
  };
  app.post("/transactions", async (req) => {
    const ctx = await systemOfRecord(req);
    return withTenant(ctx.orgId, (db) => registerTransactions(db, ctx, req.body ?? {}));
  });
  app.post("/claims", async (req, reply) => {
    const ctx = await systemOfRecord(req);
    const r = await withTenant(ctx.orgId, (db) => submitExpenseClaim(db, ctx, req.body ?? {}));
    return reply.code(201).send({ ref: r.claim.ref, verdict: r.verdict, findings: r.findings });
  });
  app.get("/claims", async (req) => {
    requirePerson(req);
    const ctx = await req.orgContext();
    const rows = await withTenant(ctx.orgId, (db) => listExpenseClaims(db, ctx), { readOnly: true });
    return { claims: rows.map(({ totalMinor: _t, claimedMinor: _c, subtotalMinor: _s, vatMinor: _v, ...r }) => r) };
  });
  app.post("/tools/:toolId/claim-rule", async (req) => {
    requirePerson(req);
    const ctx = await req.orgContext();
    const { toolId } = z.object({ toolId: z.string().uuid() }).parse(req.params);
    const body = z.object({ config: z.unknown().nullable() }).parse(req.body ?? {});
    return { expenseClaims: await withTenant(ctx.orgId, (db) => setClaimRule(db, ctx, toolId, body.config)) };
  });
}
