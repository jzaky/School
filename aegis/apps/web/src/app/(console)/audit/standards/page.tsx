import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { listFrameworks } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { CreateFrameworkDialog } from "@/components/audit/create-framework-dialog";

export const metadata: Metadata = { title: "Standards" };
export const dynamic = "force-dynamic";

export default async function StandardsPage() {
  const c = await requirePermission("audit:read");
  const frameworks = await withTenant(c.ctx.orgId, (db) => listFrameworks(db, c.ctx), { readOnly: true });
  return (
    <div>
      <PageHeader title="Standards" description="Frameworks the assessment engine can evaluate documents against. The shared catalog is read-only; custom frameworks belong to this organization." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateFrameworkDialog canWrite={c.can("audit:write")} />} />
      <Note className="mb-4">ISO standards are copyrighted. The catalog reproduces control identifiers with original one-sentence summaries only; the standard text itself is not included. Obtain the standards from ISO or a national member body.</Note>
      <SimpleTable caption="Frameworks">
        <thead>
          <tr>
            <Th>Framework</Th>
            <Th>Version</Th>
            <Th>Publisher</Th>
            <Th>Origin</Th>
            <Th align="end">Controls</Th>
            <Th align="end">Completed assessments</Th>
            <Th>License note</Th>
          </tr>
        </thead>
        <tbody>
          {frameworks.map((f) => (
            <Tr key={f.id}>
              <Td className="max-w-[320px]">
                <Link href={`/audit/standards/${f.id}`} className="block truncate font-medium text-accent hover:underline">
                  {f.name}
                </Link>
                <span className="block truncate font-mono text-[11px] text-fg-dim">{f.key}</span>
              </Td>
              <Td mono>{f.version || <span className="text-fg-dim">none</span>}</Td>
              <Td>{f.publisher || <span className="text-fg-dim">none</span>}</Td>
              <Td>{f.shared ? <Badge tone="info">Shared catalog</Badge> : <Badge tone="neutral">Custom</Badge>}</Td>
              <Td align="end">{f.controlCount}</Td>
              <Td align="end">{f.completedAssessments}</Td>
              <Td className="max-w-[420px] truncate text-xs text-fg-muted" title={f.licenseNote}>
                {f.licenseNote || <span className="text-fg-dim">none</span>}
              </Td>
            </Tr>
          ))}
          {frameworks.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-xs text-fg-dim">
                No frameworks available.
              </td>
            </tr>
          ) : null}
        </tbody>
      </SimpleTable>
    </div>
  );
}
