import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listMembers, listRoles } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { UsersTable, type MemberRow } from "@/components/org/users-table";
import { InviteDialog } from "@/components/org/invite-dialog";
import { MemberSearch } from "@/components/org/member-search";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const c = await requirePermission("users:read");
  const { q = "" } = await searchParams;
  const [members, roles] = await withTenant(c.ctx.orgId, (db) => Promise.all([listMembers(db, c.ctx), listRoles(db, c.ctx)]));
  const rows: MemberRow[] = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user?.name ?? "Unknown user",
    email: m.user?.email ?? "",
    roleId: m.roleId,
    roleName: m.role.name,
    roleKey: m.role.key,
    title: m.title,
    status: m.status,
    mfaEnabled: m.user?.mfaEnabled ?? false,
    lastLoginAt: m.user?.lastLoginAt?.toISOString() ?? null,
    userStatus: m.user?.status ?? "active",
  }));
  const canWrite = c.can("users:write");
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name, key: r.key }));
  return (
    <div>
      <PageHeader title="Users" description={`${rows.filter((r) => r.status === "active").length} active members. Roles decide what each person can see and do.`} badges={<DemoBadge show={c.org.demoMode} />} actions={<InviteDialog roles={roleOptions} canWrite={canWrite} />} />
      <div className="mb-3">
        <MemberSearch initial={q} />
      </div>
      <UsersTable rows={rows} roles={roleOptions} canWrite={canWrite} selfUserId={c.session.user.id} q={q} />
    </div>
  );
}
