import { ownerPrisma, rawPrisma, withTenant } from "@aegis/db";
import { createOrganization } from "../src/orgs/orgs.js";
import { registerUser } from "../src/identity/auth.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { listUserMemberships } from "../src/identity/memberships.js";

export interface TestTenant {
  orgId: string;
  ownerUserId: string;
  ownerCtx: OrgContext;
  cleanup: () => Promise<void>;
}

export async function makeTestTenant(label = "t"): Promise<TestTenant> {
  const stamp = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await registerUser({ email: `${stamp}@test.aegis.local`, name: "Test Owner", password: "CorrectHorse1Battery" });
  const org = await createOrganization({ name: `Test ${stamp}`, slug: stamp, ownerUserId: user.id });
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
  const ownerCtx = makeContext(org.id, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
  return {
    orgId: org.id,
    ownerUserId: user.id,
    ownerCtx,
    cleanup: async () => {
      const owner = ownerPrisma();
      await owner.organization.delete({ where: { id: org.id } }).catch(() => undefined);
      await owner.$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, org.id).catch(() => undefined);
      await owner.user.delete({ where: { id: user.id } }).catch(() => undefined);
    },
  };
}

export async function addUserWithRole(t: TestTenant, roleKey: string, label = "u") {
  const stamp = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await registerUser({ email: `${stamp}@test.aegis.local`, name: `User ${roleKey}`, password: "CorrectHorse1Battery" });
  await withTenant(t.orgId, async (db) => {
    const role = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId: t.orgId, key: roleKey } } });
    await db.membership.create({ data: { orgId: t.orgId, userId: user.id, roleId: role.id } });
  });
  const m = (await listUserMemberships(user.id)).find((x) => x.orgId === t.orgId)!;
  return { userId: user.id, ctx: makeContext(t.orgId, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId }) };
}

export { withTenant, rawPrisma };
