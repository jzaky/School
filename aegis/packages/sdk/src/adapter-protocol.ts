import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Helpers for a customer adapter that receives actions from AEGIS over the execution protocol v1
 * (docs/CONNECTORS.md, "Third connector: any system over HTTPS").
 */
export const AEGIS_EXECUTION_PROTOCOL = "aegis-execution/1";

export interface AegisExecution {
  protocol: typeof AEGIS_EXECUTION_PROTOCOL;
  requestId: string;
  idempotencyKey: string;
  attempt: number;
  tool: string;
  action: string | null;
  params: Record<string, unknown>;
  correlationId: string | null;
  agent: string;
  grant: { requestHash: string; consumedAt: string };
}

export type AegisOperationAnswer = { status: "succeeded" | "failed" | "pending"; reference?: string; summary?: Record<string, unknown>; error?: string };

/**
 * Checks AEGIS-Timestamp and AEGIS-Signature on a request from AEGIS. Pass the raw body exactly as
 * received (an empty string for GET). Refuses signatures older or newer than maxSkewSeconds.
 */
export function verifyAegisSignature(opts: { secret: string; timestamp: string | undefined | null; signature: string | undefined | null; body: string; maxSkewSeconds?: number; now?: number }): boolean {
  const { secret, timestamp, signature, body } = opts;
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  const now = opts.now ?? Date.now();
  if (Math.abs(now / 1000 - Number(timestamp)) > (opts.maxSkewSeconds ?? 300)) return false;
  const expected = Buffer.from(`v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Parses and shape-checks an execute body; returns null when it is not a v1 execution. */
export function parseAegisExecution(body: string): AegisExecution | null {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  const e = v as Partial<AegisExecution> | null;
  if (!e || e.protocol !== AEGIS_EXECUTION_PROTOCOL) return null;
  if (typeof e.requestId !== "string" || typeof e.idempotencyKey !== "string" || typeof e.tool !== "string") return null;
  if (!e.params || typeof e.params !== "object" || !e.grant || typeof e.grant.requestHash !== "string") return null;
  return e as AegisExecution;
}
