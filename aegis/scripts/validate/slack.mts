/**
 * Slack incoming webhook through AEGIS's event destination code (packages/core/src/integrations/destinations.ts):
 * the network safety checks, pinned DNS and the Slack message format.
 *
 *   read -rs AEGIS_VALIDATE_SLACK_WEBHOOK_URL && export AEGIS_VALIDATE_SLACK_WEBHOOK_URL
 *   npx tsx scripts/validate/run.mts slack
 *
 * Creates a temporary organization, adds a Slack destination with the webhook, sends the test event,
 * prints the outcome, then deletes the organization. One message appears in the channel.
 */
import { disconnectAll, ownerPrisma, rawPrisma, withTenant, type TenantDb } from "../../packages/db/src/index.js";
import { env } from "../../packages/core/src/env.js";
import { registerUser } from "../../packages/core/src/identity/auth.js";
import { createOrganization } from "../../packages/core/src/orgs/orgs.js";
import { listUserMemberships } from "../../packages/core/src/identity/memberships.js";
import { makeContext } from "../../packages/core/src/lib/context.js";
import { createDestination, sendTestEvent } from "../../packages/core/src/integrations/destinations.js";

env();
const line = (pass: boolean, name: string, detail: string) => console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(48)}  ${detail}`);
let failed = 0;
const stamp = `slackvalidate-${Date.now().toString(36)}`;
const user = await registerUser({ email: `${stamp}@validation.aegis.local`, name: "Slack validation", password: `V-${Date.now()}-Aa1!x` });
const org = await createOrganization({ name: `Slack validation ${stamp}`, slug: stamp, ownerUserId: user.id });
const mem = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
const ctx = makeContext(org.id, { type: "user", id: user.id, permissions: mem.permissions, membershipId: mem.membershipId });
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(org.id, fn);
try {
  const { destination: d } = await run((db) => createDestination(db, ctx, { kind: "slack", webhookUrl: process.env.AEGIS_VALIDATE_SLACK_WEBHOOK_URL!, name: "Validation channel", categories: ["security"], minSeverity: null }));
  line(true, "webhook URL passed the network safety checks", `host ${new URL(process.env.AEGIS_VALIDATE_SLACK_WEBHOOK_URL!).hostname}`);
  const r = await sendTestEvent(run, ctx, d.id);
  if (!r.ok) failed++;
  line(r.ok, "test event delivered to Slack", r.ok ? `HTTP ${r.status}` : `${r.status ?? "no answer"}: ${r.error}`);
} catch (e) {
  failed++;
  line(false, "run", e instanceof Error ? e.message : String(e));
} finally {
  await ownerPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', '${org.id}', true)`);
    await tx.organization.delete({ where: { id: org.id } });
  }).catch(() => undefined);
  await rawPrisma().user.delete({ where: { id: user.id } }).catch(() => undefined);
  await disconnectAll();
}
console.log("Check the channel: one AEGIS test message should appear.");
process.exit(failed ? 1 : 0);
