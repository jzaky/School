import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { addIncidentNote, assignIncident, createIncident, getIncident, incidentStats, linkSecurityEvent, listIncidents, setIncidentStatus } from "../src/incidents/service.js";
import { createSecurityEvent } from "../src/shield/security-events.js";

describe("incidents", () => {
  let t: TestTenant;
  let analyst: Awaited<ReturnType<typeof addUserWithRole>>;
  let analyst2: Awaited<ReturnType<typeof addUserWithRole>>;
  let viewer: Awaited<ReturnType<typeof addUserWithRole>>;
  beforeAll(async () => {
    t = await makeTestTenant("inc");
    analyst = await addUserWithRole(t, "security_analyst", "sec");
    analyst2 = await addUserWithRole(t, "security_analyst", "sec2");
    viewer = await addUserWithRole(t, "viewer", "view");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("numbers incidents per org, notifies analysts once and writes evidence", async () => {
    const a = await withTenant(t.orgId, (db) => createIncident(db, analyst.ctx, { title: "First incident", severity: "high", summary: "", agentIds: [], securityEventIds: [] }));
    const b = await withTenant(t.orgId, (db) => createIncident(db, analyst.ctx, { title: "Second incident", severity: "low", summary: "", agentIds: [], securityEventIds: [] }));
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(a.status).toBe("open");
    const notes = await withTenant(t.orgId, (db) => db.notification.findMany({ where: { orgId: t.orgId, type: "incident.created", link: `/incidents/${a.id}` } }));
    // owner (*), analyst, analyst2 hold security:write; viewer does not.
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set([t.ownerUserId, analyst.userId, analyst2.userId]));
    const ev = await withTenant(t.orgId, (db) => db.evidenceEvent.findMany({ where: { orgId: t.orgId, type: "incident.created" } }));
    expect(ev.length).toBe(2);
    await expect(withTenant(t.orgId, (db) => createIncident(db, viewer.ctx, { title: "Nope", severity: "low", summary: "", agentIds: [], securityEventIds: [] }))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("walks the status lifecycle with its guards", async () => {
    const inc = await withTenant(t.orgId, (db) => createIncident(db, analyst.ctx, { title: "Lifecycle", severity: "medium", summary: "", agentIds: [], securityEventIds: [] }));
    await expect(withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "open", note: "" }))).rejects.toMatchObject({ code: "validation" });
    await expect(withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "resolved", note: "" }))).rejects.toMatchObject({ code: "validation" });
    await withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "investigating", note: "Looking" }));
    await expect(withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "open", note: "back" }))).rejects.toMatchObject({ code: "validation" });
    await withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "contained", note: "Agent suspended" }));
    const resolved = await withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "resolved", note: "Done", summary: "Root cause found and fixed." }));
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).not.toBeNull();
    await expect(withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "investigating", note: "" }))).rejects.toMatchObject({ code: "validation" });
    await expect(withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "contained", note: "x" }))).rejects.toMatchObject({ code: "validation" });
    const reopened = await withTenant(t.orgId, (db) => setIncidentStatus(db, analyst.ctx, inc.id, { status: "investigating", note: "New evidence arrived" }));
    expect(reopened.status).toBe("investigating");
    expect(reopened.resolvedAt).toBeNull();
    await expect(withTenant(t.orgId, (db) => setIncidentStatus(db, viewer.ctx, inc.id, { status: "contained", note: "" }))).rejects.toMatchObject({ code: "forbidden" });
    const detail = await withTenant(t.orgId, (db) => getIncident(db, analyst.ctx, inc.id));
    expect(detail.events.map((e) => e.type)).toEqual(["created", "status_investigating", "status_contained", "status_resolved", "reopened"]);
    expect(detail.timeline.length).toBe(detail.events.length);
  });

  it("assigns, annotates, links events and builds a timeline", async () => {
    const inc = await withTenant(t.orgId, (db) => createIncident(db, analyst.ctx, { title: "Linking", severity: "high", summary: "", agentIds: [], securityEventIds: [] }));
    await expect(withTenant(t.orgId, (db) => assignIncident(db, analyst.ctx, inc.id, "00000000-0000-7000-8000-000000000001"))).rejects.toMatchObject({ code: "validation" });
    const assigned = await withTenant(t.orgId, (db) => assignIncident(db, analyst.ctx, inc.id, analyst2.userId, "Handing over"));
    expect(assigned.assigneeId).toBe(analyst2.userId);
    await expect(withTenant(t.orgId, (db) => addIncidentNote(db, analyst.ctx, inc.id, "x"))).rejects.toMatchObject({ code: "validation" });
    await withTenant(t.orgId, (db) => addIncidentNote(db, analyst2.ctx, inc.id, "Checked the decision trace."));
    const ev = await withTenant(t.orgId, (db) => createSecurityEvent(db, analyst.ctx, { type: "test.medium", severity: "medium", title: "Medium event", escalate: false }));
    expect(ev.incidentId).toBeNull();
    const linked = await withTenant(t.orgId, (db) => linkSecurityEvent(db, analyst.ctx, inc.id, ev.event.id, "Related"));
    expect(linked.status).toBe("linked");
    expect(linked.incidentId).toBe(inc.id);
    const other = await withTenant(t.orgId, (db) => createIncident(db, analyst.ctx, { title: "Other", severity: "low", summary: "", agentIds: [], securityEventIds: [] }));
    await expect(withTenant(t.orgId, (db) => linkSecurityEvent(db, analyst.ctx, other.id, ev.event.id))).rejects.toMatchObject({ code: "conflict" });
    const detail = await withTenant(t.orgId, (db) => getIncident(db, analyst.ctx, inc.id));
    expect(detail.securityEvents.length).toBe(1);
    expect(detail.timeline.filter((x) => x.kind === "security_event").length).toBe(1);
    expect(detail.timeline.filter((x) => x.kind === "incident_event").map((x) => x.type)).toEqual(["created", "assigned", "note", "security_event_linked"]);
    expect(detail.incidentEvidence.map((e) => e.type)).toEqual(expect.arrayContaining(["incident.created", "incident.assigned", "incident.note_added", "incident.security_event_linked"]));
    await expect(withTenant(t.orgId, (db) => getIncident(db, t.ownerCtx, "00000000-0000-7000-8000-000000000002"))).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists with filters and reports stats", async () => {
    const all = await withTenant(t.orgId, (db) => listIncidents(db, viewer.ctx, { page: 1, pageSize: 10 }));
    expect(all.total).toBeGreaterThanOrEqual(5);
    const high = await withTenant(t.orgId, (db) => listIncidents(db, viewer.ctx, { page: 1, pageSize: 10, severity: "high" }));
    expect(high.items.every((i) => i.severity === "high")).toBe(true);
    const mine = await withTenant(t.orgId, (db) => listIncidents(db, viewer.ctx, { page: 1, pageSize: 10, assigneeId: analyst2.userId }));
    expect(mine.total).toBe(1);
    const q = await withTenant(t.orgId, (db) => listIncidents(db, viewer.ctx, { page: 1, pageSize: 10, q: "lifecycle" }));
    expect(q.total).toBe(1);
    const stats = await withTenant(t.orgId, (db) => incidentStats(db, viewer.ctx));
    expect(stats.byStatus.investigating).toBe(1);
    expect(stats.openTotal).toBe(all.total);
  });
});
