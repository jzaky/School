import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { withTenant } from "@aegis/db";
import { listRegulatoryChanges } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Note } from "@/components/ui/note";
import { StatPanel } from "@/components/ui/stat-panel";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { CreateRegulatoryChangeDialog } from "@/components/governance/regulatory-forms";
import { REG_LABEL, REG_TONE } from "@/components/governance/format";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Regulatory Changes" };
export const dynamic = "force-dynamic";

export default async function RegulatoryPage() {
  const c = await requirePermission("audit:read");
  const { changes, frameworks } = await withTenant(c.ctx.orgId, async (db) => ({ changes: await listRegulatoryChanges(db, c.ctx), frameworks: await db.framework.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) }), { readOnly: true });
  const open = changes.filter((x) => x.status !== "implemented" && x.status !== "not_applicable");
  return (
    <div>
      <PageHeader title="Regulatory Changes" description="New laws, guidance and standard revisions your organization is tracking, what each one affects, and the work it created." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateRegulatoryChangeDialog canWrite={c.can("audit:write")} frameworks={frameworks} />} />
      <Note tone="info" className="mb-4">
        AEGIS does not monitor regulators or interpret law. People record each change and decide its impact; suggested matches are lexical and only a starting point.
      </Note>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Open" value={open.length} />
        <StatPanel label="Action required" value={changes.filter((x) => x.status === "action_required").length} tone="deny" />
        <StatPanel label="Effective within 90 days" value={changes.filter((x) => x.effectiveSoon).length} tone="approval" />
        <StatPanel label="Effective but still open" value={changes.filter((x) => x.effectivePassedOpen).length} tone={changes.some((x) => x.effectivePassedOpen) ? "deny" : "neutral"} />
      </div>
      <Panel title="Register" padded={false}>
        {changes.length === 0 ? (
          <EmptyState icon={Landmark} title="No changes recorded" description="Record a regulatory change to assess its impact and track the work." />
        ) : (
          <SimpleTable caption="Regulatory changes">
            <thead>
              <tr>
                <Th>Change</Th>
                <Th>Jurisdiction</Th>
                <Th>Effective</Th>
                <Th>Status</Th>
                <Th align="end">Tasks</Th>
              </tr>
            </thead>
            <tbody>
              {changes.map((x) => (
                <tr key={x.id} className="border-b border-line last:border-0" data-testid="regulatory-row">
                  <Td>
                    <Link href={`/governance/regulatory/${x.id}`} className="text-accent hover:underline">
                      {x.title}
                    </Link>
                    <span className="block text-[11px] text-fg-dim">{x.source}</span>
                  </Td>
                  <Td>{x.jurisdiction}</Td>
                  <Td>
                    {x.effectiveAt ? formatDate(x.effectiveAt) : <span className="text-fg-dim">not set</span>}
                    {x.effectiveSoon ? (
                      <Badge tone="approval" className="ms-1">
                        soon
                      </Badge>
                    ) : null}
                    {x.effectivePassedOpen ? (
                      <Badge tone="deny" className="ms-1">
                        in force, still open
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={REG_TONE[x.status] ?? "neutral"}>{REG_LABEL[x.status] ?? x.status}</Badge>
                  </Td>
                  <Td align="end">
                    {x.tasksResolved}/{x.tasksTotal}
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
