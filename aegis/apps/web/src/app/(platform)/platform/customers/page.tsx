import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, platformCustomerOverview } from "@aegis/core";
import { requirePlatformAdmin } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

function trend(a: number, b: number) {
  return a > b ? `up from ${b}` : a < b ? `down from ${b}` : "unchanged";
}

export default async function CustomersPage() {
  const s = await requirePlatformAdmin();
  const rows = await platformCustomerOverview(s.user.id);
  return (
    <div>
      <PageHeader title="Customers" description="Customer success across every organization, computed from each one's own records over the last 30 days (Attack Simulation Lab traffic excluded). Opening this page is recorded as a platform event." badges={<Badge tone="info">Platform admin</Badge>} />
      <SimpleTable caption="Customer health">
        <thead>
          <tr>
            <Th>Organization</Th>
            <Th>Plan</Th>
            <Th>Setup</Th>
            <Th>Integrations</Th>
            <Th>Policies enforced</Th>
            <Th>Agents acting</Th>
            <Th align="end">Decisions (refused)</Th>
            <Th>Incidents</Th>
            <Th>Support</Th>
          </tr>
        </thead>
        <tbody data-testid="customer-rows">
          {rows.map((r) => (
            <Tr key={r.orgId} data-org={r.slug}>
              <Td>
                <Link href={`/platform/customers/${r.orgId}`} className="font-medium text-accent hover:underline">
                  {r.name}
                </Link>
                {r.demoMode ? <Badge tone="approval" className="ms-1.5">Demo</Badge> : null}
              </Td>
              <Td>
                {PLANS[r.plan].name}
                {r.trial.state === "active" || r.trial.state === "ending_soon" ? <span className="block text-xs text-fg-dim">{r.trial.daysLeft} trial days left</span> : r.trial.state === "ended" ? <span className="block text-xs text-approval">trial ended</span> : null}
              </Td>
              <Td className="tabular">
                {r.onboarding.done}/{r.onboarding.total}
              </Td>
              <Td>{r.integrations.failing ? <Badge tone="deny">{r.integrations.failing} failing</Badge> : <span className="tabular">{r.integrations.active} active</span>}</Td>
              <Td className="tabular">
                {r.policyCoverage.enforced}/{r.policyCoverage.total}
              </Td>
              <Td className="tabular">
                {r.agentAdoption.acting}/{r.agentAdoption.active}
              </Td>
              <Td align="end">
                {r.enforcement.decisions.toLocaleString("en-GB")} ({r.enforcement.refused.toLocaleString("en-GB")})
              </Td>
              <Td className="text-xs">
                {r.incidents.last30}, {trend(r.incidents.last30, r.incidents.previous30)}
              </Td>
              <Td>{r.support.urgent ? <Badge tone="deny">{r.support.urgent} urgent</Badge> : r.support.open ? <Badge tone="approval">{r.support.open} open</Badge> : <span className="text-fg-dim">none</span>}</Td>
            </Tr>
          ))}
        </tbody>
      </SimpleTable>
    </div>
  );
}
