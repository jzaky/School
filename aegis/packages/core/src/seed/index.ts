import { disconnectAll } from "@aegis/db";
import { seedDemoTenant, DEMO_PASSWORD, DEMO_USERS, PLATFORM_ADMIN } from "./demo-tenant.js";

export async function runSeed() {
  const started = Date.now();
  const t = await seedDemoTenant();
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
