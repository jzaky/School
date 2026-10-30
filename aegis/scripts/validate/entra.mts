/**
 * Microsoft Entra ID connector against a real tenant (docs/ENTRA_CONNECTOR.md).
 *
 *   read -rs AEGIS_VALIDATE_ENTRA_CLIENT_SECRET && export AEGIS_VALIDATE_ENTRA_CLIENT_SECRET
 *   AEGIS_VALIDATE_ENTRA_TENANT_ID=... AEGIS_VALIDATE_ENTRA_CLIENT_ID=... npx tsx scripts/validate/run.mts entra
 *
 * Creates a temporary organization, connects it, tests the connection, syncs the last day, prints counts only
 * (never identities), then deletes the organization and everything it read. Read-only on the Microsoft side.
 */
import { disconnectAll, ownerPrisma, rawPrisma, withTenant, type TenantDb } from "../../packages/db/src/index.js";
import { env } from "../../packages/core/src/env.js";
import { registerUser } from "../../packages/core/src/identity/auth.js";
import { createOrganization } from "../../packages/core/src/orgs/orgs.js";
import { listUserMemberships } from "../../packages/core/src/identity/memberships.js";
import { makeContext } from "../../packages/core/src/lib/context.js";
import { connectEntra, syncEntra, testEntraConnection } from "../../packages/core/src/secure/entra.js";

env();
const line = (pass: boolean, name: string, detail: string) => console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(48)}  ${detail}`);
let failed = 0;
const check = (pass: boolean, name: string, detail: string) => {
  if (!pass) failed++;
  line(pass, name, detail);
};
const stamp = `entravalidate-${Date.now().toString(36)}`;
const user = await registerUser({ email: `${stamp}@validation.aegis.local`, name: "Entra validation", password: `V-${Date.now()}-Aa1!x` });
const org = await createOrganization({ name: `Entra validation ${stamp}`, slug: stamp, ownerUserId: user.id });
const mem = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
const ctx = makeContext(org.id, { type: "user", id: user.id, permissions: mem.permissions, membershipId: mem.membershipId });
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(org.id, fn, { lock: "lazy", timeout: 120_000 });
try {
  await run((db) => connectEntra(db, ctx, { tenantId: process.env.AEGIS_VALIDATE_ENTRA_TENANT_ID!, clientId: process.env.AEGIS_VALIDATE_ENTRA_CLIENT_ID!, clientSecret: process.env.AEGIS_VALIDATE_ENTRA_CLIENT_SECRET!, backfillDays: 1 }));
  const t = await testEntraConnection(run, ctx);
  check(t.ok, "token issued and at least one feed readable", t.detail);
  check(t.signIns, "sign-in logs readable", t.signIns ? "yes" : "no (see the detail above)");
  check(t.consents, "audit logs readable", t.consents ? "yes" : "no");
  if (t.ok) {
    const r = await syncEntra(run, ctx);
    check(r.errors.length === 0, "one-day sync without errors", r.errors.join(" ") || `${r.windows} windows`);
    line(true, "records read", `${r.signIns} sign-ins, ${r.consents} consents, ${r.matched} AI matches kept`);
  }
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
process.exit(failed ? 1 : 0);
