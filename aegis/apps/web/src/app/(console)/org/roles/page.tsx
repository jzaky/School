import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listRoles, PERMISSIONS } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { CreateRoleDialog, RolesTable, type PermissionInfo, type RoleRow } from "@/components/org/roles";

export const metadata: Metadata = { title: "Roles" };
export const dynamic = "force-dynamic";

const AREA_LABELS: Record<string, string> = { org: "Organization", users: "Users and teams", agents: "AI agents", policies: "Policies", gateway: "Action Gateway", approvals: "Approvals", integrations: "Integrations", evidence: "Evidence", monitoring: "Monitoring", security: "Security", audit: "Audit", reports: "Reports" };

export default async function RolesPage() {
  const c = await requirePermission("users:read");
  const roles = await withTenant(c.ctx.orgId, (db) => listRoles(db, c.ctx));
  const catalog: PermissionInfo[] = Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description, area: AREA_LABELS[key.split(":")[0]!] ?? key.split(":")[0]! }));
  const rows: RoleRow[] = roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, isSystem: r.isSystem, memberCount: r.memberCount }));
  const canWrite = c.can("users:write");
  return (
    <div>
      <PageHeader title="Roles" description="A role decides what a person can see and do. The system roles come with AEGIS and cannot be changed; custom roles pick their permissions from the catalog." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateRoleDialog catalog={catalog} canWrite={canWrite} />} />
      <RolesTable roles={rows} catalog={catalog} canWrite={canWrite} />
    </div>
  );
}
