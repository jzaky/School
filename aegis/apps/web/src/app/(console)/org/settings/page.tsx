import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { rawPrisma } from "@aegis/db";
import { DEFAULT_AUTO_RESPONSES, computeOnboarding, listMonitoringRules, readContinuousGovernance, responseOptionsForRule, summarizeOnboarding } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrganizationSettingsForm } from "@/components/org/settings-form";
import { GatewayPauseControl } from "@/components/org/pilot-setup";
import { ContinuousGovernancePanel } from "@/components/org/continuous-governance";
import { OnboardingProgress } from "@/components/onboarding/checklist";
import { OnboardingDismissButton } from "@/components/onboarding/dismiss-button";
import { LinkButton } from "@/components/ui/link-button";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const c = await requirePermission("org:read");
  const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: c.org.id } });
  const { sso, steps, rules } = await withTenant(c.ctx.orgId, async (db) => ({ sso: await db.ssoConnection.findFirst({ where: { orgId: c.ctx.orgId }, select: { enabled: true, issuer: true } }), steps: await computeOnboarding(db, c.ctx), rules: await listMonitoringRules(db, c.ctx) }), { readOnly: true });
  const s = c.org.settings;
  const canAdmin = c.can("org:admin");
  const onboarding = summarizeOnboarding(steps, s);
  const gw = s as { gatewayPaused?: boolean; gatewayPausedReason?: string; gatewayPausedBy?: string };
  const governance = readContinuousGovernance(s);
  const governanceRules = rules.filter((r) => r.enabled).map((r) => ({ key: r.key, name: r.name, description: r.description, severity: r.severity, options: responseOptionsForRule(r.key) }));
  return (
    <div>
      <PageHeader title="Settings" description="Pilot setup, the emergency stop, your organization's identity and defaults, and how people sign in." badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Pilot setup" description="How far this organization is through the guided setup" data-testid="pilot-setup" actions={<OnboardingDismissButton dismissed={!!onboarding.dismissedAt} canAdmin={canAdmin} />}>
          <OnboardingProgress summary={onboarding} />
          <p className="mt-2 text-xs text-fg-muted">{onboarding.complete ? "Every step is done." : onboarding.next ? `Next: ${onboarding.next.title}.` : ""} {onboarding.dismissedAt ? `The checklist is hidden from the sidebar and Overview (since ${formatDateTime(onboarding.dismissedAt)}).` : "The checklist shows in the sidebar and on the Overview until every step is done or it is hidden."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href="/getting-started" size="sm">
              Open the checklist
            </LinkButton>
            {onboarding.next ? (
              <LinkButton href={onboarding.next.href} size="sm" variant="primary">
                {onboarding.next.title}
              </LinkButton>
            ) : null}
          </div>
        </Panel>
        <Panel title="Emergency gateway pause" description="Stops every agent at once. The pause and the resume are both written to the record.">
          <GatewayPauseControl paused={!!gw.gatewayPaused} reason={gw.gatewayPausedReason ?? null} by={gw.gatewayPausedBy ?? null} canAdmin={canAdmin} />
        </Panel>
      </div>
      <Panel title="Continuous governance" description="Optional: let AEGIS act on monitoring alerts by itself, using the response you choose for each rule" className="mb-4">
        <ContinuousGovernancePanel initial={governance} rules={governanceRules} defaults={DEFAULT_AUTO_RESPONSES} canAdmin={canAdmin} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Organization" description="Only people with the org:admin permission can change these" className="lg:col-span-2">
          <OrganizationSettingsForm canAdmin={canAdmin} initial={{ name: org.name, currency: typeof s.currency === "string" ? s.currency : "AED", timezone: typeof s.timezone === "string" ? s.timezone : "Asia/Dubai", approvalDefaultExpiryMinutes: typeof s.approvalDefaultExpiryMinutes === "number" ? s.approvalDefaultExpiryMinutes : 240 }} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Identity">
            <KeyValue
              items={[
                { label: "Slug", value: org.slug, mono: true },
                { label: "Plan", value: <Badge tone="info">{org.plan.replace(/_/g, " ")}</Badge> },
                { label: "Demo mode", value: org.demoMode ? <Badge tone="approval">On: made-up demo data</Badge> : <Badge>Off</Badge> },
                { label: "Created", value: formatDateTime(org.createdAt) },
                { label: "Organization id", value: org.id, mono: true },
              ]}
            />
          </Panel>
          <Panel title="Single sign-on" description="Sign in through your company identity provider (OIDC or SAML)">
            <KeyValue items={[{ label: "Status", value: sso?.enabled ? <Badge tone="allow">Enabled</Badge> : <Badge>Not configured</Badge> }, { label: "Issuer", value: sso?.issuer ?? null, mono: true }]} />
            <div className="mt-3">
              <Button disabled disabledReason="Single sign-on is not available yet; it arrives in the Enterprise Readiness release">
                Configure SSO
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
