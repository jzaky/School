import type { Metadata } from "next";
import Link from "next/link";
import { Database } from "lucide-react";
import { withTenant } from "@aegis/db";
import { listDatasets } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { RegisterDatasetDialog } from "@/components/governance/data-forms";

export const metadata: Metadata = { title: "Data Inventory" };
export const dynamic = "force-dynamic";

export default async function DataInventoryPage() {
  const c = await requirePermission("security:read");
  const { datasets, resources } = await withTenant(c.ctx.orgId, async (db) => ({ datasets: await listDatasets(db, c.ctx), resources: await db.resource.findMany({ orderBy: { name: "asc" }, select: { id: true, key: true, name: true } }) }), { readOnly: true });
  return (
    <div>
      <PageHeader title="Data Inventory" description="The datasets your agents can reach, who owns them, how they are classified, how long they are kept, and which agents reached them through AEGIS." badges={<DemoBadge show={c.org.demoMode} />} actions={<RegisterDatasetDialog canWrite={c.can("security:write")} resources={resources} />} />
      <Note tone="info" className="mb-4">
        Storage location and region are what your organization records; AEGIS does not verify where data is held. Agent access comes from the permissions and requests AEGIS itself governs, so access outside AEGIS is not shown.
      </Note>
      <Panel title="Datasets" padded={false}>
        {datasets.length === 0 ? (
          <EmptyState icon={Database} title="No datasets registered" description="Register a dataset and tie it to the gateway resource that fronts it." />
        ) : (
          <SimpleTable caption="Datasets">
            <thead>
              <tr>
                <Th>Dataset</Th>
                <Th>Classification</Th>
                <Th>Region</Th>
                <Th align="end">Agents with access</Th>
                <Th align="end">Requests, 30 days</Th>
                <Th>Findings</Th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0" data-testid="dataset-row" data-dataset={d.key}>
                  <Td>
                    <Link href={`/governance/data/${d.id}`} className="text-accent hover:underline">
                      {d.name}
                    </Link>
                    <span className="block text-[11px] text-fg-dim">{d.categories.join(", ")}</span>
                  </Td>
                  <Td>{d.classification}</Td>
                  <Td>{d.region || <span className="text-fg-dim">not recorded</span>}</Td>
                  <Td align="end">{d.agentsWithAccess}</Td>
                  <Td align="end">{d.requests30d}</Td>
                  <Td>
                    {d.findings.length ? (
                      <span className="flex flex-wrap gap-1">
                        {d.findings.map((f) => (
                          <Badge key={f} tone="approval">
                            {f}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <Badge tone="allow">complete</Badge>
                    )}
                    {d.openDeletionRequests ? (
                      <Badge tone="info" className="ms-1">
                        {d.openDeletionRequests} deletion open
                      </Badge>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </SimpleTable>
        )}
      </Panel>
    </div>
  );
}
