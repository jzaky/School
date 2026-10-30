import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getIncident, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { isUuid, linkableEventPicks, membersWithPermission } from "@/server/queries/shield";
import { userNames } from "@/server/queries/users";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { IncidentActions } from "@/components/shield/incident-actions";
import { eventStatusLabel, severityTone } from "@/components/shield/format";
import { formatDateTime } from "@/lib/utils";
import { statusLabel, type Tone } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Incident ${id.slice(0, 8)}` };
}

const INCIDENT_EVENT_LABELS: Record<string, string> = {
  created: "Incident opened",
  note: "Note",
  assigned: "Assigned",
  unassigned: "Assignee removed",
  security_event_linked: "Security event linked",
  status_investigating: "Moved to investigating",
  status_contained: "Marked contained",
  status_resolved: "Resolved",
  reopened: "Reopened",
};

function incidentEventTone(type: string): Tone {
  if (type === "status_resolved") return "allow";
  if (type === "reopened") return "deny";
  if (type === "status_contained") return "approval";
  if (type === "status_investigating" || type === "created") return "info";
  return "neutral";
}

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("security:read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const canWrite = c.can("security:write");
  const data = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        const incident = await getIncident(db, c.ctx, id);
        const [members, events] = await Promise.all([canWrite ? membersWithPermission(db, c.ctx.orgId, "security:write") : [], canWrite && incident.status !== "resolved" ? linkableEventPicks(db, c.ctx.orgId) : []]);
        return { incident, members, events };
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!data) notFound();
  const { incident, members, events } = data;
  const names = await userNames([incident.assigneeId, ...incident.events.map((e) => e.actorId)]);
  const agentById = new Map(incident.agents.map((a) => [a.id, a]));
  const requestById = new Map(incident.requests.map((r) => [r.id, r]));

  const timeline: TimelineItem[] = incident.timeline.map((t) => {
    if (t.kind === "incident_event") {
      const actor = names.get((t.detail.actorId as string | null) ?? "") ?? (t.detail.actorId ? "Member" : "System");
      const label = INCIDENT_EVENT_LABELS[t.type] ?? t.type.replace(/_/g, " ");
      const isNote = t.type === "note";
      return { id: `ie-${t.id}`, title: isNote ? t.title : label, meta: isNote ? `Note by ${actor}` : t.title && t.title !== label && t.title !== t.type.replace(/_/g, " ") ? `${actor}: ${t.title}` : actor, time: formatDateTime(t.at), tone: incidentEventTone(t.type) };
    }
    if (t.kind === "security_event") {
      const agent = agentById.get((t.detail.agentId as string | null) ?? "");
      const reqId = t.detail.actionRequestId as string | null;
      return {
        id: `se-${t.id}`,
        title: (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href={`/security/events/${t.id}`} className="text-accent hover:underline">
              {t.title}
            </Link>
            <Badge tone={severityTone(t.detail.severity as string)}>{statusLabel(t.detail.severity as string)}</Badge>
          </span>
        ),
        meta: (
          <span className="font-mono">
            {t.type}
            {agent ? <> · {agent.name}</> : null}
            {reqId ? (
              <>
                {" "}
                ·{" "}
                <Link href={`/gateway/${reqId}`} className="text-accent hover:underline">
                  request {reqId.slice(0, 8)}
                </Link>
              </>
            ) : null}
            {" · "}
            {eventStatusLabel(t.detail.status as string)}
          </span>
        ),
        time: formatDateTime(t.at),
        tone: severityTone(t.detail.severity as string),
      };
    }
    const req = requestById.get((t.detail.actionRequestId as string | null) ?? "");
    return {
      id: `ev-${t.id}`,
      title: <span className="font-mono text-xs">{t.type}</span>,
      meta: (
        <span className="font-mono">
          evidence seq {t.detail.seq as string} · {(t.detail.hash as string).slice(0, 16)}
          {req ? <> · {req.toolKey}</> : null}
        </span>
      ),
      time: formatDateTime(t.at),
      tone: t.type.includes("denied") || t.type.includes("blocked") ? "deny" : t.type.includes("executed") ? "allow" : "neutral",
    };
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Incidents", href: "/security/incidents" }, { label: `#${incident.number}` }]}
        title={incident.title}
        badges={
          <>
            <StatusBadge status={incident.status} />
            <Badge tone={severityTone(incident.severity)}>{statusLabel(incident.severity)}</Badge>
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={`Incident #${incident.number}, opened ${formatDateTime(incident.createdAt)}${incident.resolvedAt ? `, resolved ${formatDateTime(incident.resolvedAt)}` : ""}.`}
        actions={<IncidentActions incidentId={incident.id} status={incident.status} summary={incident.summary} assigneeId={incident.assigneeId} canWrite={canWrite} members={members.map((m) => ({ userId: m.userId, name: m.name, roleName: m.roleName }))} events={events.map((e) => ({ id: e.id, type: e.type, severity: e.severity, title: e.title, status: e.status, createdAt: e.createdAt.toISOString() }))} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Summary">{incident.summary ? <p className="whitespace-pre-wrap text-sm text-fg">{incident.summary}</p> : <p className="text-xs text-fg-dim">No summary yet. A summary of at least 10 characters is required to resolve the incident.</p>}</Panel>
          <Panel title="Timeline" description="What happened on this incident, the security events linked to it and the record entries for the related agent actions, oldest first">
            <Timeline items={timeline} emptyText="Nothing recorded yet." />
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Details">
            <KeyValue
              items={[
                { label: "Number", value: `#${incident.number}`, mono: true },
                { label: "Status", value: <StatusBadge status={incident.status} /> },
                { label: "Severity", value: <Badge tone={severityTone(incident.severity)}>{statusLabel(incident.severity)}</Badge> },
                { label: "Assignee", value: incident.assigneeId ? (names.get(incident.assigneeId) ?? "Member") : null },
                { label: "Linked events", value: incident.securityEvents.length },
                { label: "Opened", value: formatDateTime(incident.createdAt) },
                { label: "Updated", value: formatDateTime(incident.updatedAt) },
                { label: "Resolved", value: incident.resolvedAt ? formatDateTime(incident.resolvedAt) : null },
                { label: "Record entries (ledger)", value: incident.incidentEvidence.length },
              ]}
            />
          </Panel>
          <Panel title="Agents involved">
            {incident.agents.length === 0 ? (
              <p className="text-xs text-fg-dim">No agents linked.</p>
            ) : (
              <ul className="divide-y divide-line">
                {incident.agents.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
                    <Link href={`/agents/${a.id}`} className="min-w-0 truncate text-accent hover:underline">
                      {a.name}
                    </Link>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Related requests">
            {incident.requests.length === 0 ? (
              <p className="text-xs text-fg-dim">None of the linked events point at an agent action.</p>
            ) : (
              <ul className="divide-y divide-line">
                {incident.requests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
                    <Link href={`/gateway/${r.id}`} className="min-w-0 truncate font-mono text-xs text-accent hover:underline">
                      {r.toolKey} · {r.id.slice(0, 8)}
                    </Link>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
