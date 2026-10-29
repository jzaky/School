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
import { seedDemoIdentity } from "./demo-identity.js";
import { seedDemoAutonomy } from "./demo-autonomy.js";
import { seedDemoUncertainty } from "./demo-uncertainty.js";
import { withTenant } from "@aegis/db";
import { runAttackSimulation } from "../security/lab.js";
import { seedDemoGovernance } from "./demo-governance.js";
import { seedDemoDestinations } from "./demo-destinations.js";
import { seedDemoPolicyExtras } from "./demo-policy-extras.js";
import { seedDemoAiGateway } from "./demo-ai-gateway.js";
import { seedDemoShadowAi } from "./demo-shadow-ai.js";
import { seedDemoSoftware } from "./demo-software.js";
import { seedDemoToolPins } from "./demo-tool-pins.js";
import { seedDemoAccessReviews } from "./demo-access-reviews.js";
import type { TenantRunner } from "../gateway/gateway.js";
import { updateInjectionResponse } from "../shield/injection-response.js";
import { initKeyring } from "../lib/keyring.js";

export async function runSeed() {
  const started = Date.now();
  await initKeyring();
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
  await seedDemoIdentity(t);
  await seedDemoAutonomy(t);
  const uncertainty = await seedDemoUncertainty(t);
  console.log(`Uncertainty: ${uncertainty.labels} outcome labels`);
  await withTenant(t.orgId, (db) => seedDemoShield(db, t.users.security_analyst!.ctx, t.agents));
  // Attack Simulation Lab: a run against the refund agent with injection signals only recorded, then the
  // security analyst sets the organization to hold them for review and runs the lab again.
  const labRunner: TenantRunner = (fn) => withTenant(t.orgId, fn);
  const before = await runAttackSimulation(labRunner, t.users.security_analyst!.ctx, { targetAgentId: t.agents["support-refund-agent"]! });
  await withTenant(t.orgId, (db) => updateInjectionResponse(db, t.users.security_analyst!.ctx, { response: "quarantine", signals: [] }));
  const after = await runAttackSimulation(labRunner, t.users.security_analyst!.ctx, { targetAgentId: t.agents["support-refund-agent"]! });
  console.log(`Attack Simulation Lab: before ${JSON.stringify(before.counts)}, after ${JSON.stringify(after.counts)}`);
  await seedSharedFrameworks();
  const audit = await withTenant(t.orgId, (db) => seedDemoAudit(db, t.users.owner!.ctx, { ownerUserId: t.users.owner!.id, auditorUserId: t.users.auditor!.id }), { timeout: 180_000, lock: "lazy" });
  console.log(`Audit: ${audit.documents.length} documents, ${audit.assessments.length} assessments, ${audit.tasks.length} tasks`);
  const governance = await seedDemoGovernance(t);
  console.log(`Model and data governance: ${governance.models} models, ${governance.datasets} datasets, ${governance.changes} regulatory changes`);
  console.log(`Event destinations: ${await seedDemoDestinations(t)} (paused)`);
  console.log(`Policy exceptions: ${await seedDemoPolicyExtras(t)}`);
  console.log(`AI gateway: ${(await seedDemoAiGateway(t)).requests} requests through a simulated provider`);
  const shadow = await seedDemoShadowAi(t);
  console.log(`Shadow AI: ${shadow.signals} signals from ${shadow.imports} synthetic log exports`);
  console.log(`Software requests: ${await seedDemoSoftware(t)}`);
  const pins = await seedDemoToolPins(t);
  console.log(`Tool pins: ${pins.pinned} pinned, ${pins.pending} change waiting for review`);
  const reviews = await seedDemoAccessReviews(t);
  console.log(`Access reviews: ${reviews.completed} completed, ${reviews.open} open`);
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
  // AEGIS_DEMO_KEYS_FILE lets a container write the file to a mounted folder (deploy/docker-compose.yml).
  const keysPath = process.env.AEGIS_DEMO_KEYS_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".demo-keys.json");
  writeFileSync(keysPath, JSON.stringify({ orgId: t.orgId, generatedAt: new Date().toISOString(), agents: t.apiKeys, platformAdmin: { email: PLATFORM_ADMIN.email, password: t.platformAdminPassword } }, null, 2), { mode: 0o600 });
  console.log(`Demo agent API keys written to ${keysPath}`);
  console.log(`Seeded demo tenant ${t.orgId} in ${Date.now() - started}ms`);
  console.log(`Agents: ${Object.keys(t.agents).length}, tools: ${Object.keys(t.tools).length}, resources: ${Object.keys(t.resources).length}`);
  console.log(`Sign in with any demo user (password ${DEMO_PASSWORD}):`);
  for (const u of DEMO_USERS) console.log(`  ${u.email}  (${u.role})`);
  console.log(`Platform admin: ${PLATFORM_ADMIN.email} (its own password, in ${keysPath}; never the demo password)`);
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
