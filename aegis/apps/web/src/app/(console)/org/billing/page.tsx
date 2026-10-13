import type { Metadata } from "next";
import { rawPrisma, withTenant } from "@aegis/db";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { StatPanel } from "@/components/ui/stat-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EnterprisePricingForm } from "@/components/org/billing-form";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const c = await requirePermission("org:read");
  const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: c.org.id }, select: { plan: true } });
  const [members, agents] = await withTenant(c.ctx.orgId, (db) => Promise.all([db.membership.count({ where: { orgId: c.ctx.orgId, status: "active" } }), db.agent.count({ where: { isLab: false, orgId: c.ctx.orgId, status: { not: "archived" } } })]));
  return (
    <div>
      <PageHeader title="Billing" description="Plan, usage and commercial contact." badges={<DemoBadge show={c.org.demoMode} />} actions={<Button disabled disabledReason="There is no billing provider connected in this deployment, so there is no portal to open">Manage billing portal</Button>} />
      <div className="grid gap-3 md:grid-cols-3">
        <StatPanel label="Plan" value={<Badge tone="info" className="text-sm">{org.plan.replace(/_/g, " ")}</Badge>} footer="Usage based pricing is not enforced in this deployment" />
        <StatPanel label="Active members" value={members} />
        <StatPanel label="Registered agents" value={agents} footer="Excludes archived" />
      </div>
      <Panel title="Request enterprise pricing" description="Your request is recorded as a platform event. Only the details you type are stored." className="mt-4">
        <EnterprisePricingForm defaultName={c.session.user.name} defaultEmail={c.session.user.email} />
      </Panel>
    </div>
  );
}
