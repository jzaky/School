import { disconnectAll } from "@aegis/db";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedDemoTenant, DEMO_PASSWORD, DEMO_USERS, PLATFORM_ADMIN } from "./demo-tenant.js";
import { seedDemoHistory } from "./demo-history.js";
import { runBankingDemo, runOutcomesDemo, runRefundDemo, runSensitiveDataDemo } from "../demos/scenarios.js";
import { runMonitoring, acknowledgeAlert, resolveAlert } from "../monitoring/service.js";
import { installShield } from "../shield/inspector.js";
import { seedDemoDataClasses, seedDemoShield } from "./demo-shield.js";
import { seedDemoAudit, seedSharedFrameworks } from "./demo-audit.js";
import { withTenant } from "@aegis/db";

export async function runSeed() {
  const started = Date.now();
  installShield();
  const t = await seedDemoTenant();
  await withTenant(t.orgId, (db) => seedDemoDataClasses(db, t.users.security_analyst!.ctx));
  const history = await seedDemoHistory(t);
  console.log(`History: ${history.requests} requests, ${history.approvals} approvals, ${history.denied} denied`);
  // Leave live demo scenarios ready: pending approvals for the console.
  const actors = { orgId: t.orgId, agentIds: t.agents, approverCtx: t.users.approver!.ctx, autoApprove: false };
  await runBankingDemo(actors, { decision: "leave" });
  await runRefundDemo(actors);
  await runSensitiveDataDemo(actors);
  await runOutcomesDemo(actors);
  await withTenant(t.orgId, (db) => seedDemoShield(db, t.users.security_analyst!.ctx, t.agents));
  await seedSharedFrameworks();
  const audit = await withTenant(t.orgId, (db) => seedDemoAudit(db, t.users.owner!.ctx, { ownerUserId: t.users.owner!.id, auditorUserId: t.users.auditor!.id }), { timeout: 180_000, lock: "lazy" });
  console.log(`Audit: ${audit.documents.length} documents, ${audit.assessments.length} assessments, ${audit.tasks.length} tasks`);
  // Monitoring over the seeded history: run at several points in the past so alerts carry realistic timestamps,
  // then once now. A few alerts are already handled.
  const mon = await withTenant(t.orgId, async (db) => {
    for (const daysAgo of [60, 45, 30, 21, 14, 7, 3, 1]) {
      await runMonitoring(db, { ...t.users.owner!.ctx, now: new Date(Date.now() - daysAgo * 86400_000 + 14 * 3600_000) }, new Date(Date.now() - daysAgo * 86400_000 + 14 * 3600_000));
    }
    const r = await runMonitoring(db, t.users.owner!.ctx);
    const alerts = await db.alert.findMany({ where: { orgId: t.orgId }, orderBy: { createdAt: "asc" } });
    if (alerts[0]) await acknowledgeAlert(db, t.users.security_analyst!.ctx, alerts[0].id);
    if (alerts[1]) await resolveAlert(db, t.users.security_analyst!.ctx, alerts[1].id, "Reviewed with the agent owner; expected behaviour during the campaign window.");
    return r;
  });
  console.log(`Monitoring: ${mon.evaluated} rules, ${mon.newAlerts} alerts${mon.errors.length ? ", errors: " + mon.errors.join("; ") : ""}`);
  // Demo agent API keys are needed by the SDK examples and the live demo runner. Written to a
  // gitignored file in the monorepo root; never printed to logs.
  const keysPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".demo-keys.json");
  writeFileSync(keysPath, JSON.stringify({ orgId: t.orgId, generatedAt: new Date().toISOString(), agents: t.apiKeys }, null, 2));
  console.log(`Demo agent API keys written to ${keysPath}`);
  console.log(`Seeded demo tenant ${t.orgId} in ${Date.now() - started}ms`);
  console.log(`Agents: ${Object.keys(t.agents).length}, tools: ${Object.keys(t.tools).length}, resources: ${Object.keys(t.resources).length}`);
  console.log(`Sign in with any demo user (password ${DEMO_PASSWORD}):`);
  for (const u of DEMO_USERS) console.log(`  ${u.email}  (${u.role})`);
  console.log(`Platform admin: ${PLATFORM_ADMIN.email}`);
  return t;
}

if (process.argv[1]?.endsWith("seed/index.ts")) {
  runSeed()
    .then(() => disconnectAll())
    .catch(async (e) => {
      console.error(e);
      await disconnectAll();
      process.exit(1);
    });
}
