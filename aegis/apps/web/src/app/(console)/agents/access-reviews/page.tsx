import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { withTenant } from "@aegis/db";
import { accessReviewOverview } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Note } from "@/components/ui/note";
import { StatPanel } from "@/components/ui/stat-panel";
import { SimpleTable, Td, Th } from "@/components/ui/simple-table";
import { CompleteReviewButton, DecideItem, StartReviewButton } from "@/components/agents/access-review-controls";

export const metadata: Metadata = { title: "Access Reviews" };
export const dynamic = "force-dynamic";

const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "never");
const STATE = { open: { label: "Open", tone: "info" }, overdue: { label: "Overdue", tone: "deny" }, completed: { label: "Completed", tone: "allow" } } as const;

export default async function AccessReviewsPage() {
  const c = await requirePermission("agents:read");
  const o = await withTenant(c.ctx.orgId, (db) => accessReviewOverview(db, c.ctx), { readOnly: true });
  const canControl = c.can("agents:control");
  const decided = o.items.filter((i) => i.decision).length;
  const unused = o.items.filter((i) => i.uses === 0).length;
  const openState = o.open ? o.reviews.find((r) => r.id === o.open!.id)!.state : null;
  return (
    <div>
      <PageHeader
        title="Access Reviews"
        description="Review, on a schedule, every tool and resource each AI agent can use, and remove what it no longer needs. Removing access revokes it at once. Every decision and each completed review is kept in the evidence record."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={<StartReviewButton canControl={canControl} open={!!o.open} />}
      />
      {o.nextOverdue && !o.open ? <Note tone="danger" className="mb-4">The next access review was due on {day(o.nextDueAt)}. Start it now.</Note> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Next review due" value={day(o.nextDueAt)} tone={o.nextOverdue ? "deny" : "neutral"} />
        <StatPanel label="Grants in this review" value={o.items.length} footer={o.open ? `${decided} decided` : "No review open"} />
        <StatPanel label="Unused grants" value={unused} tone={unused ? "approval" : "neutral"} footer={o.open ? `Not used in ${o.open.unusedDays} days` : undefined} />
        <StatPanel label="Reviews completed" value={o.reviews.filter((r) => r.state === "completed").length} tone="allow" />
      </div>
      {o.open ? (
        <Panel
          title={o.open.title}
          description={`Due ${day(o.open.dueAt)}. Unused grants are listed first. The agent's technical owner cannot decide its items.`}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={STATE[openState!].tone}>{STATE[openState!].label}</Badge>
              <CompleteReviewButton reviewId={o.open.id} undecided={o.items.length - decided} canControl={canControl} />
            </div>
          }
          padded={false}
          className="mb-4"
        >
          {o.items.length === 0 ? (
            <EmptyState title="No grants to review" description="No agent holds a tool or resource grant right now." />
          ) : (
            <SimpleTable caption="Grants to review">
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th>Access</Th>
                  <Th align="end">Uses</Th>
                  <Th className="hidden md:table-cell">Last used</Th>
                  <Th align="end">Decision</Th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => {
                  const d = i.detail as { agentName?: string; riskLevel?: string; classification?: string; actions?: string[] };
                  return (
                    <tr key={i.id} data-testid="review-item">
                      <Td>{d.agentName ?? "Agent"}</Td>
                      <Td>
                        <span className="font-mono text-xs">{i.label}</span>{" "}
                        <Badge>{i.kind === "tool" ? `tool · ${d.riskLevel ?? ""} risk` : `${d.classification ?? ""} data · ${(d.actions ?? []).join(", ")}`}</Badge>
                      </Td>
                      <Td align="end">{i.uses === 0 ? <Badge tone="approval">unused</Badge> : i.uses}</Td>
                      <Td className="hidden md:table-cell">{day(i.lastUsedAt)}</Td>
                      <Td align="end">{i.decision ? <Badge tone={i.decision === "keep" ? "allow" : "deny"}>{i.decision === "keep" ? "Kept" : "Removed"}</Badge> : <DecideItem itemId={i.id} label={i.label} canControl={canControl} unused={i.uses === 0} />}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </SimpleTable>
          )}
        </Panel>
      ) : null}
      <Panel title="Past reviews" padded={false}>
        {o.reviews.filter((r) => r.state === "completed").length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No completed reviews yet" description="Start a review to certify what each agent can use. Auditors ask for this record." />
        ) : (
          <SimpleTable caption="Completed access reviews">
            <thead>
              <tr>
                <Th>Review</Th>
                <Th>Completed</Th>
                <Th align="end">Grants</Th>
                <Th align="end">Removed</Th>
                <Th>On time</Th>
              </tr>
            </thead>
            <tbody>
              {o.reviews
                .filter((r) => r.state === "completed")
                .map((r) => {
                  const s = r.summary as { items?: number; removed?: number; onTime?: boolean };
                  return (
                    <tr key={r.id} data-testid="past-review">
                      <Td>{r.title}</Td>
                      <Td>{day(r.completedAt)}</Td>
                      <Td align="end">{s.items ?? 0}</Td>
                      <Td align="end">{s.removed ?? 0}</Td>
                      <Td>{s.onTime ? <Badge tone="allow">On time</Badge> : <Badge tone="deny">Late</Badge>}</Td>
                    </tr>
                  );
                })}
            </tbody>
          </SimpleTable>
        )}
      </Panel>
    </div>
  );
}
