import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { aiGatewayStats, env, listAiGatewayEvents, listAiProviders, listPersonalAiKeys } from "@aegis/core";
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
import { AddProviderButton, AiGatewayModeControl, AiPreviewPanel, PersonalKeyPanel, ProviderApprovalButton } from "@/components/secure/ai-gateway";
import { DECISION_LABEL, decisionTone } from "@/components/secure/format";

export const metadata: Metadata = { title: "AI Gateway" };
export const dynamic = "force-dynamic";

type ClassCount = { dataClass: string; count: number };

export default async function AiGatewayPage() {
  const c = await requirePermission("security:read");
  const { providers, events, stats, keys } = await withTenant(
    c.ctx.orgId,
    async (db) => {
      const [providers, events, stats, keys] = await Promise.all([c.can("integrations:read") ? listAiProviders(db, c.ctx) : Promise.resolve([]), listAiGatewayEvents(db, c.ctx, { limit: 50 }), aiGatewayStats(db, c.ctx), listPersonalAiKeys(db, c.ctx)]);
      return { providers, events, stats, keys };
    },
    { readOnly: true },
  );
  const models = providers.filter((p) => p.approved).flatMap((p) => p.settings.models);
  return (
    <div>
      <PageHeader
        title="AI Gateway"
        description="People and internal applications send their AI chat requests to AEGIS instead of straight to the provider. AEGIS looks for sensitive data on this server, applies your AI usage policy and then forwards, redacts or blocks. It only sees requests sent through it; AI used directly in a browser or a personal account is not visible here."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={<AddProviderButton canWrite={c.can("integrations:write")} />}
      />
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="ai-gateway-stats">
          <StatPanel label="Requests, 30 days" value={stats.total} />
          <StatPanel label="Allowed unchanged" value={stats.allow} tone="allow" />
          <StatPanel label="Sent with values removed" value={stats.redact} tone="info" />
          <StatPanel label="Blocked, not sent" value={stats.blocked} tone="deny" hint={stats.monitored ? `${stats.monitored} more would have been blocked but were sent in monitor mode` : `${stats.notForwarded} requests never reached a provider`} />
        </div>

        <Panel title="Enforcement" description="Enforce blocks what the policy blocks. Monitor records every decision but still sends requests the policy would block, so you can see the effect before you enforce it. Records always say whether a request was actually blocked.">
          <AiGatewayModeControl mode={stats.mode} canWrite={c.can("security:write")} />
        </Panel>

        <Panel title="Approved providers" description="Only models listed here are forwarded. A model nobody approved is refused and recorded, which shows you what people are asking for." padded={false}>
          {providers.length ? (
            <SimpleTable caption="Approved providers">
              <thead>
                <tr>
                  <Th>Provider</Th>
                  <Th>Models</Th>
                  <Th>Key in vault</Th>
                  <Th>Declared region</Th>
                  <Th>Status</Th>
                  <Th align="end">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <span className="text-fg">{p.name}</span> <span className="font-mono text-xs text-fg-muted">{p.key}</span>
                    </Td>
                    <Td mono>{p.settings.models.join(", ")}</Td>
                    <Td>{p.credential === "stored" ? <Badge tone="allow">Stored</Badge> : <Badge tone="approval">{p.credential === "revoked" ? "Revoked" : "Missing"}</Badge>}</Td>
                    <Td>{p.settings.declaredRegion ? <span title="Stated by an administrator; not verified by AEGIS">{p.settings.declaredRegion} (stated)</span> : <span className="text-fg-dim">Not stated</span>}</Td>
                    <Td>{p.approved ? <Badge tone="allow">Approved</Badge> : <Badge tone="deny">Blocked</Badge>}</Td>
                    <Td align="end">
                      <ProviderApprovalButton id={p.id} approved={p.approved} canAct={p.approved ? c.can("agents:control") : c.can("integrations:write")} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          ) : (
            <EmptyState title="No provider approved yet" description={c.can("integrations:read") ? "Add the OpenAI-compatible endpoint your organization has a contract with. Until then every request is refused." : "You need the integrations:read permission to see providers."} />
          )}
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Check a prompt" description="Runs data protection and your AI usage policy on this text. Nothing is sent and nothing is recorded.">
            <AiPreviewPanel models={models} />
          </Panel>
          <Panel title="Your personal key" description="Point any OpenAI-compatible tool at AEGIS with this key. Requests are recorded against you.">
            <PersonalKeyPanel apiBase={env().API_PUBLIC_URL} keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, expiresAt: k.expiresAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, lastUsedAt: k.lastUsedAt?.toISOString() ?? null }))} />
          </Panel>
        </div>

        <Panel title="Recent requests" description="AEGIS keeps no prompt or answer text: only a keyed fingerprint, the size, the kinds of data found and what happened. Sent means the provider answered; a blocked request was never sent." padded={false}>
          {events.length ? (
            <SimpleTable caption="Recent AI gateway requests">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>From</Th>
                  <Th>Model</Th>
                  <Th>Decision</Th>
                  <Th>Sent to provider</Th>
                  <Th>Data found</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody data-testid="ai-gateway-events">
                {events.map((e) => {
                  const found = (e.promptClasses as ClassCount[]).map((x) => `${x.dataClass} (${x.count})`).join(", ");
                  return (
                    <Tr key={e.id}>
                      <Td>
                        <TimeAgo value={e.createdAt} />
                      </Td>
                      <Td>{e.principalType === "user" ? "Person" : e.claimedUser ? "Application (names a person)" : "Application"}</Td>
                      <Td mono>{e.providerKey ? `${e.providerKey} / ${e.model}` : e.model}</Td>
                      <Td>
                        {e.decision === "block" && e.forwarded ? <Badge tone="approval">Would block (monitor mode)</Badge> : <Badge tone={decisionTone(e.decision)}>{DECISION_LABEL[e.decision] ?? e.decision}</Badge>}
                        {e.responseWithheld ? <Badge tone="approval" className="ms-1">Answer withheld</Badge> : null}
                      </Td>
                      <Td>{e.forwarded ? "Sent" : e.status === "pending" ? "In progress" : "Not sent"}</Td>
                      <Td mono>{found || <span className="text-fg-dim">None</span>}</Td>
                      <Td>
                        <span dir="auto" className="line-clamp-2 text-xs text-fg-muted">
                          {(e.reasons as string[]).join(". ")}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SimpleTable>
          ) : (
            <EmptyState title="No requests yet" description="Requests appear here as soon as someone uses a key with the AI gateway." />
          )}
        </Panel>
        <Note>What this does not cover: AI sites used directly in a browser, personal accounts, and desktop apps that do not use AEGIS as their endpoint. For those, see Shadow AI discovery, which reports what it observes and never claims to block it.</Note>
      </div>
    </div>
  );
}
