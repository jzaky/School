import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { datasetAccessAudit, deletionOverdue, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { KeyValue } from "@/components/ui/key-value";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { DeletionRequestActions, DeletionRequestForm } from "@/components/governance/data-forms";
import { DELETION_TONE } from "@/components/governance/format";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dataset" };
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("security:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const view = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        return await datasetAccessAudit(db, c.ctx, id);
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!view) notFound();
  const d = view.dataset;
  const now = new Date();
  const canWrite = c.can("security:write");
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Data Inventory", href: "/governance/data" }, { label: d.name }]} title={d.name} badges={<DemoBadge show={c.org.demoMode} />} description={d.description || undefined} />
      {view.findings.length ? (
        <Note tone="warning" className="mb-4">
          To complete this record: {view.findings.join("; ")}.
        </Note>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Record">
            <KeyValue
              columns={2}
              items={[
                { label: "Classification", value: d.classification },
                { label: "Categories", value: d.categories.join(", ") || "None recorded" },
                { label: "Storage", value: d.storageLocation || "Not recorded" },
                { label: "Region", value: d.region ? `${d.region} (declared)` : "Not recorded" },
                { label: "Retention", value: d.retentionDays ? `${d.retentionDays} days` : "Not recorded" },
                { label: "Lawful basis", value: d.lawfulBasis || "Not recorded" },
                { label: "Gateway resource", value: view.resource ? `${view.resource.name} (${view.resource.key})` : "Not tied to a resource" },
              ]}
            />
          </Panel>
          <Panel title="Agent access through AEGIS" description="Permissions on the dataset's resource, and the requests that reached it in the last 30 days">
            {!view.resource ? (
              <p className="text-sm text-fg-muted">Tie this dataset to a gateway resource to audit agent access.</p>
            ) : (
              <div className="space-y-4">
                <SimpleTable caption="Agents with access">
                  <thead>
                    <tr>
                      <Th>Agent</Th>
                      <Th>Actions</Th>
                      <Th>Clearance</Th>
                    </tr>
                  </thead>
                  <tbody data-testid="dataset-access">
                    {view.access.map((a) => (
                      <tr key={a.agent.id} className="border-b border-line last:border-0">
                        <Td>
                          <Link href={`/agents/${a.agent.id}`} className="text-accent hover:underline">
                            {a.agent.name}
                          </Link>
                        </Td>
                        <Td mono>{a.actions.join(", ")}</Td>
                        <Td>{a.aboveClearance ? <Badge tone="deny">dataset above the agent&apos;s clearance ({a.agent.dataClassificationLimit})</Badge> : <Badge tone="allow">{a.agent.dataClassificationLimit}</Badge>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </SimpleTable>
                <p className="text-sm text-fg-muted" data-testid="dataset-requests">
                  {view.requests.length} requests in 30 days:{" "}
                  {Object.entries(view.byOutcome)
                    .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
                    .join(", ") || "none"}
                  .
                </p>
              </div>
            )}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Deletion requests" description="Two people: one requests, another decides. The deletion happens in your system; AEGIS records the decision and your completion reference.">
            <ul className="mb-4 space-y-3 text-sm" data-testid="deletion-requests">
              {view.deletionRequests.length === 0 ? <li className="text-fg-muted">No deletion requests.</li> : null}
              {view.deletionRequests.map((r) => (
                <li key={r.id} className="rounded-md border border-line p-2" data-status={r.status}>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={DELETION_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    <span className="font-mono text-xs">subject ending {r.subjectHint}</span>
                    {deletionOverdue(r, now) ? <Badge tone="deny">overdue</Badge> : <span className="text-xs text-fg-dim">due {formatDateTime(r.dueAt)}</span>}
                  </span>
                  <span className="mt-1 block text-xs text-fg-muted">{r.reason}</span>
                  {r.completionReference ? <span className="mt-1 block text-xs text-fg-muted">Completed: {r.completionReference}</span> : null}
                  <div className="mt-2">
                    <DeletionRequestActions id={r.id} datasetId={d.id} status={r.status} canWrite={canWrite} isRequester={r.requestedBy === c.ctx.actor.id} />
                  </div>
                </li>
              ))}
            </ul>
            <DeletionRequestForm datasetId={d.id} canWrite={canWrite} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
