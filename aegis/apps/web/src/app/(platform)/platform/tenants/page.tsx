import type { Metadata } from "next";
import { platformListOrganizations } from "@aegis/core";
import { requirePlatformAdmin } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Tenants" };
export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const s = await requirePlatformAdmin();
  const orgs = await platformListOrganizations(s.user.id);
  return (
    <div>
      <PageHeader title="Tenants" description="Every organization on this deployment. Listing is recorded as a platform event." badges={<Badge tone="info">Platform admin</Badge>} />
      <div className="overflow-auto rounded-panel border border-line bg-bg-elev">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Organizations</caption>
          <thead className="bg-bg-elev-2/95 text-xs text-fg-muted">
            <tr>
              <th className="h-9 px-3 text-start font-medium">Organization</th>
              <th className="h-9 px-3 text-start font-medium">Plan</th>
              <th className="h-9 px-3 text-start font-medium">Mode</th>
              <th className="h-9 px-3 text-end font-medium">Members</th>
              <th className="h-9 px-3 text-end font-medium">Agents</th>
              <th className="h-9 px-3 text-start font-medium">Created</th>
              <th className="h-9 px-3 text-start font-medium">Id</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState title="No organizations" />
                </td>
              </tr>
            ) : (
              orgs.map((o) => (
                <tr key={o.id} className="border-t border-line">
                  <td className="h-9 px-3">
                    <span className="block font-medium">{o.name}</span>
                    <span className="block font-mono text-[11px] text-fg-dim">{o.slug}</span>
                  </td>
                  <td className="h-9 px-3">{o.plan.replace(/_/g, " ")}</td>
                  <td className="h-9 px-3">{o.demoMode ? <Badge tone="approval">Demo</Badge> : <Badge tone="allow">Live</Badge>}</td>
                  <td className="h-9 px-3 text-end tabular">{o.memberCount}</td>
                  <td className="h-9 px-3 text-end tabular">{o.agentCount}</td>
                  <td className="h-9 px-3">{formatDateTime(o.createdAt)}</td>
                  <td className="h-9 px-3 font-mono text-[11px] text-fg-dim">{o.id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
