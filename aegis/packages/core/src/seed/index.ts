import { disconnectAll } from "@aegis/db";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedDemoTenant, DEMO_PASSWORD, DEMO_USERS, PLATFORM_ADMIN } from "./demo-tenant.js";
import { seedDemoHistory } from "./demo-history.js";
import { runBankingDemo, runRefundDemo, runSensitiveDataDemo } from "../demos/scenarios.js";

export async function runSeed() {
  const started = Date.now();
  const t = await seedDemoTenant();
  const history = await seedDemoHistory(t);
  console.log(`History: ${history.requests} requests, ${history.approvals} approvals, ${history.denied} denied`);
  // Leave live demo scenarios ready: pending approvals for the console.
  const actors = { orgId: t.orgId, agentIds: t.agents, approverCtx: t.users.approver!.ctx, autoApprove: false };
  await runBankingDemo(actors, { decision: "leave" });
  await runRefundDemo(actors);
  await runSensitiveDataDemo(actors);
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
