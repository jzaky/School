import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getRegulatoryChange, isAegisError, suggestImpact } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { KeyValue } from "@/components/ui/key-value";
import { AssessmentForm, MarkImplementedForm, RegulatoryActionForm } from "@/components/governance/regulatory-forms";
import { REG_LABEL, REG_TONE } from "@/components/governance/format";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Regulatory change" };
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function merge(a: { id: string; label: string }[], b: { id: string; label: string }[]) {
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
}

export default async function RegulatoryChangePage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("audit:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const data = await withTenant(
    c.ctx.orgId,
    async (db) => {
      try {
        return { view: await getRegulatoryChange(db, c.ctx, id), suggestion: await suggestImpact(db, c.ctx, id) };
      } catch (e) {
        if (isAegisError(e) && e.code === "not_found") return null;
        throw e;
      }
    },
    { readOnly: true },
  );
  if (!data) notFound();
  const { view, suggestion } = data;
  const ch = view.change;
  const im = view.impact;
  const options = {
    controls: merge(im.controls.map((x) => ({ id: x.id, label: `${x.code} ${x.title}` })), suggestion.controls),
    policies: merge(im.policies.map((x) => ({ id: x.id, label: x.name })), suggestion.policies),
    agents: merge(im.agents.map((x) => ({ id: x.id, label: x.name })), suggestion.agents),
    models: merge(im.models.map((x) => ({ id: x.id, label: x.name })), suggestion.models),
    datasets: merge(im.datasets.map((x) => ({ id: x.id, label: x.name })), suggestion.datasets),
  };
  const selected = { controls: im.controls.map((x) => x.id), policies: im.policies.map((x) => x.id), agents: im.agents.map((x) => x.id), models: im.models.map((x) => x.id), datasets: im.datasets.map((x) => x.id) };
  const canWrite = c.can("audit:write");
  const closed = ch.status === "implemented";
  const openTasks = view.tasks.filter((t) => t.status !== "resolved").length;
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Regulatory Changes", href: "/governance/regulatory" }, { label: ch.title }]} title={ch.title} badges={<><Badge tone={REG_TONE[ch.status] ?? "neutral"}>{REG_LABEL[ch.status] ?? ch.status}</Badge><DemoBadge show={c.org.demoMode} /></>} description={ch.summary || undefined} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Impact assessment" description="Tick what this change affects. Unticked items are suggestions from a lexical match against the linked framework and your inventory.">
            <AssessmentForm id={ch.id} options={options} selected={selected} initialNotes={im.notes} canWrite={canWrite} closed={closed} />
          </Panel>
          <Panel title="Actions" description="Each action is a remediation task with an owner and a due date (the effective date unless set).">
            <ul className="mb-3 divide-y divide-line text-sm" data-testid="regulatory-tasks">
              {view.tasks.length === 0 ? <li className="py-1 text-fg-muted">No actions yet.</li> : null}
              {view.tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/audit/remediation/${t.id}`} className="text-accent hover:underline">
                    {t.title}
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-fg-muted">
                    {t.dueAt ? `due ${formatDate(t.dueAt)}` : null}
                    <Badge tone={t.status === "resolved" ? "allow" : "approval"}>{t.status.replace(/_/g, " ")}</Badge>
                  </span>
                </li>
              ))}
            </ul>
            <RegulatoryActionForm id={ch.id} canWrite={canWrite} closed={closed || ch.status === "not_applicable"} />
            {ch.status === "action_required" ? (
              <div className="mt-4 border-t border-line pt-4">
                <MarkImplementedForm id={ch.id} canWrite={canWrite} blocker={openTasks ? `${openTasks} task${openTasks === 1 ? " is" : "s are"} not resolved yet` : null} />
              </div>
            ) : null}
          </Panel>
        </div>
        <Panel title="Record">
          <KeyValue
            items={[
              { label: "Source", value: ch.source },
              { label: "Reference", value: ch.reference || "Not recorded" },
              { label: "Jurisdiction", value: ch.jurisdiction || "Not recorded" },
              { label: "Framework", value: view.framework?.name ?? "None" },
              { label: "Effective", value: ch.effectiveAt ? formatDate(ch.effectiveAt) : "Not set" },
              { label: "Assessment", value: ch.decisionNote ?? "Not assessed yet" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
