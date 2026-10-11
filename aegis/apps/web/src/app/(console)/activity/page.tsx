import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { requirePermission } from "@/server/session";
import { activityFamily, subjectHref } from "@/server/queries/control";
import { actorLabel, evidenceLabels } from "@/server/queries/assurance";
import type { ActivityEvent } from "@/server/actions/gateway";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { LiveActivity } from "@/components/control/live-activity";

export const metadata: Metadata = { title: "Live Activity" };
export const dynamic = "force-dynamic";

function summarize(type: string, payload: unknown): string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["tool", "result", "reason", "rule", "key", "version", "severity", "to", "from", "status", "note"]) {
    const v = p[k];
    if (v === undefined || v === null || v === "" || typeof v === "object") continue;
    parts.push(`${k} ${String(v)}`);
    if (parts.length >= 3) break;
  }
  if (Array.isArray(p.reasons) && p.reasons.length && typeof p.reasons[0] === "string") parts.push(String(p.reasons[0]).slice(0, 80));
  return parts.join(" · ") || type;
}

export default async function ActivityPage() {
  const c = await requirePermission("gateway:read");
  const initial = await withTenant(c.ctx.orgId, async (db) => {
    const rows = await db.evidenceEvent.findMany({ where: { orgId: c.ctx.orgId }, orderBy: { seq: "desc" }, take: 80 });
    const labels = await evidenceLabels(db, rows);
    const events: ActivityEvent[] = rows.map((e) => ({ id: e.id, seq: e.seq.toString(), type: e.type, family: activityFamily(e.type), actor: actorLabel(e, labels), actorType: e.actorType, subjectType: e.subjectType, subjectId: e.subjectId, subjectLabel: e.subjectType === "agent" ? (labels.agents.get(e.subjectId ?? "") ?? null) : null, href: subjectHref(e.subjectType, e.subjectId), correlationId: e.correlationId, summary: summarize(e.type, e.payload), occurredAt: e.occurredAt.toISOString() }));
    return events;
  });
  return (
    <div>
      <PageHeader title="Live Activity" description="Gateway decisions, approvals, agent lifecycle, policy and monitoring events as they land on the evidence ledger." badges={<DemoBadge show={c.org.demoMode} />} />
      <LiveActivity initial={initial} />
    </div>
  );
}
