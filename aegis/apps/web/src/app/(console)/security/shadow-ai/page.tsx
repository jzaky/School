import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listDiscoveryImports, listShadowAiApps, shadowAiCoverage } from "@aegis/core";
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
import { AddCustomAppButton, ImportLogForm, ReviewAppButton } from "@/components/secure/shadow-ai";

export const metadata: Metadata = { title: "Shadow AI" };
export const dynamic = "force-dynamic";

const CONFIDENCE: Record<string, { label: string; tone: "allow" | "info" | "neutral"; help: string }> = {
  confirmed: { label: "Confirmed", tone: "allow", help: "An authenticated sign-in to the app" },
  observed: { label: "Observed", tone: "info", help: "A managed browser, endpoint sensor, proxy or CASB saw it in use" },
  inferred: { label: "Inferred", tone: "neutral", help: "DNS, network metadata or an inventory suggests use" },
};
const STATUS: Record<string, { label: string; tone: "allow" | "approval" | "deny" | "neutral" }> = {
  approved: { label: "Approved", tone: "allow" },
  tolerated: { label: "Tolerated", tone: "approval" },
  unapproved: { label: "Unapproved", tone: "deny" },
  unreviewed: { label: "Not reviewed", tone: "neutral" },
};

export default async function ShadowAiPage() {
  const c = await requirePermission("security:read");
  const canWrite = c.can("security:write");
  const { apps, coverage, imports } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [apps, coverage, imports] = await Promise.all([listShadowAiApps(db, c.ctx), shadowAiCoverage(db, c.ctx), listDiscoveryImports(db, c.ctx)]);
      return { apps, coverage, imports };
    },
    { readOnly: true },
  );
  const seen = apps.filter((a) => a.signals > 0);
  const violations = seen.filter((a) => a.finding === "violation");
  const toReview = seen.filter((a) => a.finding === "review");
  const hints = imports.flatMap((i) => (i.unmatchedTop as { name: string; count: number }[]) ?? []).slice(0, 10);
  return (
    <div>
      <PageHeader
        title="Shadow AI"
        description="Which AI apps people use, found in logs your organization already has: sign-ins, DNS, managed browsers, endpoints, proxies and SaaS inventories. Only AI matches are kept; everything else in a log is discarded on read. These sources show that an app was used, never what was typed into it, and discovery does not block anything."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={<AddCustomAppButton canWrite={canWrite} />}
      />
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatPanel label="AI apps seen, 30 days" value={seen.length} />
          <StatPanel label="Unapproved apps in use" value={violations.length} tone={violations.length ? "deny" : "neutral"} />
          <StatPanel label="Seen but not reviewed" value={toReview.length} tone={toReview.length ? "approval" : "neutral"} />
          <StatPanel label="Kinds of source connected" value={`${coverage.typesConnected} of ${coverage.typesTotal}`} hint={coverage.people ? `${coverage.people.seen} of ${coverage.people.total} members seen in sign-in logs` : "No identity-provider logs yet"} />
        </div>

        <Panel title="Coverage" description={coverage.statement} padded={false}>
          <SimpleTable caption="Discovery sources">
            <thead>
              <tr>
                <Th>Source</Th>
                <Th>Confidence</Th>
                <Th>Sees</Th>
                <Th>Does not see</Th>
                <Th>Last import</Th>
              </tr>
            </thead>
            <tbody data-testid="coverage-sources">
              {coverage.sources.map((s) => (
                <Tr key={s.key}>
                  <Td>
                    <span className="text-fg">{s.label}</span>
                    {s.connected ? null : <span className="ms-1 text-xs text-fg-dim">(not connected)</span>}
                  </Td>
                  <Td>
                    <Badge tone={CONFIDENCE[s.confidence]!.tone}>{CONFIDENCE[s.confidence]!.label}</Badge>
                  </Td>
                  <Td>
                    <span className="text-xs text-fg-muted">{s.sees}</span>
                  </Td>
                  <Td>
                    <span className="text-xs text-fg-muted">{s.misses}</span>
                  </Td>
                  <Td>{s.lastImportAt ? <TimeAgo value={s.lastImportAt} /> : <span className="text-fg-dim">Never</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        </Panel>

        <Panel title="AI applications" description="Known AI apps and the ones you added. Confidence is the strongest evidence seen in the last 30 days. People counts members by account and others by a keyed fingerprint; AEGIS stores no email address for people who are not members." padded={false}>
          <SimpleTable caption="AI applications">
            <thead>
              <tr>
                <Th>App</Th>
                <Th>Your decision</Th>
                <Th>Evidence</Th>
                <Th align="end">People</Th>
                <Th align="end">Devices</Th>
                <Th>Sources</Th>
                <Th>Last seen</Th>
                <Th align="end">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody data-testid="shadow-apps">
              {apps.map((a) => (
                <Tr key={a.key}>
                  <Td>
                    <span className="text-fg">{a.name}</span> <span className="text-xs text-fg-muted">{a.vendor}</span>
                    {a.finding === "violation" ? (
                      <Badge tone="deny" className="ms-1">
                        Policy violation
                      </Badge>
                    ) : a.finding === "review" ? (
                      <Badge tone="approval" className="ms-1">
                        Needs review
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={STATUS[a.status]?.tone ?? "neutral"}>{STATUS[a.status]?.label ?? a.status}</Badge>
                  </Td>
                  <Td>{a.bestConfidence ? <span title={CONFIDENCE[a.bestConfidence]!.help}><Badge tone={CONFIDENCE[a.bestConfidence]!.tone}>{CONFIDENCE[a.bestConfidence]!.label}</Badge></span> : <span className="text-fg-dim">Not seen</span>}</Td>
                  <Td align="end">{a.people || "-"}</Td>
                  <Td align="end">{a.devices || "-"}</Td>
                  <Td mono>{a.sources.join(", ") || "-"}</Td>
                  <Td>{a.lastSeen ? <TimeAgo value={a.lastSeen} /> : "-"}</Td>
                  <Td align="end">
                    <ReviewAppButton app={{ key: a.key, name: a.name, status: a.status, note: a.note, controls: a.controls }} canWrite={canWrite} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Import a log export" description="Exports you are authorized to share. Log forwarders can post the same formats to the API with an integration key that has the discovery:report scope.">
            <ImportLogForm canWrite={canWrite} />
          </Panel>
          <Panel title="Recent imports" padded={false}>
            {imports.length ? (
              <SimpleTable caption="Recent imports">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Source</Th>
                    <Th align="end">Read</Th>
                    <Th align="end">AI matches</Th>
                    <Th align="end">Discarded</Th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((i) => (
                    <Tr key={i.id}>
                      <Td>
                        <TimeAgo value={i.createdAt} />
                      </Td>
                      <Td>{i.label || i.source}</Td>
                      <Td align="end">{i.received}</Td>
                      <Td align="end">{i.matched}</Td>
                      <Td align="end">{i.unmatched + i.rejected}</Td>
                    </Tr>
                  ))}
                </tbody>
              </SimpleTable>
            ) : (
              <EmptyState title="No imports yet" description="Start with an identity-provider sign-in export: it gives confirmed evidence tied to work accounts." />
            )}
          </Panel>
        </div>
        {hints.length ? <Note>Apps in sign-in and inventory logs that AEGIS did not recognize as AI: {hints.map((h) => `${h.name} (${h.count})`).join(", ")}. Add any that are AI tools with Add app.</Note> : null}
      </div>
    </div>
  );
}
