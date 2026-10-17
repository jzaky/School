"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { addIncidentNote, assignIncident, createIncident, createIncidentSchema, getSecurityEvent, linkSecurityEvent, setIncidentStatus, setIncidentStatusSchema } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

function revalidateIncident(id?: string) {
  revalidatePath("/security/incidents");
  revalidatePath("/security/events");
  revalidatePath("/overview");
  if (id) revalidatePath(`/security/incidents/${id}`);
}

export async function createIncidentAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = createIncidentSchema.parse(input);
    const incident = await withTenant(c.ctx.orgId, (db) => createIncident(db, c.ctx, data));
    revalidateIncident(incident.id);
    for (const ev of data.securityEventIds) revalidatePath(`/security/events/${ev}`);
    return { id: incident.id, number: incident.number };
  });
}

/** Opens an incident seeded from one security event: title, severity and agent come from the event. */
export async function createIncidentFromEventAction(eventId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(eventId);
    const extra = z.object({ title: z.string().min(3).max(200).optional(), summary: z.string().max(5000).default("") }).parse(input);
    const incident = await withTenant(c.ctx.orgId, async (db) => {
      const ev = await getSecurityEvent(db, c.ctx, id);
      return createIncident(db, c.ctx, { title: extra.title ?? ev.title.slice(0, 200), severity: ev.severity as "low" | "medium" | "high" | "critical", summary: extra.summary, agentIds: ev.agentId ? [ev.agentId] : [], securityEventIds: [ev.id], assigneeId: null });
    });
    revalidateIncident(incident.id);
    revalidatePath(`/security/events/${id}`);
    return { id: incident.id, number: incident.number };
  });
}

export async function assignIncidentAction(incidentId: string, assigneeId: string | null, note = "") {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(incidentId);
    const to = assigneeId ? uuid.parse(assigneeId) : null;
    await withTenant(c.ctx.orgId, (db) => assignIncident(db, c.ctx, id, to, z.string().max(2000).parse(note)));
    revalidateIncident(id);
  });
}

export async function addIncidentNoteAction(incidentId: string, note: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(incidentId);
    await withTenant(c.ctx.orgId, (db) => addIncidentNote(db, c.ctx, id, z.string().max(5000).parse(note)));
    revalidateIncident(id);
  });
}

export async function linkSecurityEventAction(incidentId: string, eventId: string, note = "") {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(incidentId);
    const ev = uuid.parse(eventId);
    await withTenant(c.ctx.orgId, (db) => linkSecurityEvent(db, c.ctx, id, ev, z.string().max(2000).parse(note)));
    revalidateIncident(id);
    revalidatePath(`/security/events/${ev}`);
  });
}

export async function setIncidentStatusAction(incidentId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(incidentId);
    const data = setIncidentStatusSchema.parse(input);
    const updated = await withTenant(c.ctx.orgId, (db) => setIncidentStatus(db, c.ctx, id, data));
    revalidateIncident(id);
    return { status: updated.status };
  });
}
