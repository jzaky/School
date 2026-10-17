import "./setup-env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerPrisma, rawPrisma, disconnectAll, withTenant } from "../src/index.js";

const owner = ownerPrisma();
const app = rawPrisma();
let orgA = "";
let orgB = "";
const stamp = Date.now().toString(36);

beforeAll(async () => {
  const a = await owner.organization.create({ data: { slug: `iso-a-${stamp}`, name: "Iso A" } });
  const b = await owner.organization.create({ data: { slug: `iso-b-${stamp}`, name: "Iso B" } });
  orgA = a.id;
  orgB = b.id;
  await withTenant(orgA, (db) => db.agent.create({ data: { orgId: orgA, slug: "a1", name: "Agent A" } }));
  await withTenant(orgB, (db) => db.agent.create({ data: { orgId: orgB, slug: "b1", name: "Agent B" } }));
});

afterAll(async () => {
  await owner.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await owner.agent.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await disconnectAll();
});

describe("tenant isolation (app role, RLS)", () => {
  it("app role is not the table owner and cannot bypass RLS", async () => {
    const rows = await app.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0]?.rolbypassrls).toBe(false);
    expect(rows[0]?.rolsuper).toBe(false);
    const owners = await app.$queryRaw<{ tableowner: string }[]>`SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='agents'`;
    const me = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`;
    expect(owners[0]?.tableowner).not.toBe(me[0]?.u);
  });

  it("sees only its own rows inside a tenant context", async () => {
    const a = await withTenant(orgA, (db) => db.agent.findMany());
    const b = await withTenant(orgB, (db) => db.agent.findMany());
    expect(a.map((x) => x.slug)).toEqual(["a1"]);
    expect(b.map((x) => x.slug)).toEqual(["b1"]);
  });

  it("cannot read another tenant's row by id even with the exact id", async () => {
    const [bAgent] = await withTenant(orgB, (db) => db.agent.findMany());
    const fromA = await withTenant(orgA, (db) => db.agent.findUnique({ where: { id: bAgent!.id } }));
    expect(fromA).toBeNull();
  });

  it("cannot write a row for another tenant", async () => {
    await expect(withTenant(orgA, (db) => db.agent.create({ data: { orgId: orgB, slug: "smuggled", name: "x" } }))).rejects.toThrow();
    const b = await withTenant(orgB, (db) => db.agent.findMany({ where: { slug: "smuggled" } }));
    expect(b).toHaveLength(0);
  });

  it("cannot update or delete another tenant's row (silently affects zero rows)", async () => {
    const [bAgent] = await withTenant(orgB, (db) => db.agent.findMany());
    const updated = await withTenant(orgA, (db) => db.agent.updateMany({ where: { id: bAgent!.id }, data: { name: "hijacked" } }));
    expect(updated.count).toBe(0);
    const deleted = await withTenant(orgA, (db) => db.agent.deleteMany({ where: { id: bAgent!.id } }));
    expect(deleted.count).toBe(0);
    const still = await withTenant(orgB, (db) => db.agent.findUnique({ where: { id: bAgent!.id } }));
    expect(still?.name).toBe("Agent B");
  });

  it("raw SQL without a tenant context returns no tenant rows", async () => {
    const rows = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM agents`;
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("raw SQL inside a tenant context is also scoped", async () => {
    const rows = await withTenant(orgA, (db) => db.$queryRaw<{ slug: string }[]>`SELECT slug FROM agents ORDER BY slug`);
    expect(rows.map((r) => r.slug)).toEqual(["a1"]);
  });

  it("rejects an invalid org id before touching the database", async () => {
    await expect(withTenant("not-a-uuid", (db) => db.agent.findMany())).rejects.toThrow(/Invalid orgId/);
  });

  it("owner connection sees both tenants (platform admin path)", async () => {
    const all = await owner.agent.findMany({ where: { orgId: { in: [orgA, orgB] } } });
    expect(all).toHaveLength(2);
  });
});

describe("append-only integrity", () => {
  it("rejects UPDATE and DELETE on evidence_events, even for the owner", async () => {
    const ev = await withTenant(orgA, (db) =>
      db.evidenceEvent.create({
        data: { orgId: orgA, seq: 1n, type: "test", actorType: "system", subjectType: "test", prevHash: "0".repeat(64), hash: "a".repeat(64) },
      }),
    );
    await expect(withTenant(orgA, (db) => db.evidenceEvent.update({ where: { id: ev.id }, data: { type: "tampered" } }))).rejects.toThrow(/append-only/);
    await expect(withTenant(orgA, (db) => db.evidenceEvent.delete({ where: { id: ev.id } }))).rejects.toThrow(/append-only/);
    await expect(owner.evidenceEvent.update({ where: { id: ev.id }, data: { type: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(owner.evidenceEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });

  it("freezes a policy version document once it leaves draft", async () => {
    const policy = await withTenant(orgA, (db) => db.policy.create({ data: { orgId: orgA, key: "p1", name: "P1" } }));
    const v = await withTenant(orgA, (db) =>
      db.policyVersion.create({ data: { orgId: orgA, policyId: policy.id, version: 1, document: { rules: [] }, contentHash: "h1", state: "active" } }),
    );
    await expect(withTenant(orgA, (db) => db.policyVersion.update({ where: { id: v.id }, data: { document: { rules: [1] } } }))).rejects.toThrow(/frozen/);
    // State transitions are allowed.
    await withTenant(orgA, (db) => db.policyVersion.update({ where: { id: v.id }, data: { state: "retired", retiredAt: new Date() } }));
    await expect(withTenant(orgA, (db) => db.policyVersion.delete({ where: { id: v.id } }))).rejects.toThrow(/append-only/);
  });
});
