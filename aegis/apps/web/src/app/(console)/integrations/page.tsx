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
import { integrationKind, KindBadge } from "@/components/control/integration-kind";
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
      <PageHeader title="Integrations" description="The outside systems an agent can act on through the Action Gateway, the one door every agent action goes through. Some are simulated for the demonstrations; sandbox connectors reach real providers in their test mode. Each one holds its tools, its encrypted credentials and their renewal dates, its signed inbound notifications (webhooks) and a connection test." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateIntegrationDialog canWrite={c.can("integrations:write")} />} />
      <SimpleTable caption="Integrations">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Kind</Th>
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
              <td colSpan={8}>
                <EmptyState icon={Plug} title="No integrations" description="Add an outside system here, then attach the tools and credentials agents will use with it." />
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
                    <KindBadge kind={integrationKind(i)} />
                  </Td>
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
