import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { forbidden } from "@aegis/core";
import { attachSoftwareEvidence, getSoftware, listSoftware, requestSoftware, SOFTWARE_EVIDENCE_FORMATS } from "@aegis/core/secure/software";
import { requirePerson } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });
const evidenceBody = z.object({ format: z.enum(SOFTWARE_EVIDENCE_FORMATS), text: z.string() }).strict();

/**
 * Software security (docs/SOFTWARE_SECURITY.md). Mount under /v1/software. People only: requests, SBOMs and
 * scanner reports come from signed-in users (a CI pipeline can post with a person's session in a later phase).
 */
export async function softwareRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (req.apiKey) throw forbidden("Software requests and decisions are made by people in the console");
    requirePerson(req);
  });
  app.get("/", async (req) => {
    const ctx = await req.orgContext();
    return withTenant(ctx.orgId, (db) => listSoftware(db, ctx), { readOnly: true });
  });
  app.get("/:id", async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    return withTenant(ctx.orgId, (db) => getSoftware(db, ctx, id), { readOnly: true });
  });
  app.post("/", async (req, reply) => {
    const ctx = await req.orgContext();
    const r = await withTenant(ctx.orgId, (db) => requestSoftware(db, ctx, req.body as never));
    return reply.code(201).send(r);
  });
  app.post("/:id/evidence", { bodyLimit: 26 * 1024 * 1024 }, async (req) => {
    const ctx = await req.orgContext();
    const { id } = idParam.parse(req.params);
    const body = evidenceBody.parse(req.body);
    return withTenant(ctx.orgId, (db) => attachSoftwareEvidence(db, ctx, id, body));
  });
}
