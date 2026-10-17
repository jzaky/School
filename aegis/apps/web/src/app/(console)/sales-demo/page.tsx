import type { Metadata } from "next";
import { findSalesDemo, SALES_DEMO_NOTICE, SALES_SCENARIOS } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { Panel } from "@/components/ui/panel";
import { SalesDemoSetup, SalesScenarios } from "@/components/commercial/sales-demo";

export const metadata: Metadata = { title: "Sales demonstration" };
export const dynamic = "force-dynamic";

export default async function SalesDemoPage() {
  const c = await requirePermission("gateway:read");
  const isSalesOrg = c.org.demoMode && (c.org.settings as { salesDemo?: boolean }).salesDemo === true;
  if (isSalesOrg) {
    return (
      <div>
        <PageHeader title="Sales demonstration" description="Six scenarios, each run through the real gateway, policy engine and the uncertainty, reasoning and autonomy engines. Every step links to the full record AEGIS kept." badges={<DemoBadge show />} />
        <Note tone="warning" className="mb-4">
          {SALES_DEMO_NOTICE} An allowed action returns a one-time permission slip and stops there. None of these scenarios is a verified live integration.
        </Note>
        <SalesScenarios scenarios={SALES_SCENARIOS.map((s) => ({ ...s }))} canRun={c.can("gateway:read")} />
      </div>
    );
  }
  const existing = await findSalesDemo(c.session.user.id);
  const allowed = c.org.demoMode || c.session.user.isPlatformAdmin;
  return (
    <div>
      <PageHeader title="Sales demonstration" description="A separate synthetic organization with six ready scenarios: finance, healthcare, enterprise IT, uncertainty, managed autonomy and reasoning governance." badges={<DemoBadge show={c.org.demoMode} />} />
      <Panel title={existing ? "Your sales demonstration is ready" : "Create a sales demonstration"} description="It belongs to you, holds only synthetic data, and never mixes with this organization's records">
        <ul className="mb-4 list-disc space-y-1 ps-5 text-sm text-fg-muted">
          {SALES_SCENARIOS.map((s) => (
            <li key={s.key}>{s.title}</li>
          ))}
        </ul>
        <SalesDemoSetup exists={!!existing} allowed={allowed} reason="Create it from a demo organization, or ask a platform administrator" />
      </Panel>
    </div>
  );
}
