import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { makeContext } from "../src/lib/context.js";
import { authorizeAndExecute } from "../src/gateway/gateway.js";
import { accessReviewOverview, completeAccessReview, decideAccessReviewItem, reviewState, startAccessReview } from "../src/agents/access-reviews.js";
import { installPilotKit } from "../src/pilots/kits.js";
import { SECTOR_PACKS } from "../src/validation/sector-lab.js";

const routine = SECTOR_PACKS.find((p) => p.key === "government")!.cases.find((c) => c.id === "gov-routine")!.params;

describe("agent access reviews", () => {
  let t: TestTenant;
  let govAgent: string;
  let healthAgent: string;
  let reviewer: Awaited<ReturnType<typeof addUserWithRole>>;
  const pay = () => authorizeAndExecute(withTenant, makeContext(t.orgId, { type: "agent", id: govAgent, label: "procurement-payments-agent" }), { tool: "release-contractor-payment", action: "execute", params: routine, context: {}, justification: "", idempotencyKey: `ar-${Date.now()}-${Math.random()}`, principal: { type: "system" }, executionMode: "agent" });

  beforeAll(async () => {
    t = await makeTestTenant("review");
    govAgent = (await withTenant(t.orgId, (db) => installPilotKit(db, t.ownerCtx, "government", { watchOnly: false }))).agents[0]!.id;
    healthAgent = (await withTenant(t.orgId, (db) => installPilotKit(db, t.ownerCtx, "healthcare", { watchOnly: false }))).agents[0]!.id;
    reviewer = await addUserWithRole(t, "governance_manager", "gm");
    // The owner builds and runs the government agent, so another person must certify its access.
    await withTenant(t.orgId, (db) => db.agent.update({ where: { id: govAgent }, data: { technicalOwnerId: t.ownerCtx.actor.id! } }));
    expect((await pay()).status).toBe("allowed");
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await disconnectAll();
  });

  it("snapshots every live grant with its use, marks unused ones, and allows one open review at a time", async () => {
    const { review, items } = await withTenant(t.orgId, (db) => startAccessReview(db, t.ownerCtx, { title: "Q4 agent access review", dueInDays: 14 }));
    expect(items).toBeGreaterThanOrEqual(2);
    const o = await withTenant(t.orgId, (db) => accessReviewOverview(db, t.ownerCtx));
    expect(o.open?.id).toBe(review.id);
    const pay = o.items.find((i) => i.label === "release-contractor-payment")!;
    expect(pay.uses).toBe(1);
    expect(pay.lastUsedAt).not.toBeNull();
    expect(o.items.some((i) => i.agentId === healthAgent && i.uses === 0)).toBe(true);
    await expect(withTenant(t.orgId, (db) => startAccessReview(db, t.ownerCtx, { title: "Another one" }))).rejects.toThrow(/already open/);
    const ev = await withTenant(t.orgId, (db) => db.evidenceEvent.findFirst({ where: { orgId: t.orgId, type: "access_review.started" } }));
    expect(ev?.payload).toMatchObject({ items });
  });

  it("keeps the technical owner from certifying their own agent, and agents and viewers from deciding at all", async () => {
    const o = await withTenant(t.orgId, (db) => accessReviewOverview(db, t.ownerCtx));
    const item = o.items.find((i) => i.agentId === govAgent)!;
    await expect(withTenant(t.orgId, (db) => decideAccessReviewItem(db, t.ownerCtx, item.id, { decision: "keep" }))).rejects.toThrow(/technical owner/);
    const viewer = await addUserWithRole(t, "viewer", "v");
    await expect(withTenant(t.orgId, (db) => decideAccessReviewItem(db, viewer.ctx, item.id, { decision: "keep" }))).rejects.toThrow(/agents:control/);
    const agentCtx = makeContext(t.orgId, { type: "agent", id: govAgent, label: "x", permissions: ["*"] });
    await expect(withTenant(t.orgId, (db) => decideAccessReviewItem(db, agentCtx, item.id, { decision: "keep" }))).rejects.toThrow(/people/);
  });

  it("removing access revokes the grant at once, so the gateway refuses the next request", async () => {
    const o = await withTenant(t.orgId, (db) => accessReviewOverview(db, reviewer.ctx));
    const item = o.items.find((i) => i.label === "release-contractor-payment")!;
    await expect(withTenant(t.orgId, (db) => decideAccessReviewItem(db, reviewer.ctx, item.id, { decision: "remove", note: "" }))).rejects.toThrow(/why/);
    await withTenant(t.orgId, (db) => decideAccessReviewItem(db, reviewer.ctx, item.id, { decision: "remove", note: "Payments move to the new finance agent" }));
    expect((await pay()).status).toBe("denied");
    await expect(withTenant(t.orgId, (db) => decideAccessReviewItem(db, reviewer.ctx, item.id, { decision: "keep" }))).rejects.toThrow(/already decided/);
  });

  it("completes only when every item is decided, with a summary in the evidence record", async () => {
    let o = await withTenant(t.orgId, (db) => accessReviewOverview(db, reviewer.ctx));
    await expect(withTenant(t.orgId, (db) => completeAccessReview(db, reviewer.ctx, o.open!.id))).rejects.toThrow(/still need a decision/);
    for (const i of o.items.filter((x) => !x.decision)) await withTenant(t.orgId, (db) => decideAccessReviewItem(db, reviewer.ctx, i.id, { decision: "keep", note: "Still needed" }));
    const done = await withTenant(t.orgId, (db) => completeAccessReview(db, reviewer.ctx, o.open!.id));
    expect(done.summary).toMatchObject({ removed: 1, onTime: true, agents: 2, reviewers: 1 });
    o = await withTenant(t.orgId, (db) => accessReviewOverview(db, reviewer.ctx));
    expect(o.open).toBeNull();
    expect(o.nextDueAt!.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
    expect(o.nextOverdue).toBe(false);
    const types = await withTenant(t.orgId, (db) => db.evidenceEvent.findMany({ where: { orgId: t.orgId, type: { startsWith: "access_review." } }, select: { type: true } }));
    expect(types.filter((x) => x.type === "access_review.completed")).toHaveLength(1);
  });

  it("an open review past its due date reads as overdue", () => {
    expect(reviewState({ status: "open", dueAt: new Date(Date.now() - 1000) })).toBe("overdue");
    expect(reviewState({ status: "open", dueAt: new Date(Date.now() + 1000) })).toBe("open");
    expect(reviewState({ status: "completed", dueAt: new Date(0) })).toBe("completed");
  });
});
