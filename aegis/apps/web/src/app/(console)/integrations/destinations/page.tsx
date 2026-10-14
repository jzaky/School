import type { Metadata } from "next";
import Link from "next/link";
import { Send } from "lucide-react";
import { withTenant } from "@aegis/db";
import { EVENT_CATEGORIES, listDestinations } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { AddDestinationDialog } from "@/components/integrations/destination-forms";
import { KIND_LABEL } from "@/components/integrations/format";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Event Destinations" };
export const dynamic = "force-dynamic";

export default async function DestinationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("integrations:read");
  const sp = await searchParams;
  const destinations = await withTenant(c.ctx.orgId, (db) => listDestinations(db, c.ctx), { readOnly: true });
  const categories = Object.entries(EVENT_CATEGORIES).map(([key, v]) => ({ key, label: v.label }));
  return (
    <div>
      <PageHeader title="Event Destinations" description="Send security events, approvals, refusals and governance changes to the tools your teams already watch. Each event is delivered once per destination, retried on failure, and every attempt is logged." badges={<DemoBadge show={c.org.demoMode} />} actions={<AddDestinationDialog canWrite={c.can("integrations:write")} categories={categories} initialKind={typeof sp.kind === "string" ? sp.kind : undefined} />} />
      <Panel title="Destinations" padded={false}>
        {destinations.length === 0 ? (
          <EmptyState icon={Send} title="No destinations yet" description="Add Slack, Teams, a SIEM, ServiceNow or a signed webhook. Events start flowing within a minute." />
        ) : (
          <SimpleTable caption="Event destinations">
            <thead>
              <tr>
                <Th>Destination</Th>
                <Th>Events</Th>
                <Th>Status</Th>
                <Th align="end">Delivered</Th>
                <Th align="end">Waiting</Th>
                <Th align="end">Failed</Th>
              </tr>
            </thead>
            <tbody>
              {destinations.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0" data-testid="destination-row" data-kind={d.kind}>
                  <Td>
                    <Link href={`/integrations/destinations/${d.id}`} className="text-accent hover:underline">
                      {d.name}
                    </Link>
                    <span className="block text-[11px] text-fg-dim">{KIND_LABEL[d.kind] ?? d.kind}</span>
                  </Td>
                  <Td>{d.categories.join(", ")}</Td>
                  <Td>
                    {!d.enabled ? <Badge tone="neutral">paused</Badge> : d.verifiedAt ? <Badge tone="allow">verified {formatDateTime(d.verifiedAt)}</Badge> : <Badge tone="approval">not yet tested</Badge>}
                    {d.lastError ? (
                      <Badge tone="deny" className="ms-1">
                        last attempt failed
                      </Badge>
                    ) : null}
                  </Td>
                  <Td align="end">{d.deliveries.delivered}</Td>
                  <Td align="end">{d.deliveries.pending}</Td>
                  <Td align="end">{d.deliveries.failed}</Td>
                </tr>
              ))}
            </tbody>
          </SimpleTable>
        )}
      </Panel>
    </div>
  );
}
