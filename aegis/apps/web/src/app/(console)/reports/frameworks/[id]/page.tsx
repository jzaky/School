import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { complianceControlsForFramework } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { statusLabel } from "@/lib/status";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Framework ${id.slice(0, 8)}` };
}

const SOURCE_TONE: Record<string, "allow" | "info" | "neutral" | "approval"> = { automated: "allow", customer_document: "info", human_validated: "neutral", missing: "approval" };

export default async function FrameworkPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("reports:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const data = await withTenant(c.ctx.orgId, async (db) => {
    const framework = await db.framework.findFirst({ where: { id, OR: [{ orgId: null }, { orgId: c.ctx.orgId }] } });
    if (!framework) return null;
    const controls = await complianceControlsForFramework(db, c.ctx, id);
    return { framework, controls };
  });
  if (!data) notFound();
  const { framework, controls } = data;
  const counts = { automated: 0, customer_document: 0, human_validated: 0, missing: 0 };
  for (const ctl of controls) {
    const s = ctl.mapping?.source ?? "missing";
    counts[s as keyof typeof counts] += 1;
  }
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Governance Reports", href: "/reports" }, { label: framework.name }]}
        title={framework.name}
        badges={
          <>
            <Badge mono>
              {framework.key} {framework.version}
            </Badge>
            {framework.isCustom ? <Badge tone="info">custom</Badge> : null}
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={
          <>
            {framework.description || null}
            {framework.publisher ? <span className="block text-xs text-fg-dim">Publisher: {framework.publisher}</span> : null}
            {framework.licenseNote ? <span className="block text-xs text-fg-dim">{framework.licenseNote}</span> : null}
          </>
        }
      />
      <Note tone="warning" className="mb-4">
        Mapping sources: <strong>Automatically observed</strong> means AEGIS measured the control operating inside this tenant. Customer documents and human validation come from the Audit module. None of this is a statement of compliance with {framework.name}.
      </Note>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => (
          <Badge key={k} tone={SOURCE_TONE[k]}>
            {k === "automated" ? "Automatically observed" : statusLabel(k)} <span className="tabular">{counts[k]}</span>
          </Badge>
        ))}
        <span className="text-fg-dim">{controls.length} controls</span>
      </div>
      <SimpleTable caption={`${framework.name} controls`}>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Title</Th>
            <Th>Category</Th>
            <Th>Mapping source</Th>
            <Th>Status</Th>
            <Th>Notes</Th>
          </tr>
        </thead>
        <tbody>
          {controls.map((ctl) => {
            const source = ctl.mapping?.source ?? "missing";
            return (
              <Tr key={ctl.id}>
                <Td mono>{ctl.code}</Td>
                <Td className="max-w-[320px]">
                  <span className="block truncate font-medium" title={ctl.title}>
                    {ctl.title}
                  </span>
                  {ctl.summary ? (
                    <span className="block truncate text-xs text-fg-muted" title={ctl.summary}>
                      {ctl.summary}
                    </span>
                  ) : null}
                </Td>
                <Td className="text-xs text-fg-muted">{ctl.category}</Td>
                <Td>
                  <Badge tone={SOURCE_TONE[source] ?? "neutral"}>{source === "automated" ? "Automatically observed" : statusLabel(source)}</Badge>
                  {ctl.mapping?.evidenceType ? <span className="ms-2 font-mono text-[11px] text-fg-dim">{ctl.mapping.evidenceType}</span> : null}
                </Td>
                <Td className="text-xs">{statusLabel(ctl.mapping?.status ?? "not_assessed")}</Td>
                <Td className="max-w-[280px] truncate text-xs text-fg-muted" title={ctl.mapping?.notes}>
                  {ctl.mapping?.notes || <span className="text-fg-dim">none</span>}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </SimpleTable>
    </div>
  );
}
