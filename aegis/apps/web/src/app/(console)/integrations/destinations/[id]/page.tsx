import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getDestination, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { KeyValue } from "@/components/ui/key-value";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { DestinationControls, RetryDeliveryButton } from "@/components/integrations/destination-forms";
import { KIND_LABEL } from "@/components/integrations/format";
import { formatDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/status";

export const metadata: Metadata = { title: "Event destination" };
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TONE: Record<string, Tone> = { delivered: "allow", pending: "approval", failed: "deny" };

export default async function DestinationPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("integrations:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const view = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        return await getDestination(db, c.ctx, id);
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!view) notFound();
  const d = view.destination;
  const cfg = d.config as Record<string, string>;
  const canWrite = c.can("integrations:write");
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Event Destinations", href: "/integrations/destinations" }, { label: d.name }]} title={d.name} badges={<><Badge tone="info">{KIND_LABEL[d.kind] ?? d.kind}</Badge><DemoBadge show={c.org.demoMode} /></>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Deliveries" description="The last 100 attempts. Server errors and timeouts retry after 1, 5 and 15 minutes, 1 hour and 6 hours; client errors fail at once." className="xl:col-span-2" padded={false}>
          {view.deliveries.length === 0 ? (
            <p className="p-4 text-sm text-fg-muted">Nothing sent yet. New matching events go out within a minute; send a test event to check the connection now.</p>
          ) : (
            <SimpleTable caption="Deliveries">
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th align="end">Attempts</Th>
                  <Th>Result</Th>
                  <Th>When</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody data-testid="destination-deliveries">
                {view.deliveries.map((x) => (
                  <tr key={x.id} className="border-b border-line last:border-0" data-status={x.status}>
                    <Td mono>{x.eventType}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{x.status}</Badge>
                    </Td>
                    <Td align="end">{x.attempts}</Td>
                    <Td className="max-w-xs truncate text-xs text-fg-muted">{x.responseStatus ? `HTTP ${x.responseStatus}` : ""} {x.lastError ?? ""}</Td>
                    <Td className="text-xs">{formatDateTime(x.deliveredAt ?? x.createdAt)}</Td>
                    <Td>{x.status === "failed" && x.evidenceEventId ? <RetryDeliveryButton destinationId={d.id} deliveryId={x.id} canWrite={canWrite} /> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Connection">
            <DestinationControls id={d.id} kind={d.kind} enabled={d.enabled} canWrite={canWrite} />
          </Panel>
          <Panel title="Settings">
            <KeyValue
              items={[
                { label: "Events", value: d.categories.join(", ") },
                { label: "Security severity", value: d.minSeverity ? `${d.minSeverity} and above` : "every severity" },
                { label: "Target", value: cfg.url ?? cfg.instanceUrl ?? cfg.site ?? cfg.host ?? "" },
                { label: "Credential", value: d.secretHint },
                { label: "Verified", value: d.verifiedAt ? formatDateTime(d.verifiedAt) : "Not yet: send a test event" },
                { label: "Last delivery", value: d.lastDeliveredAt ? formatDateTime(d.lastDeliveredAt) : "None" },
                { label: "Last error", value: d.lastError ?? "None" },
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
