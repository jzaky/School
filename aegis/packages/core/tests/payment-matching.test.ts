import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { makeContext } from "../src/lib/context.js";
import { authorizeAndExecute, recordAgentExecution } from "../src/gateway/gateway.js";
import { listPaymentDocuments, registerPaymentDocuments, setDocumentMatching, voidPaymentDocument } from "../src/payments/matching.js";
import { upsertTool } from "../src/agents/registry.js";
import { installPilotKit } from "../src/pilots/kits.js";

const KEY = "release-contractor-payment";
const pay = { vendorRef: "VEN-SYN-1042", purchaseOrder: "PO-SYN-2207", amount: 12500, currency: "AED", vendorRegistered: true, payeeAccountChanged: false };

describe("payment document matching", () => {
  let t: TestTenant;
  let agentId: string;
  let toolId: string;
  let n = 0;
  const agentCtx = () => makeContext(t.orgId, { type: "agent", id: agentId, label: "procurement-payments-agent" });
  const call = (params: Record<string, unknown>) => authorizeAndExecute(withTenant, agentCtx(), { tool: KEY, action: "execute", params, context: {}, justification: "", idempotencyKey: `pm-${Date.now()}-${++n}`, principal: { type: "system" }, executionMode: "agent" });
  const register = (docs: unknown[], ctx = t.ownerCtx) => withTenant(t.orgId, (db) => registerPaymentDocuments(db, ctx, { documents: docs }));
  const po = (ref: string, amount: number, vendorRef = "VEN-SYN-1042") => ({ ref, kind: "purchase_order", vendorRef, amount, currency: "AED" });

  beforeAll(async () => {
    t = await makeTestTenant("match");
    agentId = (await withTenant(t.orgId, (db) => installPilotKit(db, t.ownerCtx, "government", { watchOnly: false }))).agents[0]!.id;
    toolId = (await withTenant(t.orgId, (db) => db.tool.findFirstOrThrow({ where: { orgId: t.orgId, key: KEY } }))).id;
    await withTenant(t.orgId, (db) => setDocumentMatching(db, t.ownerCtx, toolId, { documentParam: "purchaseOrder", kinds: ["purchase_order"] }));
    await register([po("PO-SYN-2207", 12500), po("PO-SYN-2208", 9000), po("PO-SYN-2209", 7000)]);
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await disconnectAll();
  });

  it("an agent cannot register the documents it pays against", async () => {
    await expect(register([po("PO-FAKE-1", 50_000)], agentCtx())).rejects.toThrow(/Agents cannot register/);
    const viewer = await addUserWithRole(t, "viewer", "v");
    await expect(register([po("PO-FAKE-2", 50_000)], viewer.ctx)).rejects.toThrow(/integrations:write/);
  });

  it("pays a matching purchase order, then refuses paying it a second time", async () => {
    const first = await call(pay);
    expect(first.status).toBe("allowed");
    await withTenant(t.orgId, (db) => recordAgentExecution(db, agentCtx(), first.requestId, { grant: first.grant!.token, outcome: "succeeded", reference: "SIM-1" }));
    const again = await call(pay);
    expect(again.status).toBe("denied");
    expect(again.reasons.join(" ")).toMatch(/already paid .*pay it twice/);
    const docs = await withTenant(t.orgId, (db) => listPaymentDocuments(db, t.ownerCtx));
    expect(docs.find((d) => d.ref === "PO-SYN-2207")?.state).toBe("paid");
  });

  it("refuses a missing reference, an unknown document, a different payee and a different amount", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...pay, purchaseOrder: undefined }, /must reference a registered purchase_order/],
      [{ ...pay, purchaseOrder: "PO-SYN-9999" }, /No registered document PO-SYN-9999/],
      [{ ...pay, purchaseOrder: "PO-SYN-2208", amount: 9000, vendorRef: "VEN-SYN-6666" }, /is for vendor VEN-SYN-1042/],
      [{ ...pay, purchaseOrder: "PO-SYN-2208", amount: 9500 }, /is for AED 9,000, the payment is for 9,500/],
    ];
    for (const [params, why] of cases) {
      const r = await call(params);
      expect(r.status, String(why)).toBe("denied");
      expect(r.reasons.join(" ")).toMatch(why);
    }
  });

  it("a payment that failed releases its claim, so the document can be paid again", async () => {
    const r = await call({ ...pay, purchaseOrder: "PO-SYN-2208", amount: 9000 });
    expect(r.status).toBe("allowed");
    expect((await call({ ...pay, purchaseOrder: "PO-SYN-2208", amount: 9000 })).reasons.join(" ")).toMatch(/being paid/);
    await withTenant(t.orgId, (db) => recordAgentExecution(db, agentCtx(), r.requestId, { grant: r.grant!.token, outcome: "failed" }));
    expect((await call({ ...pay, purchaseOrder: "PO-SYN-2208", amount: 9000 })).status).toBe("allowed");
  });

  it("a voided document cannot be paid, and an approval-mode rule sends mismatches to a person", async () => {
    const doc = (await withTenant(t.orgId, (db) => listPaymentDocuments(db, t.ownerCtx))).find((d) => d.ref === "PO-SYN-2209")!;
    await withTenant(t.orgId, (db) => voidPaymentDocument(db, t.ownerCtx, doc.id, "Order cancelled by the contractor"));
    expect((await call({ ...pay, purchaseOrder: "PO-SYN-2209", amount: 7000 })).reasons.join(" ")).toMatch(/voided/);
    await withTenant(t.orgId, (db) => setDocumentMatching(db, t.ownerCtx, toolId, { documentParam: "purchaseOrder", kinds: ["purchase_order"], effect: "require_approval" }));
    const held = await call({ ...pay, purchaseOrder: "PO-SYN-9999" });
    expect(held.status).toBe("pending_approval");
    expect(held.reasons.join(" ")).toMatch(/must check the payment against the records/);
  });

  it("an ordinary tool edit keeps the matching rule", async () => {
    await withTenant(t.orgId, (db) => upsertTool(db, t.ownerCtx, { key: KEY, name: "Release contractor payment", description: "edited", parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] }, riskLevel: "high" }));
    const tool = await withTenant(t.orgId, (db) => db.tool.findUniqueOrThrow({ where: { id: toolId } }));
    expect((tool.destinationRules as { documentMatch?: { effect: string } }).documentMatch?.effect).toBe("require_approval");
  });
});
