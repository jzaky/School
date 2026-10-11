import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { StatusCell } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Plug } from "lucide-react";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const c = await requirePermission("integrations:read");
  const rows = await withTenant(c.ctx.orgId, (db) =>
    db.integration.findMany({
      where: { orgId: c.ctx.orgId },
      orderBy: { name: "asc" },
      include: { credentials: { where: { revokedAt: null }, select: { id: true, rotationDueAt: true } }, _count: { select: { tools: true } } },
    }),
  );
  const now = Date.now();
  const soon = now + 14 * 86400_000;
  return (
    <div>
      <PageHeader title="Integrations" description="Downstream systems the Action Gateway can reach, with credential rotation status." badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="mb-3 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-fg">Integration management, credential rotation and webhook configuration arrive in a later release. This list is read-only.</div>
      <div className="overflow-auto rounded-panel border border-line bg-bg-elev">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Integrations</caption>
          <thead className="bg-bg-elev-2/95 text-xs text-fg-muted">
            <tr>
              <th className="h-9 px-3 text-start font-medium">Name</th>
              <th className="h-9 px-3 text-start font-medium">Type</th>
              <th className="h-9 px-3 text-start font-medium">Status</th>
              <th className="h-9 px-3 text-start font-medium">Health</th>
              <th className="h-9 px-3 text-end font-medium">Credentials</th>
              <th className="h-9 px-3 text-start font-medium">Rotation</th>
              <th className="h-9 px-3 text-end font-medium">Tools</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={Plug} title="No integrations" description="Connected systems will be listed here once registered." />
                </td>
              </tr>
            ) : (
              rows.map((i) => {
                const due = i.credentials.filter((cr) => cr.rotationDueAt && cr.rotationDueAt.getTime() < soon);
                const overdue = i.credentials.filter((cr) => cr.rotationDueAt && cr.rotationDueAt.getTime() < now);
                const nextDue = i.credentials.map((cr) => cr.rotationDueAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
                return (
                  <tr key={i.id} className="border-t border-line">
                    <td className="h-9 px-3">
                      <span className="block font-medium">{i.name}</span>
                      <span className="block font-mono text-[11px] text-fg-dim">{i.key}{i.baseUrl ? ` · ${i.baseUrl}` : ""}</span>
                    </td>
                    <td className="h-9 px-3">{i.type}</td>
                    <td className="h-9 px-3">
                      {i.statusReason ? (
                        <Tooltip content={i.statusReason}>
                          <span><StatusCell status={i.status === "active" ? "active" : "disabled"} /></span>
                        </Tooltip>
                      ) : (
                        <StatusCell status={i.status === "active" ? "active" : "disabled"} />
                      )}
                    </td>
                    <td className="h-9 px-3">
                      {i.lastHealthAt ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge tone={i.lastHealthOk ? "allow" : "deny"}>{i.lastHealthOk ? "Healthy" : "Failing"}</Badge>
                          <span className="text-xs text-fg-dim" title={formatDateTime(i.lastHealthAt)}>{timeAgo(i.lastHealthAt)}</span>
                        </span>
                      ) : (
                        <Badge>Not checked</Badge>
                      )}
                    </td>
                    <td className="h-9 px-3 text-end tabular">{i.credentials.length}</td>
                    <td className="h-9 px-3">
                      {overdue.length ? <Badge tone="deny">{overdue.length} overdue</Badge> : due.length ? <Badge tone="approval">{due.length} due within 14 days</Badge> : nextDue ? <span className="text-xs text-fg-muted">Next {formatDateTime(nextDue)}</span> : <span className="text-xs text-fg-dim">none scheduled</span>}
                    </td>
                    <td className="h-9 px-3 text-end tabular">{i._count.tools}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
