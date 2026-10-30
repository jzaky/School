import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { getSoftware } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { Badge } from "@/components/ui/badge";
import { TimeAgo } from "@/components/ui/time";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { AcceptFindingButton, AttachEvidenceForm, DecisionForm } from "@/components/secure/software";
import { SOFTWARE_STATUS, severityTone } from "@/components/secure/format";

export const metadata: Metadata = { title: "Software" };
export const dynamic = "force-dynamic";

type Factor = { factor: string; points: number; detail: string };

export default async function SoftwareDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePermission("org:read");
  const { item, components, evidence } = await withTenant(c.ctx.orgId, (db) => getSoftware(db, c.ctx, id), { readOnly: true });
  const canWrite = c.can("security:write");
  const isRequester = item.requestedBy === c.ctx.actor.id;
  const factors = item.riskFactors as Factor[];
  const open = item.findings.filter((f) => f.status === "open");
  return (
    <div>
      <PageHeader
        title={`${item.name} ${item.version}`}
        description={item.purpose || `A ${item.ecosystem} request.`}
        badges={
          <>
            <DemoBadge show={c.org.demoMode} />
            <Badge tone={SOFTWARE_STATUS[item.status]?.tone ?? "neutral"}>{SOFTWARE_STATUS[item.status]?.label ?? item.status}</Badge>
          </>
        }
      />
      <div className="space-y-4">
        {item.reassessmentNeeded ? <Note tone="danger">New findings arrived after this was {item.status}. The assessment now recommends {item.recommended.replace("_", " ")}. Review the decision.</Note> : null}
        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Assessment" description="Every point is explained. A low score means these checks found no known problem; it does not prove the software is safe." className="xl:col-span-2">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="software-assessment" data-recommended={item.recommended}>
              <span className="text-2xl font-semibold text-fg">{item.riskScore}</span>
              <span className="text-fg-muted">of 100</span>
              <span className="text-fg-muted">Recommended:</span>
              <Badge tone={SOFTWARE_STATUS[item.recommended]?.tone ?? "neutral"}>{SOFTWARE_STATUS[item.recommended]?.label ?? item.recommended}</Badge>
              {item.lastAssessedAt ? (
                <span className="text-xs text-fg-muted">
                  assessed <TimeAgo value={item.lastAssessedAt} />
                </span>
              ) : null}
            </div>
            {factors.length ? (
              <ul className="divide-y divide-line rounded-md border border-line text-sm">
                {factors.map((f) => (
                  <li key={f.factor} className="flex items-start justify-between gap-3 px-3 py-2">
                    <span>
                      <span className="text-fg">{f.factor}</span>
                      <span className="block text-xs text-fg-muted">{f.detail}</span>
                    </span>
                    <span className="font-mono text-fg">+{f.points}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">No risk factors from the checks run so far.</p>
            )}
          </Panel>
          <Panel title="Decision" description={item.decidedAt ? `Last decided ${item.decidedBy ? "by a person" : "automatically"}. ${item.decisionNote}` : "Not decided yet."}>
            <DecisionForm id={item.id} recommended={item.recommended} current={item.status} canDecide={canWrite && !isRequester} reason={isRequester ? "You asked for this software, so someone else decides" : "Needs the security:write permission"} />
          </Panel>
        </div>
        <Panel title="Findings" description={`${open.length} open, ${item.findings.length - open.length} accepted.`} padded={false}>
          {item.findings.length ? (
            <SimpleTable caption="Findings">
              <thead>
                <tr>
                  <Th>Severity</Th>
                  <Th>Finding</Th>
                  <Th>Component</Th>
                  <Th>Source</Th>
                  <Th>Fixed in</Th>
                  <Th align="end">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody data-testid="software-findings">
                {item.findings.map((f) => (
                  <Tr key={f.id}>
                    <Td>
                      <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                    </Td>
                    <Td>
                      <span className="text-fg">{f.title}</span> <span className="font-mono text-xs text-fg-muted">{f.ref}</span>
                      {f.status === "accepted" ? <span className="block text-xs text-fg-muted">Accepted: {f.note}</span> : null}
                    </Td>
                    <Td mono>{f.component}</Td>
                    <Td>{f.source}</Td>
                    <Td mono>{f.fixedIn ?? "-"}</Td>
                    <Td align="end">{f.status === "open" ? <AcceptFindingButton id={f.id} itemId={item.id} canWrite={canWrite} /> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          ) : (
            <EmptyState title="No findings" description="Attach an SBOM or a scanner report to run the checks." />
          )}
        </Panel>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Attach an SBOM or a scanner report">
            <AttachEvidenceForm id={item.id} canWrite={canWrite} />
          </Panel>
          <Panel title="Evidence" padded={false}>
            {evidence.length ? (
              <ul className="divide-y divide-line text-sm">
                {evidence.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="font-mono text-xs">{e.format}</span>
                    <span className="text-xs text-fg-muted">{Object.entries(e.summary as Record<string, unknown>).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${k} ${String(v)}`).join(", ")}</span>
                    <TimeAgo value={e.createdAt} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No evidence yet" description="Generate an SBOM with Syft or Trivy, or attach the npm lockfile." />
            )}
          </Panel>
        </div>
        <Panel title="Components" description={`${components.length} components${components.length === 500 ? " (first 500 shown)" : ""}.`} padded={false}>
          {components.length ? (
            <SimpleTable caption="Components">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Version</Th>
                  <Th>Licenses</Th>
                  <Th>Source</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {components.map((p) => (
                  <Tr key={p.id}>
                    <Td mono>
                      {p.name}
                      {p.direct ? <span className="ms-1 text-xs text-fg-muted">(direct)</span> : null}
                    </Td>
                    <Td mono>{p.version}</Td>
                    <Td mono>{p.licenses.join(", ") || "-"}</Td>
                    <Td mono>{p.resolvedHost ?? "-"}</Td>
                    <Td>
                      <span className="text-xs text-fg-muted">{[p.hasInstallScript ? "install script" : null, p.hasIntegrity === false ? "no integrity hash" : null].filter(Boolean).join(", ")}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          ) : (
            <EmptyState title="No components" description="No SBOM or lockfile attached yet, so the dependencies are unknown." />
          )}
        </Panel>
      </div>
    </div>
  );
}
