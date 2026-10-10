import type { FastifyInstance } from "fastify";
import { rawPrisma } from "@aegis/db";
import { jobStats } from "@aegis/core";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "aegis-api", time: new Date().toISOString() }));
  app.get("/ready", async (_req, reply) => {
    try {
      await rawPrisma().$queryRaw`SELECT 1`;
      const jobs = await jobStats();
      return { ok: true, database: "up", jobs };
    } catch (e) {
      reply.status(503);
      return { ok: false, database: "down", error: e instanceof Error ? e.message : "unknown" };
    }
  });
}
