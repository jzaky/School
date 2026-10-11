import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { rawPrisma } from "@aegis/db";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrganizationSettingsForm } from "@/components/org/settings-form";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const c = await requirePermission("org:read");
  const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: c.org.id } });
  const sso = await withTenant(c.ctx.orgId, (db) => db.ssoConnection.findFirst({ where: { orgId: c.ctx.orgId }, select: { enabled: true, issuer: true } }));
  const s = c.org.settings;
  const canAdmin = c.can("org:admin");
  return (
    <div>
      <PageHeader title="Settings" description="Organization identity, defaults and sign-in configuration." badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Organization" description="Editable with org:admin" className="lg:col-span-2">
          <OrganizationSettingsForm canAdmin={canAdmin} initial={{ name: org.name, currency: typeof s.currency === "string" ? s.currency : "AED", timezone: typeof s.timezone === "string" ? s.timezone : "Asia/Dubai", approvalDefaultExpiryMinutes: typeof s.approvalDefaultExpiryMinutes === "number" ? s.approvalDefaultExpiryMinutes : 240 }} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Identity">
            <KeyValue
              items={[
                { label: "Slug", value: org.slug, mono: true },
                { label: "Plan", value: <Badge tone="info">{org.plan.replace(/_/g, " ")}</Badge> },
                { label: "Demo mode", value: org.demoMode ? <Badge tone="approval">On: synthetic data</Badge> : <Badge>Off</Badge> },
                { label: "Created", value: formatDateTime(org.createdAt) },
                { label: "Organization id", value: org.id, mono: true },
              ]}
            />
          </Panel>
          <Panel title="Single sign-on" description="OIDC or SAML for your identity provider">
            <KeyValue items={[{ label: "Status", value: sso?.enabled ? <Badge tone="allow">Enabled</Badge> : <Badge>Not configured</Badge> }, { label: "Issuer", value: sso?.issuer ?? null, mono: true }]} />
            <div className="mt-3">
              <Button disabled disabledReason="Enterprise SSO arrives in the Enterprise Readiness release">
                Configure SSO
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
