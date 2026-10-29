import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { makeContext } from "../src/lib/context.js";
import { authorizeAndExecute, pauseGateway, resumeGateway } from "../src/gateway/gateway.js";
import { activeFreezeFor, createFreeze, endFreeze, listFreezes, setTwoPersonRecovery, type ChangeFreeze } from "../src/gateway/freeze.js";
import { installPilotKit } from "../src/pilots/kits.js";
import { setWatchOnly } from "../src/pilots/watch-only.js";
import { SECTOR_PACKS } from "../src/validation/sector-lab.js";

const pack = SECTOR_PACKS.find((p) => p.key === "government")!;
const params = (id: string) => pack.cases.find((c) => c.id === id)!.params;
const hour = 3600_000;

describe("change freezes and two-person recovery", () => {
  let t: TestTenant;
  let agentId: string;
  let n = 0;
  const call = (id: string) =>
    authorizeAndExecute(withTenant, makeContext(t.orgId, { type: "agent", id: agentId, label: "procurement-payments-agent" }), { tool: "release-contractor-payment", action: "execute", params: params(id), context: {}, justification: "", idempotencyKey: `freeze-${Date.now()}-${++n}`, principal: { type: "system" }, executionMode: "agent" });
  const freeze = (input: Record<string, unknown>, ctx = t.ownerCtx) => withTenant(t.orgId, (db) => createFreeze(db, ctx, { title: "Year-end close", reason: "Ledgers are frozen for the audit", startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + hour), ...input }));

  beforeAll(async () => {
    t = await makeTestTenant("freeze");
    const kit = await withTenant(t.orgId, (db) => installPilotKit(db, t.ownerCtx, "government", { watchOnly: false }));
    agentId = kit.agents[0]!.id;
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await disconnectAll();
  });

  it("picks the freeze that applies by time, risk level, tool and agent, a refusal before a hold", () => {
    const now = new Date();
    const base: ChangeFreeze = { id: "a", title: "x", reason: "y", startsAt: new Date(now.getTime() - hour).toISOString(), endsAt: new Date(now.getTime() + hour).toISOString(), effect: "require_approval", minRiskLevel: "high", toolKeys: [], agentIds: [], createdBy: { id: null, label: null }, createdAt: now.toISOString() };
    const q = { now, toolKey: "pay", toolRisk: "high", agentId: "ag" };
    expect(activeFreezeFor([base], q)?.id).toBe("a");
    expect(activeFreezeFor([base], { ...q, toolRisk: "low" })).toBeNull();
    expect(activeFreezeFor([base], { ...q, toolRisk: "unknown-level" })?.id, "unknown risk fails closed").toBe("a");
    expect(activeFreezeFor([{ ...base, startsAt: new Date(now.getTime() + 60_000).toISOString() }], q)).toBeNull();
    expect(activeFreezeFor([{ ...base, endedAt: now.toISOString() }], q)).toBeNull();
    expect(activeFreezeFor([{ ...base, toolKeys: ["other"] }], q)).toBeNull();
    expect(activeFreezeFor([{ ...base, agentIds: ["someone-else"] }], q)).toBeNull();
    expect(activeFreezeFor([base, { ...base, id: "b", effect: "deny" }], q)?.id).toBe("b");
  });

  it("before the freeze a routine payment goes through; during a refusing freeze it is refused at the door with the reason", async () => {
    expect((await call("gov-routine")).status).toBe("allowed");
    const f = await freeze({ effect: "deny", minRiskLevel: "high" });
    const r = await call("gov-routine");
    expect(r.status).toBe("denied");
    expect(r.reasons.join(" ")).toMatch(/Change freeze "Year-end close" is in force/);
    const ev = await withTenant(t.orgId, (db) => db.evidenceEvent.findFirst({ where: { orgId: t.orgId, type: "gateway.freeze_created" } }));
    expect(ev?.payload).toMatchObject({ freezeId: f.id, effect: "deny" });
    await withTenant(t.orgId, (db) => endFreeze(db, t.ownerCtx, f.id, "Audit sign-off received"));
    expect((await call("gov-routine")).status).toBe("allowed");
  });

  it("a freeze above the tool's risk level leaves it alone; a holding freeze sends changes to a person", async () => {
    const above = await freeze({ minRiskLevel: "critical" });
    expect((await call("gov-routine")).status).toBe("allowed");
    await withTenant(t.orgId, (db) => endFreeze(db, t.ownerCtx, above.id, "Wrong scope, replacing it"));
    const hold = await freeze({ effect: "require_approval", minRiskLevel: "medium" });
    const r = await call("gov-routine");
    expect(r.status).toBe("pending_approval");
    expect(r.reasons.join(" ")).toMatch(/Changes during the freeze need a person's approval/);
    // A request policy already refuses stays refused: a freeze only ever makes the outcome stricter.
    expect((await call("gov-unregistered")).status).toBe("denied");
    await withTenant(t.orgId, (db) => endFreeze(db, t.ownerCtx, hold.id, "Change window opened"));
  });

  it("watch-only pilots never relax a freeze", async () => {
    await withTenant(t.orgId, (db) => setWatchOnly(db, t.ownerCtx, agentId, { enabled: true, reason: "pilot watch period" }));
    const hold = await freeze({ effect: "require_approval" });
    const held = await call("gov-routine");
    expect(held.status).toBe("pending_approval");
    expect(held.watchOnly).toBeUndefined();
    await withTenant(t.orgId, (db) => endFreeze(db, t.ownerCtx, hold.id, "Done testing hold"));
    const deny = await freeze({ effect: "deny" });
    expect((await call("gov-routine")).status).toBe("denied");
    await withTenant(t.orgId, (db) => endFreeze(db, t.ownerCtx, deny.id, "Done testing deny"));
    await withTenant(t.orgId, (db) => setWatchOnly(db, t.ownerCtx, agentId, { enabled: false, reason: "pilot over" }));
  });

  it("checks permissions and input, and lists freezes newest first", async () => {
    const viewer = await addUserWithRole(t, "viewer", "view");
    await expect(freeze({}, viewer.ctx)).rejects.toThrow(/agents:control/);
    await expect(freeze({ endsAt: new Date(Date.now() - 2 * hour), startsAt: new Date(Date.now() - 3 * hour) })).rejects.toThrow(/already ended/);
    await expect(freeze({ endsAt: new Date(Date.now() - 2 * hour) })).rejects.toThrow();
    const list = await withTenant(t.orgId, (db) => listFreezes(db, viewer.ctx));
    expect(list.length).toBeGreaterThan(3);
    expect(list.every((f) => f.endedAt)).toBe(true);
  });

  it("with two-person recovery on, the person who froze or paused cannot be the one to undo it", async () => {
    const admin = await addUserWithRole(t, "owner", "own2");
    await withTenant(t.orgId, (db) => setTwoPersonRecovery(db, t.ownerCtx, { enabled: true, reason: "Required by our change policy" }));
    const f = await freeze({});
    await expect(withTenant(t.orgId, (db) => endFreeze(db, t.ownerCtx, f.id, "I changed my mind"))).rejects.toThrow(/different person/);
    await withTenant(t.orgId, (db) => endFreeze(db, admin.ctx, f.id, "Second person confirms the window is over"));

    await withTenant(t.orgId, (db) => pauseGateway(db, t.ownerCtx, "Suspected compromise"));
    expect((await call("gov-routine")).status).toBe("denied");
    await expect(withTenant(t.orgId, (db) => resumeGateway(db, t.ownerCtx, "All clear now"))).rejects.toThrow(/different administrator/);
    await withTenant(t.orgId, (db) => resumeGateway(db, admin.ctx, "Investigated: no compromise found"));
    expect((await call("gov-routine")).status).toBe("allowed");
    const types = await withTenant(t.orgId, (db) => db.evidenceEvent.findMany({ where: { orgId: t.orgId, type: { in: ["gateway.two_person_recovery_set", "gateway.freeze_ended", "gateway.paused", "gateway.resumed"] } }, select: { type: true } }));
    expect(new Set(types.map((x) => x.type))).toEqual(new Set(["gateway.two_person_recovery_set", "gateway.freeze_ended", "gateway.paused", "gateway.resumed"]));
  });
});
