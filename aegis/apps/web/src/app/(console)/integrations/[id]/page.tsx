import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getIntegration, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, StatusCell } from "@/components/ui/status";
import { Panel } from "@/components/ui/panel";
import { KeyValue } from "@/components/ui/key-value";
import { CodeBlock } from "@/components/ui/code-block";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { CredentialActions, IntegrationStatusButton, RevealWebhookSecret, StoreCredentialDialog, TestConnectionButton } from "@/components/control/integration-dialogs";
import { integrationKind, KindBadge } from "@/components/control/integration-kind";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { statusLabel, statusTone } from "@/lib/status";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Integration ${id.slice(0, 8)}` };
}

/** Per-connector copy for sandbox integrations. Keyed by integration key; generic text otherwise. */
const SANDBOX_COPY: Record<string, { credentialName: string; connect: string; storeHint: string; records: string }> = {
  "stripe-test": {
    credentialName: "secret-key",
    connect: "Connect your Stripe test-mode secret key to enable this integration. Only test keys are accepted. Get one from the Stripe dashboard in test mode.",
    storeHint: "Store the Stripe test-mode secret key (sk_test_ or rk_test_) under the name secret-key. Live keys are refused so no real money can move. The key is encrypted with the organization master key and never shown again.",
    records: "Stripe keeps the record of every refund. Each receipt in AEGIS carries the Stripe refund id (re_...) and the amount in the smallest currency unit (minor units). When AEGIS checks with Stripe what actually happened (reconciliation), it looks refunds up by the AEGIS request id stored in the Stripe metadata. The connection test calls GET /v1/balance in test mode.",
  },
  "alpaca-paper": {
    credentialName: "api-key",
    connect: "Connect an Alpaca paper-trading key to enable this integration. Only paper keys are accepted. Create one in the Alpaca dashboard under Paper Trading.",
    storeHint: "Store the paper key as KEYID:SECRET (the key id starts with PK) under the name api-key. Live keys (AK...) and the live host are refused so no real money can trade. The key is encrypted with the organization master key and never shown again.",
    records: "Alpaca keeps the record of every order. Each receipt in AEGIS carries the Alpaca order id. When AEGIS checks with Alpaca what actually happened (reconciliation), it looks orders up by client_order_id, which is the AEGIS duplicate guard (idempotency key), so the same request can never create a second order. The connection test calls GET /v2/account on the paper host.",
  },
};

export default async function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePermission("integrations:read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const i = await withTenant(c.ctx.orgId, async (db) => {
    try {
      return await getIntegration(db, c.ctx, id);
    } catch (e) {
      if (isAegisError(e) && e.code === "not_found") return null;
      throw e;
    }
  });
  if (!i) notFound();
  const canWrite = c.can("integrations:write");
  const canControl = c.can("agents:control");
  const now = Date.now();
  const kind = integrationKind(i);
  const sandbox = kind === "sandbox";
  const copy = SANDBOX_COPY[i.key] ?? { credentialName: "api-key", connect: "Connect a sandbox credential to enable this integration. Only the provider's test-mode credentials are accepted.", storeHint: "Store the provider's test-mode credential. It is encrypted with the organization master key and never shown again.", records: "The provider keeps the record of every action. Each receipt in AEGIS carries the provider's reference." };
  const liveCredentials = i.credentials.filter((cr) => !cr.revokedAt);
  const needsCredential = sandbox && !liveCredentials.some((cr) => cr.name === copy.credentialName);
  const ledger = i.ledger.slice(0, 50);
  const webhookExample = `timestamp=$(date +%s000)\nbody='{"event":"refund.settled","reference":"RF-1001"}'\nsig=$(printf '%s.%s' "$timestamp" "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')\ncurl -X POST "$API_URL/v1/webhooks/${i.key}" \\\n  -H "Authorization: Bearer $INTEGRATION_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Aegis-Timestamp: $timestamp" \\\n  -H "X-Aegis-Signature: $sig" \\\n  --data "$body"`;
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Integrations", href: "/integrations" }, { label: i.name }]}
        title={i.name}
        badges={
          <>
            <StatusBadge status={i.status === "active" ? "active" : "disabled"} />
            <Badge>{i.type}</Badge>
            <KindBadge kind={kind} />
            <DemoBadge show={c.org.demoMode} />
          </>
        }
        description={i.description || <span className="font-mono text-xs">{i.key}</span>}
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <TestConnectionButton integrationId={i.id} canWrite={canWrite} />
            <IntegrationStatusButton integrationId={i.id} status={i.status} canWrite={canWrite} canControl={canControl} />
          </div>
        }
      />
      {needsCredential ? (
        <Note tone="info" className="mb-4">
          <strong>Not connected.</strong> {copy.connect}
        </Note>
      ) : null}
      {i.status === "disabled" ? (
        <Note tone="danger" className="mb-4">
          <strong>Disabled.</strong> {i.statusReason ? `Reason: ${i.statusReason}. ` : ""}Every tool behind this integration is refused at the Action Gateway, so no agent can use it.
        </Note>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Details">
          <KeyValue
            items={[
              { label: "Key", value: i.key, mono: true },
              { label: "Kind", value: sandbox ? "Sandbox: a real provider in its documented test mode. No live transactions." : "Simulated: an in-process stand-in used by the demonstrations." },
              { label: "Base URL", value: i.baseUrl, mono: true },
              { label: "Health", value: i.lastHealthAt ? <span className="inline-flex items-center gap-2"><Badge tone={i.lastHealthOk ? "allow" : "deny"}>{i.lastHealthOk ? "Healthy" : "Failing"}</Badge><span className="text-xs text-fg-dim">{timeAgo(i.lastHealthAt)}</span></span> : <Badge>Not checked</Badge> },
              { label: "Registered", value: formatDateTime(i.createdAt) },
              { label: "Updated", value: formatDateTime(i.updatedAt) },
            ]}
          />
        </Panel>
        <Panel title="Tools" description="What agents can do in this system through the Action Gateway" className="xl:col-span-2" padded={false}>
          {i.tools.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-dim">No tools attached yet. Tools are added from the AI Agents pages.</p>
          ) : (
            <SimpleTable caption="Tools" className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Tool</Th>
                  <Th>Risk level</Th>
                  <Th>State</Th>
                  <Th>Allowed destinations</Th>
                </tr>
              </thead>
              <tbody>
                {i.tools.map((t) => {
                  const rules = (t.destinationRules ?? {}) as { allowedDomains?: string[]; allowedResourceKeys?: string[] };
                  return (
                    <Tr key={t.id}>
                      <Td>
                        <span className="block font-medium">{t.name}</span>
                        <span className="block font-mono text-[11px] text-fg-dim">{t.key}</span>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(t.riskLevel)}>{statusLabel(t.riskLevel)}</Badge>
                      </Td>
                      <Td>{t.enabled ? <StatusCell status="enabled" /> : <span title={t.disabledReason ?? undefined}><StatusCell status="disabled" /></span>}</Td>
                      <Td className="text-xs text-fg-muted">
                        {[...(rules.allowedDomains ?? []).map((d) => `domain ${d}`), ...(rules.allowedResourceKeys ?? []).map((r) => `resource ${r}`)].join(", ") || "none declared"}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SimpleTable>
          )}
        </Panel>
        <Panel title="Credentials" description={sandbox ? "Stored encrypted. The connector re-checks that the key is a test key before every call" : "Stored encrypted. When a credential is due for renewal (rotation), rule RM-011 raises an alert"} className="xl:col-span-2" actions={<StoreCredentialDialog integrationId={i.id} canWrite={canWrite} existingNames={i.credentials.map((cr) => cr.name)} defaultName={sandbox ? copy.credentialName : undefined} sandboxHint={sandbox ? copy.storeHint : undefined} />} padded={false}>
          {i.credentials.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-dim">{sandbox ? `No credential stored. ${copy.connect}` : "No credentials stored. An agent cannot act on a real system until one is added."}</p>
          ) : (
            <SimpleTable caption="Credentials" className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th align="end">Version</Th>
                  <Th>Rotated</Th>
                  <Th>Renewal due (rotation)</Th>
                  <Th>State</Th>
                  <Th align="end">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {i.credentials.map((cr) => {
                  const dueMs = cr.rotationDueAt?.getTime() ?? null;
                  const dueBadge = cr.revokedAt ? null : dueMs === null ? <span className="text-xs text-fg-dim">not scheduled</span> : dueMs < now ? <Badge tone="deny">overdue {timeAgo(cr.rotationDueAt!)}</Badge> : dueMs < now + 14 * 86400_000 ? <Badge tone="approval">due {formatDateTime(cr.rotationDueAt!)}</Badge> : <span className="text-xs text-fg-muted">{formatDateTime(cr.rotationDueAt!)}</span>;
                  return (
                    <Tr key={cr.id}>
                      <Td mono>{cr.name}</Td>
                      <Td align="end">{cr.version}</Td>
                      <Td className="text-xs">{cr.rotatedAt ? formatDateTime(cr.rotatedAt) : <span className="text-fg-dim">never (stored {formatDateTime(cr.createdAt)})</span>}</Td>
                      <Td>{dueBadge}</Td>
                      <Td>{cr.revokedAt ? <StatusCell status="revoked" /> : <StatusCell status="active" />}</Td>
                      <Td align="end">
                        <CredentialActions integrationId={i.id} credential={{ id: cr.id, name: cr.name, revoked: !!cr.revokedAt }} canWrite={canWrite} canControl={canControl} sandbox={sandbox} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SimpleTable>
          )}
        </Panel>
        <Panel title="Webhook setup" description="How this system sends notifications back to AEGIS (webhooks), signed so they cannot be forged">
          <ol className="list-inside list-decimal space-y-1 text-xs text-fg-muted">
            <li>
              Send events to <span className="font-mono text-fg">POST /v1/webhooks/{i.key}</span> with the integration API key as a bearer token.
            </li>
            <li>
              Add <span className="font-mono text-fg">X-Aegis-Timestamp</span>: milliseconds since epoch. Requests older than 5 minutes are rejected.
            </li>
            <li>
              Add <span className="font-mono text-fg">X-Aegis-Signature</span>: hex HMAC-SHA256 of <span className="font-mono text-fg">timestamp.rawBody</span> using the webhook secret.
            </li>
          </ol>
          <CodeBlock className="mt-3" label="Example" code={webhookExample} wrap />
          <div className="mt-3">
            <RevealWebhookSecret integrationId={i.id} canWrite={canWrite} />
          </div>
        </Panel>
        {sandbox ? (
          <Panel title="Where the records live" description="For a sandbox connector the provider keeps the record of each action; this says where to find it and how AEGIS checks it" className="xl:col-span-3">
            <Note tone="info">{copy.records}</Note>
          </Panel>
        ) : (
          <Panel title="Simulated system activity" description="Entries the simulated system writes when it checks the one-time permission slip (grant) and carries out the action" className="xl:col-span-3" padded={false}>
            <div className="px-4 pt-3">
              <Badge tone="approval">Simulated system activity</Badge>
            </div>
            {ledger.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-fg-dim">No activity recorded by the simulated system yet.</p>
            ) : (
              <SimpleTable caption="Simulated ledger" className="mt-3 rounded-none border-0">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Reference</Th>
                    <Th>Type</Th>
                    <Th>Agent</Th>
                    <Th>Correlation</Th>
                    <Th>Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e, idx) => {
                    const at = typeof e.at === "string" ? e.at : typeof e.timestamp === "string" ? e.timestamp : null;
                    const rest = Object.fromEntries(Object.entries(e).filter(([k]) => !["at", "timestamp", "reference", "type", "toolKey", "agentSlug", "agent", "correlationId"].includes(k)));
                    return (
                      <Tr key={idx}>
                        <Td className="text-xs">{at ? formatDateTime(at) : <span className="text-fg-dim">unknown</span>}</Td>
                        <Td mono>{String(e.reference ?? "")}</Td>
                        <Td mono>{String(e.type ?? e.toolKey ?? "")}</Td>
                        <Td mono>{String(e.agentSlug ?? e.agent ?? "")}</Td>
                        <Td mono>
                          {typeof e.correlationId === "string" ? (
                            <Link href={`/gateway?q=${encodeURIComponent(e.correlationId)}`} className="text-accent hover:underline">
                              {e.correlationId.slice(0, 18)}
                            </Link>
                          ) : (
                            ""
                          )}
                        </Td>
                        <Td className="max-w-[360px] truncate font-mono text-[11px] text-fg-muted" title={JSON.stringify(rest)}>
                          {JSON.stringify(rest)}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </SimpleTable>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
