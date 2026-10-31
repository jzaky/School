import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit, { type FastifyRateLimitStoreCtor } from "@fastify/rate-limit";
import { env, isAegisError, jsonDepth, logger, m, secretBucketKey, SharedRateLimitStore } from "@aegis/core";
import { ZodError } from "zod";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { agentRoutes } from "./routes/agents.js";
import { registerModuleRoutes } from "./routes/index.js";
import { aiGatewayRoutes } from "./routes/ai-gateway.js";

/**
 * "all" is the full API. "ai-gateway" serves only health and the AI gateway, so the part that forwards
 * employee prompts to model providers can run as its own process (src/ai-gateway-server.ts).
 */
const MAX_BODY_DEPTH = 48;

export async function buildApp(opts: { modules?: "all" | "ai-gateway"; onRoute?: (route: { method: string | string[]; url: string }) => void } = {}): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    loggerInstance: logger.child({ component: "api" }) as unknown as FastifyBaseLogger,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 1024 * 1024,
    // Only proxies on private networks are trusted for X-Forwarded-For by default, so a client cannot spoof its
    // address (rate limits and the localhost-only metrics check use it). AEGIS_TRUST_PROXY overrides: "true",
    // "false", or a comma-separated list of addresses or CIDR ranges.
    trustProxy: trustProxySetting(process.env.AEGIS_TRUST_PROXY),
  });

  // Tests list every registered route (the attack sweeps in tests/enterprise-attacks.test.ts).
  if (opts.onRoute) app.addHook("onRoute", (r) => opts.onRoute!({ method: r.method, url: r.url }));

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
    // Counters are shared by every replica (PostgreSQL), so limits do not multiply with the replica count.
    store: SharedRateLimitStore as unknown as FastifyRateLimitStoreCtor,
    // Bucket per full credential (hashed), never a guessable fragment of it; per client address otherwise.
    keyGenerator: (req) => (req.headers.authorization ? secretBucketKey("key", req.headers.authorization) : `ip:${req.ip}`),
  });
  await app.register(authPlugin);

  // Bodies the database layer cannot store are refused here, for every route, instead of failing deep inside a
  // write: a NUL character (PostgreSQL text and JSON hold none) or nesting deeper than any real document needs.
  app.addHook("preValidation", async (req, reply) => {
    if (!req.body || typeof req.body !== "object") return;
    if (jsonDepth(req.body) > MAX_BODY_DEPTH) return reply.status(400).send({ error: { code: "validation", message: `The request is nested more than ${MAX_BODY_DEPTH} levels deep` }, requestId: req.id });
    if (JSON.stringify(req.body).includes("\\u0000")) return reply.status(400).send({ error: { code: "validation", message: "The request contains a NUL character" }, requestId: req.id });
  });

  // Request metrics by route group (the first two path segments) and status class; never by id.
  app.addHook("onResponse", async (req, reply) => {
    const group = (req.routeOptions.url ?? req.url).split("?")[0]!.split("/").slice(0, 3).join("/") || "/";
    m.httpRequests.inc({ route: group, status: `${Math.floor(reply.statusCode / 100)}xx` });
    m.httpRequestSeconds.observe(reply.elapsedTime / 1000, { route: group });
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (isAegisError(err)) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? null }, requestId: req.id });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: "validation", message: "Invalid request", details: err.flatten() }, requestId: req.id });
    }
    const e = err as { statusCode?: number; message?: string; name?: string; code?: unknown };
    // Prisma "record to update or delete not found": an id this tenant cannot see is a 404, never a 500.
    if (e.name === "PrismaClientKnownRequestError" && e.code === "P2025") {
      return reply.status(404).send({ error: { code: "not_found", message: "Not found" }, requestId: req.id });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.statusCode === 429 ? "rate_limited" : "request", message: e.message ?? "Request error" }, requestId: req.id });
    }
    req.log.error({ err: { message: e.message, name: e.name }, requestId: req.id }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Internal error" }, requestId: req.id });
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "not_found", message: "Route not found" }, requestId: req.id }));

  await app.register(healthRoutes);
  if (opts.modules === "ai-gateway") {
    await app.register(aiGatewayRoutes, { prefix: "/v1/ai" });
    return app;
  }
  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(agentRoutes, { prefix: "/v1/agents" });
  await registerModuleRoutes(app);
  return app;
}

export function trustProxySetting(v: string | undefined): boolean | string {
  const raw = (v ?? "").trim();
  if (!raw) return "loopback,linklocal,uniquelocal";
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}
