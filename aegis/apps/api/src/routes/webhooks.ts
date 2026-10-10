import type { FastifyInstance } from "fastify";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { appendEvidence, forbidden, makeContext, recordIntegrationHealth, verifyWebhook } from "@aegis/core";

/**
 * Inbound webhooks from integrations (health pings, execution callbacks). Authenticated by an
 * integration API key AND an HMAC signature over the raw body with a timestamp (replay window 5 min).
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body.length ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  app.addHook("preParsing", async (req, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const c of payload) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const raw = Buffer.concat(chunks);
    (req as unknown as { rawBody: string }).rawBody = raw.toString("utf8");
    const { Readable } = await import("node:stream");
    return Readable.from([raw]);
  });

  app.post("/:integrationKey", async (req, reply) => {
    const ctx = await req.orgContext();
    if (ctx.actor.type !== "integration") throw forbidden("Use an integration API key");
    const { integrationKey } = z.object({ integrationKey: z.string() }).parse(req.params);
    const raw = (req as unknown as { rawBody: string }).rawBody ?? "";
    const check = await withTenant(ctx.orgId, (db) => verifyWebhook(db, integrationKey, { timestamp: req.headers["x-aegis-timestamp"] as string | undefined, signature: req.headers["x-aegis-signature"] as string | undefined }, raw));
    if (!check.ok) {
      await withTenant(ctx.orgId, (db) => appendEvidence(db, makeContext(ctx.orgId, { type: "integration", id: ctx.actor.id }), { type: "webhook.rejected", subjectType: "integration", subjectId: integrationKey, payload: { reason: check.reason } }));
      reply.status(401);
      return { ok: false, reason: check.reason };
    }
    const body = z.object({ type: z.string(), payload: z.record(z.unknown()).default({}) }).parse(req.body);
    await withTenant(ctx.orgId, async (db) => {
      const integ = await db.integration.findFirst({ where: { key: integrationKey } });
      if (integ && body.type === "health") await recordIntegrationHealth(db, integ.id, body.payload.ok !== false);
      await appendEvidence(db, makeContext(ctx.orgId, { type: "integration", id: ctx.actor.id }), { type: `webhook.${body.type}`, subjectType: "integration", subjectId: integ?.id ?? integrationKey, payload: { keys: Object.keys(body.payload) } });
    });
    return { ok: true };
  });
}
