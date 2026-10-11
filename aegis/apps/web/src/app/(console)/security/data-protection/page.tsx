import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listDataClasses } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { toolPicks } from "@/server/queries/shield";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { DataClassesTable, type DataClassRow } from "@/components/shield/data-classes-table";
import { CreateDataClassDialog } from "@/components/shield/create-data-class-dialog";
import { SampleTestPanel } from "@/components/shield/sample-test-panel";
import { InjectionPanel } from "@/components/shield/injection-panel";
import { SecurityEvalPanel } from "@/components/shield/security-eval-panel";

export const metadata: Metadata = { title: "Data Protection" };
export const dynamic = "force-dynamic";

export default async function DataProtectionPage() {
  const c = await requirePermission("security:read");
  const canWrite = c.can("security:write");
  const { classes, tools } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [classes, tools] = await Promise.all([listDataClasses(db, c.ctx), toolPicks(db, c.ctx.orgId)]);
      return { classes, tools };
    },
    { readOnly: true },
  );
  const rows: DataClassRow[] = classes.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, detector: r.detector, pattern: r.pattern, patternValid: r.patternValid, action: r.action, severity: r.severity, enabled: r.enabled, isSystem: r.isSystem }));
  const enabled = rows.filter((r) => r.enabled).length;
  return (
    <div>
      <PageHeader title="Data Protection" description="What Shield looks for in tool parameters before policy evaluation, and what it does when it finds it. Changes apply to the next request." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateDataClassDialog canWrite={canWrite} />} />
      <div className="space-y-4">
        <Panel title="Data classes" description={`${enabled} of ${rows.length} classes enabled. System classes can be tuned but not removed. Addressing fields (to, destination, url) are classified but never rewritten; destination allowlists govern them.`} padded={false}>
          <DataClassesTable rows={rows} canWrite={canWrite} />
        </Panel>
        {!canWrite ? <Note>You can view the configuration. Changing actions, severities or classes requires security:write.</Note> : null}
        <div className="grid gap-4 xl:grid-cols-2">
          <SampleTestPanel tools={tools.map((t) => ({ key: t.key, name: t.name }))} />
          <InjectionPanel />
        </div>
        <SecurityEvalPanel />
      </div>
    </div>
  );
}
