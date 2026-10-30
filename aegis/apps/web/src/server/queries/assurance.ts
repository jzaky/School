import "server-only";
import type { TenantDb } from "@aegis/db";
import { userNames } from "./users";

export interface ActorLabels {
  users: Map<string, string>;
  agents: Map<string, string>;
}

/** Display labels for the actors and subjects referenced by a set of evidence events. */
export async function evidenceLabels(db: TenantDb, events: { actorType: string; actorId: string | null; subjectType: string; subjectId: string | null }[]): Promise<ActorLabels> {
  const userIds = events.filter((e) => e.actorType === "user").map((e) => e.actorId);
  const agentIds = new Set<string>();
  for (const e of events) {
    if (e.actorType === "agent" && e.actorId) agentIds.add(e.actorId);
    if (e.subjectType === "agent" && e.subjectId) agentIds.add(e.subjectId);
  }
  const [users, agents] = await Promise.all([userNames(userIds), agentIds.size ? db.agent.findMany({ where: { id: { in: [...agentIds] } }, select: { id: true, name: true } }) : []]);
  return { users, agents: new Map(agents.map((a) => [a.id, a.name])) };
}

export function actorLabel(e: { actorType: string; actorId: string | null }, labels: ActorLabels): string {
  if (e.actorType === "user") return labels.users.get(e.actorId ?? "") ?? "User";
  if (e.actorType === "agent") return labels.agents.get(e.actorId ?? "") ?? "Agent";
  if (e.actorType === "system") return "System";
  return e.actorType;
}
