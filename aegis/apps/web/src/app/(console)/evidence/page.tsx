import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { evidenceFilter, evidenceTypes, governanceMetrics, listEvidence, verifyChain } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { subjectHref } from "@/server/queries/control";
import { actorLabel, evidenceLabels } from "@/server/queries/assurance";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { Note } from "@/components/ui/note";
import { EvidenceView, type EvidenceRow } from "@/components/assurance/evidence-view";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Evidence Ledger" };
export const dynamic = "force-dynamic";

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePermission("evidence:read");
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = evidenceFilter.safeParse({ ...flat, pageSize: flat.pageSize ?? 25 });
  const filter = parsed.success ? parsed.data : evidenceFilter.parse({ pageSize: 25 });
  const { page, types, subjectTypes, metrics, chain, labels } = await withTenant(c.ctx.orgId, async (db) => {
    const [page, types, subjects, metrics, chain] = await Promise.all([listEvidence(db, c.ctx, filter), evidenceTypes(db, c.ctx), db.evidenceEvent.groupBy({ by: ["subjectType"], where: { orgId: c.ctx.orgId } }), governanceMetrics(db, c.ctx, 30), verifyChain(db, c.ctx.orgId)]);
    const labels = await evidenceLabels(db, page.items);
    return { page, types, subjectTypes: subjects.map((s) => s.subjectType).sort(), metrics, chain, labels };
  }, { timeout: 60_000 });
  const rows: EvidenceRow[] = page.items.map((e) => ({ id: e.id, seq: e.seq.toString(), occurredAt: e.occurredAt.toISOString(), type: e.type, actor: actorLabel(e, labels), actorType: e.actorType, subjectType: e.subjectType, subjectId: e.subjectId, subjectLabel: e.subjectType === "agent" ? (labels.agents.get(e.subjectId ?? "") ?? null) : null, href: subjectHref(e.subjectType, e.subjectId), correlationId: e.correlationId, hash: e.hash }));
  const filters = { type: filter.type ?? "", subjectType: filter.subjectType ?? "", correlationId: filter.correlationId ?? "", since: typeof flat.since === "string" ? flat.since : "", until: typeof flat.until === "string" ? flat.until : "", q: filter.q ?? "" };
  const ev = metrics.evidence;
  return (
    <div>
      <PageHeader title="Evidence Ledger" description="Every governance event, kept in a record that cannot be edited without it showing. Each entry is linked to the one before it (a hash chain) and batches are signed in checkpoints. Checking the record recomputes every link, and the check itself is recorded." badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Events" value={ev.events} footer={ev.lastAt ? `Last at ${formatDateTime(ev.lastAt)}` : "none yet"} />
        <StatPanel label="Latest entry number (seq)" value={<span className="font-mono">{ev.lastSeq}</span>} />
        <StatPanel label="Last checkpoint" value={ev.lastCheckpointSeq ? <span className="font-mono">#{ev.lastCheckpointSeq}</span> : "none"} footer={ev.lastCheckpointAt ? `Signed ${formatDateTime(ev.lastCheckpointAt)}` : "Written by the background worker"} />
        <StatPanel label="Chain status" value={chain.valid ? "Valid" : "Invalid"} tone={chain.valid ? "allow" : "deny"} footer={`${chain.checked} events recomputed, ${chain.checkpoints.length} checkpoints`} />
      </div>
      <Note className="my-4">
        <strong>Tamper-evident, not immutable.</strong> Any edit would show, but the record is not impossible to change. Each entry stores the fingerprint (hash) of the one before it, so any edit or missing entry shows up as a broken link from that point on. Someone who held both the database owner role and the signing key could still rewrite history. That is why the key is kept outside the database and why exports include the public key, so the record can be re-checked on another machine.
      </Note>
      <EvidenceView rows={rows} pagination={{ page: page.page, pageSize: page.pageSize, total: page.total }} filters={filters} types={types} subjectTypes={subjectTypes} initialChain={{ valid: chain.valid, checked: chain.checked, firstBadSeq: chain.firstBadSeq, reason: chain.reason, checkpoints: chain.checkpoints.length }} />
    </div>
  );
}
