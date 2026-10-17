import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { createCustomDataClass, ensureDefaultDataClasses, updateDataClass } from "../shield/data-classes.js";
import { triageSecurityEvent } from "../shield/security-events.js";
import { addIncidentNote, assignIncident, createIncident, linkSecurityEvent, setIncidentStatus } from "../incidents/service.js";

/**
 * Demo Shield data for the Meridian tenant. Call order matters:
 *  1. seedDemoDataClasses(db, ctx)   before seedDemoHistory, so history reflects the data classes
 *  2. seedDemoShield(db, ctx, agents) after history and scenarios, so incidents can link real events
 * seedDemoShield also calls seedDemoDataClasses, so calling only the second is safe but history
 * generated before it will carry no Shield findings. Both are idempotent.
 *
 * ctx must hold security:write (the security analyst persona).
 */

const DAY = 86400_000;

export async function seedDemoDataClasses(db: TenantDb, ctx: OrgContext) {
  const { all } = await ensureDefaultDataClasses(db, ctx);
  const byKey = new Map(all.map((c) => [c.key, c]));
  // Payment tools legitimately carry account identifiers; the bank records them as a data class and
  // lets policies decide (shield.dataClasses is visible to policy rules) instead of blocking outright.
  const iban = byKey.get("iban");
  if (iban && iban.action !== "allow") await updateDataClass(db, ctx, iban.id, { action: "allow", description: "International bank account numbers (mod-97 valid). Recorded for policies; payment tools carry these by design." });
  const custom: { key: string; name: string; description: string; pattern: string; action: "allow" | "mask" | "redact" | "block" | "require_approval"; severity: "low" | "medium" | "high" | "critical" }[] = [
    { key: "project_codename", name: "Internal project codename", description: "Codenames of unannounced programmes must not leave the bank in agent output.", pattern: "(?i)\\bPROJECT[- ](?:FALCON|ORYX|DUNE|MIRAGE)\\b", action: "redact", severity: "medium" },
    { key: "customer_account_number", name: "Customer account number", description: "Meridian account identifiers (MGB-NN-NNNNNNNN).", pattern: "\\bMGB-\\d{2}-\\d{8}\\b", action: "mask", severity: "medium" },
  ];
  const created: string[] = [];
  for (const c of custom) {
    if (byKey.has(c.key)) continue;
    await createCustomDataClass(db, ctx, { ...c, enabled: true });
    created.push(c.key);
  }
  return { created };
}

export async function seedDemoShield(db: TenantDb, ctx: OrgContext, agents: Record<string, string>) {
  await seedDemoDataClasses(db, ctx);
  const base = ctx.now ?? new Date();
  const at = (daysAgo: number, hours = 0) => ({ ...ctx, now: new Date(base.getTime() - daysAgo * DAY + hours * 3600_000) });
  const analystId = ctx.actor.id;
  const existing = await db.incident.findMany({ where: { orgId: ctx.orgId }, select: { title: true } });
  const have = new Set(existing.map((i) => i.title));
  const result = { incidents: [] as string[], triaged: 0, dismissed: 0 };

  // 1. Resolved: repeated denied actions from the IT helpdesk agent led to its suspension.
  const t1 = "Repeated denied actions from the IT helpdesk agent";
  if (!have.has(t1)) {
    const inc = await createIncident(db, at(21), { title: t1, severity: "medium", summary: "", agentIds: agents["it-helpdesk-agent"] ? [agents["it-helpdesk-agent"]] : [], securityEventIds: [] });
    if (analystId) await assignIncident(db, at(21, 1), inc.id, analystId, "Taking this one");
    await setIncidentStatus(db, at(21, 2), inc.id, { status: "investigating", note: "Six denied password-reset actions in one afternoon; checking the ticket sources." });
    await addIncidentNote(db, at(20), inc.id, "Denied requests all originated from forwarded emails. No data left the gateway; every attempt was denied by the resource permission check.");
    await setIncidentStatus(db, at(20, 3), inc.id, { status: "contained", note: "Agent suspended through emergency controls pending a review of its ticket intake." });
    await setIncidentStatus(db, at(18), inc.id, { status: "resolved", note: "Review complete.", summary: "The helpdesk agent was fed forwarded email text that asked for resets on accounts outside its permissions. The gateway denied every attempt (resource_not_permitted). The agent stays suspended until ticket intake filters untrusted email bodies. No customer impact." });
    result.incidents.push(inc.id);
  }

  // 2. Investigating: the marketing agent's export attempts to an external destination.
  const t2 = "Customer record export attempts to an external destination";
  if (!have.has(t2)) {
    const marketing = agents["marketing-outreach-agent"];
    const events = marketing ? await db.securityEvent.findMany({ where: { orgId: ctx.orgId, agentId: marketing, incidentId: null, type: { in: ["egress.blocked", "authorization.boundary_violation", "data_protection.blocked", "policy.violation"] } }, orderBy: { createdAt: "desc" }, take: 5 }) : [];
    const inc = await createIncident(db, at(3), { title: t2, severity: "high", summary: "", agentIds: marketing ? [marketing] : [], securityEventIds: [] });
    for (const e of events) await linkSecurityEvent(db, at(3, 1), inc.id, e.id, "Export attempt outside the warehouse allowlist");
    if (analystId) await assignIncident(db, at(3, 1), inc.id, analystId, "");
    await setIncidentStatus(db, at(2), inc.id, { status: "investigating", note: "Destination domain is not in the tool allowlist. Checking what instructed the agent." });
    await addIncidentNote(db, at(1), inc.id, "Request context shows source=untrusted-email-instruction. The gateway denied each attempt by destination rule; the customer-data-egress policy also matched. Reviewing whether the campaign brief ingestion should scan for injection signals before the agent sees it.");
    result.incidents.push(inc.id);
  }

  // 3. Open: injection signals observed in support ticket content.
  const t3 = "Prompt-injection signals observed in support ticket content";
  if (!have.has(t3)) {
    const inc = await createIncident(db, at(0, -5), { title: t3, severity: "medium", summary: "", agentIds: agents["support-refund-agent"] ? [agents["support-refund-agent"]] : [], securityEventIds: [] });
    await addIncidentNote(db, at(0, -4), inc.id, "Three tickets this week carried instruction-override phrases in their body. The refund agent's actions stayed within policy; opened to track the ticket source.");
    result.incidents.push(inc.id);
  }

  // 4. Triage a few open events so the queue looks worked.
  const open = await db.securityEvent.findMany({ where: { orgId: ctx.orgId, status: "open" }, orderBy: { createdAt: "desc" }, take: 8 });
  const notes = ["Expected: allowlist did its job. Confirmed with the agent owner.", "Reviewed the decision trace; policy behaved as designed.", "Agent owner notified; no follow-up needed."];
  let i = 0;
  for (const e of open) {
    if (i >= 5) break;
    if (e.severity === "low" || e.severity === "medium") {
      if (result.dismissed < 2) {
        await triageSecurityEvent(db, at(0, -(i + 1)), e.id, { status: "dismissed", note: "Duplicate of an event already covered by an incident." });
        result.dismissed++;
        i++;
        continue;
      }
    }
    if (result.triaged < 3) {
      await triageSecurityEvent(db, at(0, -(i + 1)), e.id, { status: "triaged", note: notes[result.triaged % notes.length]! });
      result.triaged++;
      i++;
    }
  }
  return result;
}
