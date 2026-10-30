/**
 * Example: a support agent asks AEGIS before issuing a refund. Run against a local AEGIS:
 *   AEGIS_URL=http://localhost:4000 AEGIS_AGENT_KEY=aegis_ak_... npx tsx packages/sdk/examples/refund-agent.ts 1450
 * The agent never executes the refund itself; the gateway executes through the integration
 * (gateway mode) and returns a receipt, or holds the action for a human approver.
 */
import { AegisClient } from "../src/index.js";

const amount = Number(process.argv[2] ?? 180);
const aegis = new AegisClient({ baseUrl: process.env.AEGIS_URL ?? "http://localhost:4000", apiKey: process.env.AEGIS_AGENT_KEY ?? "" });

const decision = await aegis.authorize({
  tool: "issue-refund",
  action: "execute",
  resource: "support-tickets",
  params: { orderId: "ORD-77001", customerId: "CUST-88213", amount, currency: "AED", reason: "Late delivery" },
  idempotencyKey: `refund-ORD-77001-${amount}`,
  justification: "Customer escalated twice; goodwill compensation",
  principal: { type: "customer", ref: "CUST-88213" },
});

console.log(`decision=${decision.decision} status=${decision.status}`);
for (const r of decision.reasons) console.log(`  reason: ${r}`);
if (decision.status === "executed") console.log(`  executed by ${decision.receipt?.downstreamSystem}: ${decision.receipt?.reference}`);
if (decision.decision === "require_approval") {
  console.log(`  waiting for approval ${decision.approval?.approvalRequestId} (expires ${decision.approval?.expiresAt})`);
  const final = await aegis.waitForApproval(decision.requestId, { timeoutMs: 120_000 });
  console.log(`  final status: ${final.status}`);
}
if (decision.transportError) console.log(`  gateway unreachable, treated as deny: ${decision.transportError}`);
