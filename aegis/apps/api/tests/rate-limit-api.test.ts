import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { disconnectAll, rawPrisma } from "@aegis/db";
import { registerUser } from "@aegis/core";
import { buildApp } from "../src/app.js";

/** The sign-in limit counts sign-ins only; ordinary requests from the same address do not use it up. */
let app: FastifyInstance;
let userId = "";
const email = `ratelimit-${Date.now().toString(36)}@test.aegis.local`;
const password = "CorrectHorse1Battery";
// A unique client address per run keeps these counters apart from every other test's.
const client = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

beforeAll(async () => {
  app = await buildApp();
  userId = (await registerUser({ email, name: "Rate Limit", password })).id;
});

afterAll(async () => {
  await app.close();
  await rawPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
  await disconnectAll();
});

describe("rate limits", () => {
  it("many ordinary requests do not block sign-in, and sign-in still has its own limit", async () => {
    for (let i = 0; i < 15; i++) {
      const r = await app.inject({ method: "GET", url: "/v1/auth/me", remoteAddress: client });
      expect(r.statusCode).toBe(401);
    }
    const ok = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password }, remoteAddress: client });
    expect(ok.statusCode).toBe(200);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: "not-the-password-1" }, remoteAddress: client })).statusCode;
    expect(last).toBe(429);
  });
});
