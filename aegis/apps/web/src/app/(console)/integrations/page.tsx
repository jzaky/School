import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { listIntegrations } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { StatusCell } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { CreateIntegrationDialog } from "@/components/control/integration-dialogs";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Plug } from "lucide-react";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const c = await requirePermission("integrations:read");
  const rows = await withTenant(c.ctx.orgId, (db) => listIntegrations(db, c.ctx));
  const now = Date.now();
  const soon = now + 14 * 86400_000;
  return (
    <div>
      <PageHeader title="Integrations" description="Downstream systems the Action Gateway can reach: tools, encrypted credentials with rotation, webhook signing and the simulated activity ledger." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateIntegrationDialog canWrite={c.can("integrations:write")} />} />
      <SimpleTable caption="Integrations">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th>Health</Th>
            <Th align="end">Credentials</Th>
            <Th>Rotation</Th>
            <Th align="end">Tools</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <EmptyState icon={Plug} title="No integrations" description="Register a downstream system to attach tools and credentials." />
              </td>
            </tr>
          ) : (
            rows.map((i) => {
              const live = i.credentials.filter((cr) => !cr.revokedAt);
              const due = live.filter((cr) => cr.rotationDueAt && cr.rotationDueAt.getTime() < soon);
              const overdue = live.filter((cr) => cr.rotationDueAt && cr.rotationDueAt.getTime() < now);
              const nextDue = live.map((cr) => cr.rotationDueAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
              return (
                <Tr key={i.id}>
                  <Td>
                    <Link href={`/integrations/${i.id}`} className="block min-w-0 hover:underline">
                      <span className="block font-medium text-fg">{i.name}</span>
                      <span className="block font-mono text-[11px] text-fg-dim">
                        {i.key}
                        {i.baseUrl ? ` · ${i.baseUrl}` : ""}
                      </span>
                    </Link>
                  </Td>
                  <Td>{i.type}</Td>
                  <Td>
                    {i.statusReason ? (
                      <Tooltip content={i.statusReason}>
                        <span>
                          <StatusCell status={i.status === "active" ? "active" : "disabled"} />
                        </span>
                      </Tooltip>
                    ) : (
                      <StatusCell status={i.status === "active" ? "active" : "disabled"} />
                    )}
                  </Td>
                  <Td>
                    {i.lastHealthAt ? (
                      <span className="inline-flex items-center gap-2">
                        <Badge tone={i.lastHealthOk ? "allow" : "deny"}>{i.lastHealthOk ? "Healthy" : "Failing"}</Badge>
                        <span className="text-xs text-fg-dim" title={formatDateTime(i.lastHealthAt)}>
                          {timeAgo(i.lastHealthAt)}
                        </span>
                      </span>
                    ) : (
                      <Badge>Not checked</Badge>
                    )}
                  </Td>
                  <Td align="end">{live.length}</Td>
                  <Td>{overdue.length ? <Badge tone="deny">{overdue.length} overdue</Badge> : due.length ? <Badge tone="approval">{due.length} due within 14 days</Badge> : nextDue ? <span className="text-xs text-fg-muted">Next {formatDateTime(nextDue)}</span> : <span className="text-xs text-fg-dim">none scheduled</span>}</Td>
                  <Td align="end">{i.tools.length}</Td>
                </Tr>
              );
            })
          )}
        </tbody>
      </SimpleTable>
    </div>
  );
}
