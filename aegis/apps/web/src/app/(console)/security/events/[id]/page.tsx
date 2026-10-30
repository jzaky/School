import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getSecurityEvent, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { isUuid, openIncidentPicks } from "@/server/queries/shield";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { CodeBlock } from "@/components/ui/code-block";
import { Timeline } from "@/components/ui/timeline";
import { Note } from "@/components/ui/note";
import { EventActions } from "@/components/shield/event-actions";
import { eventStatusLabel, eventStatusTone, pretty, severityTone } from "@/components/shield/format";
import { formatDateTime } from "@/lib/utils";
import { statusLabel, statusTone } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Security event ${id.slice(0, 8)}` };
}

export default async function SecurityEventPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("security:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        const ev = await getSecurityEvent(db, c.ctx, id);
        const incidents = await openIncidentPicks(db, c.ctx.orgId);
        return { ev, incidents };
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!data) notFound();
  const { ev, incidents } = data;
  const detail = (ev.detail ?? {}) as Record<string, unknown>;
  const triage = detail.triage as { status?: string; note?: string; by?: string; at?: string } | undefined;
  const names = await userNames([triage?.by]);
  const { triage: _omit, ...detailRest } = detail;
  void _omit;
  const explanation = ev.decision?.explanation;
  const explanationText = typeof explanation === "string" ? explanation : explanation && typeof explanation === "object" && Object.keys(explanation as object).length ? pretty(explanation) : null;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Security Events", href: "/security/events" }, { label: ev.type }]}
        title={ev.title}
        badges={
          <>
            <Badge tone={severityTone(ev.severity)}>{statusLabel(ev.severity)}</Badge>
            <StatusBadge status={ev.status} tone={eventStatusTone(ev.status)} label={eventStatusLabel(ev.status)} />
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={
          <>
            <span className="font-mono text-xs">{ev.type}</span> recorded {formatDateTime(ev.createdAt)}
          </>
        }
        actions={<EventActions eventId={ev.id} eventTitle={ev.title} status={ev.status} canWrite={c.can("security:write")} incidents={incidents} />}
      />

      {triage ? (
        <Note className="mb-4">
          {triage.status === "dismissed" ? "Dismissed" : "Triaged"} by {names.get(triage.by ?? "") ?? "an analyst"} {triage.at ? `on ${formatDateTime(triage.at)}` : ""}
          {triage.note ? <>: {triage.note}</> : null}
        </Note>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Event">
          <KeyValue
            items={[
              { label: "Event id", value: ev.id, mono: true },
              { label: "Type", value: ev.type, mono: true },
              { label: "Severity", value: <Badge tone={severityTone(ev.severity)}>{statusLabel(ev.severity)}</Badge> },
              { label: "Status", value: eventStatusLabel(ev.status) },
              {
                label: "Agent",
                value: ev.agent ? (
                  <Link href={`/agents/${ev.agent.id}`} className="text-accent hover:underline">
                    {ev.agent.name} <span className="font-mono text-xs text-fg-muted">{ev.agent.slug}</span>
                  </Link>
                ) : null,
              },
              {
                label: "Incident",
                value: ev.incident ? (
                  <Link href={`/security/incidents/${ev.incident.id}`} className="text-accent hover:underline">
                    #{ev.incident.number} {ev.incident.title}
                  </Link>
                ) : null,
              },
              { label: "Recorded", value: formatDateTime(ev.createdAt) },
            ]}
          />
        </Panel>

        <Panel title="Related request" description="The agent action this event was raised about">
          {ev.request ? (
            <KeyValue
              items={[
                {
                  label: "Request",
                  value: (
                    <Link href={`/gateway/${ev.request.id}`} className="font-mono text-xs text-accent hover:underline">
                      {ev.request.id}
                    </Link>
                  ),
                },
                { label: "Tool", value: ev.request.toolKey, mono: true },
                { label: "Action", value: ev.request.action, mono: true },
                { label: "Resource", value: ev.request.resourceKey, mono: true },
                { label: "Request status", value: <StatusBadge status={ev.request.status} /> },
                { label: "Decision", value: ev.decision ? <StatusBadge status={ev.decision.result} /> : null },
                { label: "Matched rules", value: ev.decision?.matchedRuleIds.length ? <span className="font-mono text-xs">{ev.decision.matchedRuleIds.join(", ")}</span> : null },
                { label: "Time to decide", value: ev.decision?.latencyMs !== null && ev.decision?.latencyMs !== undefined ? `${ev.decision.latencyMs} ms` : null },
                { label: "Receipt", value: ev.request.receipt ? <StatusBadge status={ev.request.receipt.status} /> : null },
                { label: "Submitted", value: formatDateTime(ev.request.createdAt) },
              ]}
            />
          ) : (
            <p className="text-xs text-fg-dim">This event is not linked to an agent action.</p>
          )}
        </Panel>

        <Panel title="Decision explanation" description="Why the Action Gateway decided as it did">
          {explanationText ? <CodeBlock code={explanationText} wrap /> : <p className="text-xs text-fg-dim">No decision is attached to this event.</p>}
        </Panel>

        <Panel title="Policy versions" description="Policies in force for the decision">
          {ev.policyVersion || ev.decisionPolicyVersions.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {ev.policyVersion ? (
                <li className="flex items-center justify-between gap-2">
                  <Link href={`/policies/${ev.policyVersion.policy.id}`} className="text-accent hover:underline">
                    {ev.policyVersion.policy.name}
                  </Link>
                  <span className="font-mono text-xs text-fg-muted">
                    v{ev.policyVersion.version} <Badge tone={statusTone(ev.policyVersion.state)}>{statusLabel(ev.policyVersion.state)}</Badge>
                  </span>
                </li>
              ) : null}
              {ev.decisionPolicyVersions
                .filter((p) => p.id !== ev.policyVersion?.id)
                .map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span>{p.policy.name}</span>
                    <span className="font-mono text-xs text-fg-muted">v{p.version}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-dim">No policy version is recorded for this event.</p>
          )}
        </Panel>

        <Panel title="Detail" description="What was recorded with the event. Only the names of data classes and tools appear here, never the sensitive data itself." className="lg:col-span-2">
          <CodeBlock code={pretty(detailRest) || "{}"} />
        </Panel>

        <Panel title="Evidence for the request" description="Entries in the record (ledger) about the related agent action" className="lg:col-span-2">
          <Timeline
            items={ev.evidence.map((e) => ({
              id: e.id,
              title: <span className="font-mono text-xs">{e.type}</span>,
              meta: (
                <span className="font-mono">
                  seq {e.seq} · {e.hash.slice(0, 16)}
                </span>
              ),
              time: formatDateTime(e.occurredAt),
              tone: e.type.includes("denied") || e.type.includes("blocked") ? "deny" : e.type.includes("executed") || e.type.includes("allowed") ? "allow" : "neutral",
            }))}
            emptyText="No ledger entries for this event's request."
          />
        </Panel>
      </div>
    </div>
  );
}
