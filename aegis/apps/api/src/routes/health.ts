import type { FastifyInstance } from "fastify";
import { rawPrisma } from "@aegis/db";
import { constantTimeEqual, env, jobStats, prometheusText } from "@aegis/core";

/**
 * Prometheus scrape endpoint (docs/PERFORMANCE.md). With AEGIS_METRICS_TOKEN set it requires that bearer
 * token; without it only requests from the same host are answered. Metrics carry no ids or personal data.
 */
function metricsAllowed(authorization: string | undefined, ip: string): boolean {
  const token = env().AEGIS_METRICS_TOKEN;
  if (token) return !!authorization && constantTimeEqual(authorization, `Bearer ${token}`);
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/metrics", { config: { rateLimit: false } }, async (req, reply) => {
    if (!metricsAllowed(req.headers.authorization, req.ip)) {
      reply.status(404);
      return { error: { code: "not_found", message: "Route not found" } };
    }
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return prometheusText();
  });
  app.get("/health", async () => ({ ok: true, service: "aegis-api", time: new Date().toISOString() }));
  app.get("/ready", async (_req, reply) => {
    try {
      await rawPrisma().$queryRaw`SELECT 1`;
      const jobs = await jobStats();
      return { ok: true, database: "up", jobs };
    } catch (e) {
      // The cause goes to the server log only; the public response never carries database errors.
      app.log.error({ err: e }, "readiness check failed");
      reply.status(503);
      return { ok: false, database: "down" };
    }
  });
}
