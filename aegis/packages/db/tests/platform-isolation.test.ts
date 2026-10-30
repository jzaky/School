import "./setup-env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerPrisma, rawPrisma, disconnectAll, withTenant } from "../src/index.js";

// S8: platform tables (users, sessions, organizations, jobs, platform events, deployment versions) are
// confined to the current organization inside a tenant transaction, and stay reachable to platform code.
const owner = ownerPrisma();
const app = rawPrisma();
const stamp = Date.now().toString(36);
let orgA = "";
let orgB = "";
let userA = "";
let userB = "";

beforeAll(async () => {
  orgA = (await owner.organization.create({ data: { slug: `piso-a-${stamp}`, name: "Platform Iso A" } })).id;
  orgB = (await owner.organization.create({ data: { slug: `piso-b-${stamp}`, name: "Platform Iso B" } })).id;
  userA = (await owner.user.create({ data: { email: `piso-a-${stamp}@example.test`, name: "Member A" } })).id;
  userB = (await owner.user.create({ data: { email: `piso-b-${stamp}@example.test`, name: "Member B" } })).id;
  const roleA = await owner.role.create({ data: { orgId: orgA, key: "member", name: "Member", permissions: [] } });
  const roleB = await owner.role.create({ data: { orgId: orgB, key: "member", name: "Member", permissions: [] } });
  await owner.membership.create({ data: { orgId: orgA, userId: userA, roleId: roleA.id } });
  await owner.membership.create({ data: { orgId: orgB, userId: userB, roleId: roleB.id } });
  const expiresAt = new Date(Date.now() + 3_600_000);
  await owner.session.create({ data: { userId: userA, tokenHash: `piso-a-${stamp}`, expiresAt } });
  await owner.session.create({ data: { userId: userB, tokenHash: `piso-b-${stamp}`, expiresAt } });
  await owner.job.create({ data: { orgId: orgB, type: "piso.test", idempotencyKey: `piso-b-${stamp}` } });
  await owner.platformEvent.create({ data: { orgId: orgB, type: "piso.test" } });
});

afterAll(async () => {
  await owner.$transaction(async (tx) => {
    for (const org of [orgA, orgB]) {
      await tx.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', $1, true)`, org);
      await tx.$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, org);
    }
  });
  await owner.job.deleteMany({ where: { idempotencyKey: { startsWith: "piso-" } } });
  await owner.platformEvent.deleteMany({ where: { type: "piso.test" } });
  await owner.session.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await owner.membership.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await owner.role.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await owner.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await owner.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await disconnectAll();
});

describe("platform tables under row-level security (S8)", () => {
  it("every public table except the migration history has row-level security", async () => {
    const rows = await owner.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual(["_prisma_migrations"]);
  });

  it("a tenant transaction sees its own members only, never another organization's users", async () => {
    const seen = await withTenant(orgA, (db) => db.user.findMany({ where: { id: { in: [userA, userB] } }, select: { id: true } }), { readOnly: true });
    expect(seen.map((u) => u.id)).toEqual([userA]);
    const byEmail = await withTenant(orgA, (db) => db.user.findUnique({ where: { email: `piso-b-${stamp}@example.test` } }), { readOnly: true });
    expect(byEmail).toBeNull();
  });

  it("a tenant transaction cannot read or change another organization's member's sessions", async () => {
    const seen = await withTenant(orgA, (db) => db.session.findMany({ where: { userId: { in: [userA, userB] } }, select: { userId: true } }), { readOnly: true });
    expect(seen.map((s) => s.userId)).toEqual([userA]);
    const revoked = await withTenant(orgA, (db) => db.session.updateMany({ where: { userId: userB }, data: { revokedAt: new Date() } }));
    expect(revoked.count).toBe(0);
  });

  it("a tenant transaction sees only its own organization row and cannot rename another", async () => {
    const orgs = await withTenant(orgA, (db) => db.organization.findMany({ where: { id: { in: [orgA, orgB] } }, select: { id: true } }), { readOnly: true });
    expect(orgs.map((o) => o.id)).toEqual([orgA]);
    const renamed = await withTenant(orgA, (db) => db.organization.updateMany({ where: { id: orgB }, data: { name: "hijacked" } }));
    expect(renamed.count).toBe(0);
  });

  it("a tenant transaction cannot see, run or create jobs and events for another organization", async () => {
    const jobs = await withTenant(orgA, (db) => db.job.findMany({ where: { idempotencyKey: `piso-b-${stamp}` } }), { readOnly: true });
    expect(jobs).toHaveLength(0);
    await expect(withTenant(orgA, (db) => db.job.create({ data: { orgId: orgB, type: "piso.test", idempotencyKey: `piso-smuggled-${stamp}` } }))).rejects.toThrow();
    const events = await withTenant(orgA, (db) => db.platformEvent.findMany({ where: { type: "piso.test" } }), { readOnly: true });
    expect(events).toHaveLength(0);
  });

  it("deployment records are platform-only", async () => {
    const rows = await withTenant(orgA, (db) => db.deploymentVersion.findMany(), { readOnly: true });
    expect(rows).toHaveLength(0);
    await expect(withTenant(orgA, (db) => db.deploymentVersion.create({ data: { component: "api", version: `piso-${stamp}` } }))).rejects.toThrow();
  });

  it("the cross-tenant membership lookup answers only outside a tenant transaction", async () => {
    const platform = await app.$queryRaw<{ org_id: string }[]>`SELECT org_id FROM aegis_user_memberships(${userB}::uuid)`;
    expect(platform.map((r) => r.org_id)).toEqual([orgB]);
    const tenant = await withTenant(orgA, (db) => db.$queryRaw<{ org_id: string }[]>`SELECT org_id FROM aegis_user_memberships(${userB}::uuid)`, { readOnly: true });
    expect(tenant).toHaveLength(0);
  });

  it("platform code outside a tenant transaction still reaches users and sessions (sign-in path)", async () => {
    const u = await app.user.findUnique({ where: { email: `piso-b-${stamp}@example.test` } });
    expect(u?.id).toBe(userB);
    const s = await app.session.findUnique({ where: { tokenHash: `piso-b-${stamp}` } });
    expect(s?.userId).toBe(userB);
  });
});

describe("append-only records during a demo reset (S10)", () => {
  beforeAll(async () => {
    for (const org of [orgA, orgB]) await owner.evidenceCheckpoint.create({ data: { orgId: org, throughSeq: 1n, hash: "h".repeat(64), signature: "sig", keyId: "test" } });
  });

  it("the application role cannot use the purge setting, even for its own organization", async () => {
    await expect(
      withTenant(orgA, async (db) => {
        await db.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', $1, true)`, orgA);
        await db.$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, orgA);
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("the owner may delete only the named organization's rows; another organization stays protected in the same transaction", async () => {
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', $1, true)`, orgA);
        await tx.$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, orgB);
      }),
    ).rejects.toThrow(/append-only/);
    const deleted = await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', $1, true)`, orgA);
      return tx.$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, orgA);
    });
    expect(deleted).toBe(1);
    expect(await owner.evidenceCheckpoint.count({ where: { orgId: orgB } })).toBe(1);
  });

  it("updates stay forbidden with the purge setting, and the setting does not outlive its transaction", async () => {
    await expect(
      owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('aegis.purge_org', $1, true)`, orgB);
        await tx.$executeRawUnsafe(`UPDATE evidence_checkpoints SET hash = 'x' WHERE org_id = $1::uuid`, orgB);
      }),
    ).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, orgB)).rejects.toThrow(/append-only/);
  });
});
