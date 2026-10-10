import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { env, isAegisError, logger } from "@aegis/core";
import { ZodError } from "zod";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { agentRoutes } from "./routes/agents.js";
import { registerModuleRoutes } from "./routes/index.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    loggerInstance: logger.child({ component: "api" }) as unknown as FastifyBaseLogger,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  // Evidence sequence numbers are BigInt; serialise them as strings everywhere.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  app.setReplySerializer((payload) => JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env().API_CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-request-id", "idempotency-key", "x-aegis-signature", "x-aegis-timestamp"],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req.headers.authorization ? `key:${req.headers.authorization.slice(-16)}` : `ip:${req.ip}`),
  });
  await app.register(authPlugin);

  app.setErrorHandler((err: unknown, req, reply) => {
    if (isAegisError(err)) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? null }, requestId: req.id });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "validation", message: "Invalid request", details: err.flatten() }, requestId: req.id });
    }
    const e = err as { statusCode?: number; message?: string; name?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.statusCode === 429 ? "rate_limited" : "request", message: e.message ?? "Request error" }, requestId: req.id });
    }
    req.log.error({ err: { message: e.message, name: e.name }, requestId: req.id }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Internal error" }, requestId: req.id });
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "not_found", message: "Route not found" }, requestId: req.id }));

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(agentRoutes, { prefix: "/v1/agents" });
  await registerModuleRoutes(app);
  return app;
}
