import { withTenant } from "@aegis/db";
import { sealDestinationSecret } from "../integrations/destinations.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Two example destinations for the demo, both paused so nothing is ever sent, never tested and so
 * never marked verified. Written directly (the seed may run without DNS); the console adds real ones
 * through the normal checks.
 */
export async function seedDemoDestinations(t: SeededTenant): Promise<number> {
  return withTenant(t.orgId, async (db) => {
    const last = await db.evidenceEvent.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
    const base = { orgId: t.orgId, enabled: false, cursorSeq: last?.seq ?? 0n, createdBy: t.users.security_analyst!.id };
    await db.eventDestination.create({ data: { ...base, kind: "slack", name: "Slack #ai-governance (demo, paused)", categories: ["security", "approvals", "decisions"], minSeverity: "high", config: { host: "hooks.slack.com" }, secretEnvelope: sealDestinationSecret(t.orgId, "slack", "https://hooks.slack.com/services/TDEMO0000/BDEMO0000/demo-placeholder-not-real") } });
    await db.eventDestination.create({ data: { ...base, kind: "splunk_hec", name: "Splunk SOC (demo, paused)", categories: ["security", "decisions", "agents", "monitoring"], config: { url: "https://splunk.meridian-demo.example:8088", index: "aegis" }, secretEnvelope: sealDestinationSecret(t.orgId, "splunk_hec", "demo-placeholder-hec-token") } });
    return 2;
  });
}
