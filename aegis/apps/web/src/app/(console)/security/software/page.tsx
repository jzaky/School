import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { listSoftware, readSoftwareSettings } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { Badge } from "@/components/ui/badge";
import { StatPanel } from "@/components/ui/stat-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { RequestSoftwareButton, SoftwareSettingsForm } from "@/components/secure/software";
import { SOFTWARE_STATUS } from "@/components/secure/format";

export const metadata: Metadata = { title: "Software Security" };
export const dynamic = "force-dynamic";

export default async function SoftwarePage() {
  const c = await requirePermission("org:read");
  const { items, settings } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [items, org] = await Promise.all([listSoftware(db, c.ctx), db.organization.findUniqueOrThrow({ where: { id: c.ctx.orgId }, select: { settings: true } })]);
      return { items, settings: readSoftwareSettings(org.settings) };
    },
    { readOnly: true },
  );
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const flagged = items.filter((i) => i.reassessmentNeeded).length;
  return (
    <div>
      <PageHeader
        title="Software Security"
        description="Requests to use open-source and third-party software. AEGIS reads each request's bill of materials and scanner reports, runs its own checks and explains a risk assessment; a person other than the requester decides. A clean assessment means these checks found no known problem, not that the software is safe."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={<RequestSoftwareButton />}
      />
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatPanel label="Waiting for a decision" value={count("under_review")} tone={count("under_review") ? "approval" : "neutral"} />
          <StatPanel label="Approved or restricted" value={count("approved") + count("restricted")} tone="allow" />
          <StatPanel label="Quarantined or prohibited" value={count("quarantined") + count("prohibited")} tone="deny" />
          <StatPanel label="Need reassessment" value={flagged} tone={flagged ? "critical" : "neutral"} hint="Decided, but new findings make the assessment stricter" />
        </div>
        <Panel title="Requests" padded={false}>
          {items.length ? (
            <SimpleTable caption="Software requests">
              <thead>
                <tr>
                  <Th>Software</Th>
                  <Th>Decision</Th>
                  <Th>Recommended</Th>
                  <Th align="end">Risk</Th>
                  <Th align="end">Components</Th>
                  <Th align="end">Open findings</Th>
                  <Th>Assessed</Th>
                </tr>
              </thead>
              <tbody data-testid="software-list">
                {items.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link href={`/security/software/${i.id}`} className="text-accent hover:underline">
                        {i.name}
                      </Link>{" "}
                      <span className="font-mono text-xs text-fg-muted">
                        {i.ecosystem} {i.version}
                      </span>
                      {i.reassessmentNeeded ? (
                        <Badge tone="critical" className="ms-1">
                          Reassess
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={SOFTWARE_STATUS[i.status]?.tone ?? "neutral"}>{SOFTWARE_STATUS[i.status]?.label ?? i.status}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={SOFTWARE_STATUS[i.recommended]?.tone ?? "neutral"}>{SOFTWARE_STATUS[i.recommended]?.label ?? i.recommended}</Badge>
                    </Td>
                    <Td align="end">{i.riskScore}</Td>
                    <Td align="end">{i._count.components}</Td>
                    <Td align="end">{i._count.findings}</Td>
                    <Td>{i.lastAssessedAt ? <TimeAgo value={i.lastAssessedAt} /> : "-"}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          ) : (
            <EmptyState title="No software requests yet" description="Anyone can ask to use a package or application with Request software." />
          )}
        </Panel>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Checks and settings" description="Applied to every assessment. Your organization's software policies (category Software use) are evaluated by the same policy engine as everything else, and can only make a recommendation stricter.">
            <SoftwareSettingsForm initial={{ internalPrefixes: settings.internalPrefixes, internalHosts: settings.internalHosts, osvLookup: settings.osvLookup, autoApprove: settings.autoApprove }} canWrite={c.can("security:write")} />
          </Panel>
          <Note>
            What AEGIS checks itself: typosquatting against a short list of popular npm and PyPI packages, dependency confusion against your internal prefixes, install scripts, missing integrity hashes, and licenses against your license policy. Vulnerabilities, secrets and maintenance come from the scanner reports you attach (Grype, Trivy, Gitleaks, OpenSSF Scorecard) and, if you turn it on, OSV.dev. AEGIS does not run code, does not detect malicious behaviour by itself, and does not verify signatures yet.
          </Note>
        </div>
      </div>
    </div>
  );
}
