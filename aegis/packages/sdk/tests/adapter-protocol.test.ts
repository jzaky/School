import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseAegisExecution, verifyAegisSignature } from "../src/adapter-protocol.js";

const secret = "s".repeat(40);
const sign = (ts: string, body: string) => `v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;

describe("AEGIS execution protocol helpers", () => {
  it("accepts a fresh, correct signature and refuses tampering, other secrets and stale timestamps", () => {
    const now = 1_800_000_000_000;
    const ts = String(now / 1000);
    const body = '{"a":1}';
    expect(verifyAegisSignature({ secret, timestamp: ts, signature: sign(ts, body), body, now })).toBe(true);
    expect(verifyAegisSignature({ secret, timestamp: ts, signature: sign(ts, body), body: '{"a":2}', now })).toBe(false);
    expect(verifyAegisSignature({ secret: "x".repeat(40), timestamp: ts, signature: sign(ts, body), body, now })).toBe(false);
    expect(verifyAegisSignature({ secret, timestamp: ts, signature: sign(ts, body), body, now: now + 301_000 })).toBe(false);
    expect(verifyAegisSignature({ secret, timestamp: null, signature: sign(ts, body), body, now })).toBe(false);
    expect(verifyAegisSignature({ secret, timestamp: ts, signature: "v1=00", body, now })).toBe(false);
  });

  it("parses only v1 executions", () => {
    const ok = { protocol: "aegis-execution/1", requestId: "r", idempotencyKey: "aegis:r", attempt: 1, tool: "t", action: null, params: {}, correlationId: null, agent: "a", grant: { requestHash: "h", consumedAt: "2026-10-16T00:00:00Z" } };
    expect(parseAegisExecution(JSON.stringify(ok))?.tool).toBe("t");
    expect(parseAegisExecution(JSON.stringify({ ...ok, protocol: "other" }))).toBeNull();
    expect(parseAegisExecution(JSON.stringify({ ...ok, grant: undefined }))).toBeNull();
    expect(parseAegisExecution("not json")).toBeNull();
  });
});
