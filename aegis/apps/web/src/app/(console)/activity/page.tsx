import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { z } from "zod";
import { requirePermission } from "@/server/session";
import { loadActivity, OUTCOME_FILTERS } from "@/server/queries/activity";
import { activityFamily, subjectHref } from "@/server/queries/control";
import { actorLabel, evidenceLabels } from "@/server/queries/assurance";
import type { ActivityEvent } from "@/server/actions/gateway";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { LinkButton } from "@/components/ui/link-button";
import { ActivityTable } from "@/components/control/activity-table";
import { LiveActivity } from "@/components/control/live-activity";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const filterSchema = z.object({ outcome: z.enum(OUTCOME_FILTERS).optional(), agentId: z.string().uuid().optional() });

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

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("gateway:read");
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = filterSchema.safeParse(flat);
  const f = parsed.success ? parsed.data : {};
  const currency = typeof c.org.settings.currency === "string" ? c.org.settings.currency : "AED";
  const { actions, ledger } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const actions = await loadActivity(db, c.ctx.orgId, { outcome: f.outcome ?? null, agentId: f.agentId ?? null, limit: 100 });
      const rows = await db.evidenceEvent.findMany({ where: { orgId: c.ctx.orgId }, orderBy: { seq: "desc" }, take: 80 });
      const labels = await evidenceLabels(db, rows);
      const ledger: ActivityEvent[] = rows.map((e) => ({ id: e.id, seq: e.seq.toString(), type: e.type, family: activityFamily(e.type), actor: actorLabel(e, labels), actorType: e.actorType, subjectType: e.subjectType, subjectId: e.subjectId, subjectLabel: e.subjectType === "agent" ? (labels.agents.get(e.subjectId ?? "") ?? null) : null, href: subjectHref(e.subjectType, e.subjectId), correlationId: e.correlationId, summary: summarize(e.type, e.payload), occurredAt: e.occurredAt.toISOString() }));
      return { actions, ledger };
    },
    { readOnly: true },
  );
  return (
    <div>
      <PageHeader title="Activity" description="What agents asked to do and what happened: allowed, approved by a person, blocked, or still unresolved. Every row links to the full record." badges={<DemoBadge show={c.org.demoMode} />} actions={c.org.demoMode ? <LinkButton href="/gateway/demos">Run demo scenarios</LinkButton> : undefined} />
      <ActivityTable rows={actions.items} total={actions.total} agents={actions.agents} outcome={f.outcome ?? ""} agentId={f.agentId ?? ""} currency={currency} />
      <details className="mt-6 rounded-panel border border-line bg-bg-elev" data-testid="ledger-feed">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-fg">
          Live evidence feed
          <span className="ms-2 text-xs font-normal text-fg-muted">every entry written to the record as it happens: agent actions, approvals, policies, agents, monitoring and security</span>
        </summary>
        <div className="border-t border-line p-4">
          <LiveActivity initial={ledger} />
        </div>
      </details>
    </div>
  );
}
