/**
 * Creates benchmark organizations for the gateway throughput benchmark (docs/PERFORMANCE.md).
 *   pnpm --filter @aegis/core bench:gateway:setup [organizations=1] [agentsPerOrg=10]
 *
 * Each organization gets: a simulated support integration with a credential, the issue-refund tool, the
 * support-tickets resource, the demo refund-authority policy assigned to the whole organization, and N active
 * agents with their own API keys (an organization where many agents act at once). Writes the keys to
 * aegis/.bench-keys.json (git-ignored, mode 600). Synthetic data only. Run again to start from fresh orgs.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disconnectAll, ownerPrisma, rawPrisma, withTenant } from "@aegis/db";
import { env } from "../src/env.js";
import { registerUser } from "../src/identity/auth.js";
import { createOrganization } from "../src/orgs/orgs.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { makeContext } from "../src/lib/context.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertResource, upsertTool } from "../src/agents/registry.js";
import { createIntegration, storeCredential } from "../src/integrations/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { issueApiKey } from "../src/identity/api-keys.js";
import { DEMO_POLICIES } from "../src/seed/demo-policies.js";

env();
const orgCount = Number(process.argv[2] ?? 1);
const agentsPerOrg = Number(process.argv[3] ?? 10);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".bench-keys.json");

// Remove earlier benchmark organizations so runs start from the same state.
const old = await ownerPrisma().organization.findMany({ where: { slug: { startsWith: "bench-" } }, select: { id: true } });
for (const o of old) {
  await ownerPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', '${o.id}', true)`);
    await tx.organization.delete({ where: { id: o.id } });
  });
}
await rawPrisma().user.deleteMany({ where: { email: { endsWith: "@bench.aegis.local" } } });

const orgs: { orgId: string; keys: string[] }[] = [];
for (let o = 0; o < orgCount; o++) {
  const stamp = `bench-${o}-${Date.now().toString(36)}`;
  const user = await registerUser({ email: `${stamp}@bench.aegis.local`, name: "Bench Owner", password: `Bench-${Date.now()}-Aa1!` });
  const org = await createOrganization({ name: `Benchmark ${o}`, slug: stamp, ownerUserId: user.id });
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
  const ctx = makeContext(org.id, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
  const keys = await withTenant(
    org.id,
    async (db) => {
      const { integration } = await createIntegration(db, ctx, { key: "support-platform-sim", name: "Support (simulated)", type: "support", description: "" });
      await storeCredential(db, ctx, integration.id, "service-token", "sim-secret");
      const tool = await upsertTool(db, ctx, {
        key: "issue-refund",
        name: "Issue refund",
        description: "",
        integrationId: integration.id,
        riskLevel: "high",
        parameterSchema: { type: "object", required: ["orderId", "customerId", "amount", "currency"], properties: { orderId: { type: "string" }, customerId: { type: "string" }, amount: { type: "number", minimum: 0 }, currency: { type: "string" } }, additionalProperties: false },
        destinationRules: { allowedDomains: [], allowedResourceKeys: ["support-tickets"] },
      });
      const resource = await upsertResource(db, ctx, { key: "support-tickets", name: "Tickets", type: "application", classification: "internal", attributes: {} });
      const refund = DEMO_POLICIES.find((p) => p.key === "refund-authority")!;
      const { policy, version } = await createPolicy(db, ctx, { key: refund.key, name: refund.name, description: "", category: "authorization", document: refund.document, changeNote: "benchmark" });
      await submitForReview(db, ctx, version.id);
      await activateVersion(db, ctx, version.id, { fourEyes: false });
      await assignPolicy(db, ctx, policy.id, { targetType: "org", priority: 100 });
      const keys: string[] = [];
      for (let a = 0; a < agentsPerOrg; a++) {
        const agent = await createAgent(db, ctx, { slug: `bench-agent-${a}`, name: `Bench agent ${a}`, description: "", environment: "production", modelProvider: "bench", modelId: "bench", dataClassificationLimit: "confidential", riskTier: "high", metadata: {} });
        await setAgentTool(db, ctx, agent.id, tool.id, true);
        await grantResourcePermission(db, ctx, agent.id, resource.id, ["read", "write", "execute"]);
        await transitionAgent(db, ctx, agent.id, "registered", "benchmark");
        await transitionAgent(db, ctx, agent.id, "active", "benchmark");
        keys.push((await issueApiKey(db, ctx, { name: "bench", subjectType: "agent", subjectId: agent.id })).key);
      }
      return keys;
    },
    { timeout: 120_000, lock: "lazy" },
  );
  orgs.push({ orgId: org.id, keys });
  console.log(`organization ${o}: ${keys.length} agents`);
}
writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), orgs }, null, 2), { mode: 0o600 });
console.log(`keys written to ${out}`);
await disconnectAll();
