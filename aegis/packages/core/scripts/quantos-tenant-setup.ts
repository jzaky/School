/**
 * Creates a local AEGIS organization for the Quant OS agent-mode integration test
 * (docs/QUANTOS_INTEGRATION.md). Run against a local database only:
 *   pnpm --filter @aegis/core exec tsx scripts/quantos-tenant-setup.ts <output.json>
 *
 * The organization gets:
 *   - an integration "quantos-broker" with NO credentials: AEGIS never holds broker keys and never places
 *     orders for Quant OS. Its API key can only verify grants (scope grants:verify);
 *   - the tool "place-order" on that integration, with the trading parameter schema;
 *   - an active agent "quantos-execution" with that tool and an agent API key;
 *   - the trading policy template: NVDA, AAPL, SPY; orders under USD 5,000 run on their own; USD 5,000 to
 *     USD 50,000 need one Approver; more is denied; market-hours rule off so the test runs at any hour;
 *   - an approver user whose password is generated here.
 * Keys and the password are written to the output file (mode 600). Synthetic data only.
 */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { disconnectAll, ownerPrisma, rawPrisma, withTenant } from "@aegis/db";
import { env } from "../src/env.js";
import { registerUser } from "../src/identity/auth.js";
import { createOrganization } from "../src/orgs/orgs.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { makeContext } from "../src/lib/context.js";
import { createAgent, grantResourcePermission, setAgentTool, transitionAgent, upsertResource, upsertTool } from "../src/agents/registry.js";
import { createIntegration } from "../src/integrations/service.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { issueApiKey } from "../src/identity/api-keys.js";
import { buildTradingPolicyDocument } from "../src/policy/trading.js";

env();
const out = process.argv[2];
if (!out) throw new Error("usage: quantos-tenant-setup.ts <output.json>");

const old = await ownerPrisma().organization.findMany({ where: { slug: { startsWith: "quantos-it-" } }, select: { id: true } });
for (const o of old) {
  await ownerPrisma().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', '${o.id}', true)`);
    await tx.organization.delete({ where: { id: o.id } });
  });
}
await rawPrisma().user.deleteMany({ where: { email: { endsWith: "@quantos-it.aegis.local" } } });

const stamp = `quantos-it-${Date.now().toString(36)}`;
const password = randomBytes(18).toString("base64url") + "A1!";
const owner = await registerUser({ email: `owner-${stamp}@quantos-it.aegis.local`, name: "Quant OS IT Owner", password });
const org = await createOrganization({ name: "Quant OS integration test", slug: stamp, ownerUserId: owner.id });
const m = (await listUserMemberships(owner.id)).find((x) => x.orgId === org.id)!;
const ctx = makeContext(org.id, { type: "user", id: owner.id, permissions: m.permissions, membershipId: m.membershipId });
const approver = await registerUser({ email: `approver-${stamp}@quantos-it.aegis.local`, name: "Quant OS IT Approver", password });

const result = await withTenant(org.id, async (db) => {
  const role = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId: org.id, key: "approver" } } });
  await db.membership.create({ data: { orgId: org.id, userId: approver.id, roleId: role.id } });
  const { integration } = await createIntegration(db, ctx, { key: "quantos-broker", name: "Quant OS execution (verifies grants only)", type: "brokerage", description: "Quant OS places orders with its own broker keys; this integration only verifies AEGIS grants." });
  const tool = await upsertTool(db, ctx, {
    key: "place-order",
    name: "Place order (Quant OS, Alpaca paper)",
    description: "Quant OS places this order itself after AEGIS issues and verifies a grant",
    integrationId: integration.id,
    riskLevel: "critical",
    parameterSchema: { type: "object", required: ["symbol", "side", "type", "qty", "notional", "reference"], properties: { symbol: { type: "string", maxLength: 12 }, side: { type: "string", enum: ["buy", "sell"] }, type: { type: "string", enum: ["market", "limit"] }, qty: { type: "number", minimum: 0 }, notional: { type: "number", minimum: 0 }, limitPrice: { type: "number", minimum: 0 }, timeInForce: { type: "string", enum: ["day", "gtc", "ioc", "fok"] }, reference: { type: "string", maxLength: 120 }, reason: { type: "string", maxLength: 500 } }, additionalProperties: false },
    destinationRules: { allowedDomains: [], allowedResourceKeys: ["trading-book"] },
  });
  const resource = await upsertResource(db, ctx, { key: "trading-book", name: "Trading book", type: "portfolio", classification: "confidential", attributes: {} });
  const agent = await createAgent(db, ctx, { slug: "quantos-execution", name: "Quant OS execution", description: "Quant OS order path (manual and automated orders)", environment: "development", modelProvider: "", modelId: "", dataClassificationLimit: "confidential", riskTier: "critical", metadata: {} });
  await setAgentTool(db, ctx, agent.id, tool.id, true);
  await grantResourcePermission(db, ctx, agent.id, resource.id, ["read", "write", "execute"]);
  await transitionAgent(db, ctx, agent.id, "registered", "ok");
  await transitionAgent(db, ctx, agent.id, "active", "ok");
  const document = buildTradingPolicyDocument({ tools: ["place-order"], instruments: ["NVDA", "AAPL", "SPY"], autoApproveNotionalBelow: 5000, approvalNotionalUpTo: 50_000, maxOrderQty: 1000, marketHoursOnly: { enabled: false }, approverRoles: ["approver"], blockDuplicates: false });
  const { policy, version } = await createPolicy(db, ctx, { key: "quantos-trading-mandate", name: "Quant OS trading mandate", description: "", category: "authorization", document, changeNote: "integration test" });
  await submitForReview(db, ctx, version.id);
  await activateVersion(db, ctx, version.id, { fourEyes: false });
  await assignPolicy(db, ctx, policy.id, { targetType: "agent", targetId: agent.id, priority: 100 });
  const agentKey = (await issueApiKey(db, ctx, { name: "quantos agent", subjectType: "agent", subjectId: agent.id })).key;
  const integrationKey = (await issueApiKey(db, ctx, { name: "quantos verify", subjectType: "integration", subjectId: integration.id, scopes: ["grants:verify"] })).key;
  return { agentKey, integrationKey };
});

writeFileSync(out, JSON.stringify({ orgId: org.id, ...result, ownerEmail: `owner-${stamp}@quantos-it.aegis.local`, approverEmail: `approver-${stamp}@quantos-it.aegis.local`, password }, null, 2), { mode: 0o600 });
console.log(`Quant OS integration organization ${org.id} written to ${out}`);
await disconnectAll();
