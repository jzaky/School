import { randomUUID } from "node:crypto";

export type ActorType = "user" | "agent" | "system" | "integration";

export interface Actor {
  type: ActorType;
  id: string | null;
  /** Display label for evidence (never personal data beyond a name). */
  label?: string;
  /** Permissions resolved for user actors. */
  permissions?: string[];
  membershipId?: string;
}

export interface OrgContext {
  orgId: string;
  actor: Actor;
  requestId: string;
  ip?: string;
  traceId?: string;
}

export const systemActor: Actor = { type: "system", id: null, label: "system" };

export function makeContext(orgId: string, actor: Actor, extra: Partial<Omit<OrgContext, "orgId" | "actor">> = {}): OrgContext {
  return { orgId, actor, requestId: extra.requestId ?? randomUUID(), ip: extra.ip, traceId: extra.traceId };
}

export function systemContext(orgId: string): OrgContext {
  return makeContext(orgId, systemActor);
}
