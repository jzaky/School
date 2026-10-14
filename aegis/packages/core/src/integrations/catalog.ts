import type { TenantDb } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import { ALPACA_SYSTEM_KEY } from "../gateway/connectors/alpaca.js";
import { STRIPE_SYSTEM_KEY } from "../gateway/connectors/stripe.js";

/**
 * The integration catalog (docs/ENTERPRISE_INTEGRATIONS.md). Every entry states plainly how far it has been
 * verified. No entry in this repository has been verified against the real vendor service by AEGIS;
 * an organization's own successful test (a test event accepted, a connection test passed) is shown
 * separately as "verified in your organization".
 */
export type CatalogStatus = "contract_tested" | "tested" | "simulated";

export const CATALOG_STATUS: Record<CatalogStatus, { label: string; meaning: string }> = {
  contract_tested: { label: "Built to the public API, tested against a local stand-in", meaning: "Implemented from the provider's public documentation and exercised in this repository against a local server that imitates it. Not yet verified by AEGIS against the real service." },
  tested: { label: "Tested in this repository", meaning: "Runs entirely inside AEGIS or your own code, with automated tests in this repository. No external service is involved." },
  simulated: { label: "Simulator for demos", meaning: "A local simulator. Nothing leaves AEGIS." },
};

export interface CatalogEntry {
  key: string;
  name: string;
  category: "actions" | "identity" | "events" | "agents";
  description: string;
  status: CatalogStatus;
  /** What a customer supplies to use it against the real service. */
  needs: string;
  /** Where in the console it is set up. */
  configureHref: string;
  docs: string;
  /** Vendor named only to describe compatibility. */
  vendor?: string;
}

export const INTEGRATION_CATALOG: CatalogEntry[] = [
  { key: STRIPE_SYSTEM_KEY, name: "Stripe refunds (test mode)", category: "actions", description: "Agents issue refunds through the gateway; AEGIS executes them with Stripe's idempotency keys and reconciles ambiguous outcomes. Live keys are refused.", status: "contract_tested", needs: "A Stripe test-mode secret key", configureHref: "/integrations", docs: "docs/CONNECTORS.md", vendor: "Stripe" },
  { key: ALPACA_SYSTEM_KEY, name: "Alpaca paper trading", category: "actions", description: "Paper-trading orders placed through the gateway under a trading mandate. Live trading keys are refused.", status: "contract_tested", needs: "An Alpaca paper-trading key", configureHref: "/integrations", docs: "docs/CONNECTORS.md", vendor: "Alpaca" },
  { key: "simulators", name: "Demo systems (support, payments, CRM, email)", category: "actions", description: "Local simulators behind the demo tools, so every gateway outcome can be shown without touching a real system.", status: "simulated", needs: "Nothing", configureHref: "/integrations", docs: "docs/CONNECTORS.md" },
  { key: "oidc", name: "Single sign-on (OpenID Connect)", category: "identity", description: "Sign-in through your identity provider, for example Microsoft Entra ID, Okta or Google Workspace, with PKCE and email-domain routing.", status: "contract_tested", needs: "An OIDC application in your identity provider", configureHref: "/org/settings", docs: "docs/SECURITY.md" },
  { key: "saml", name: "Single sign-on (SAML 2.0)", category: "identity", description: "SAML sign-in with signature and audience checks.", status: "contract_tested", needs: "A SAML application and its signing certificate", configureHref: "/org/settings", docs: "docs/SECURITY.md" },
  { key: "scim", name: "User provisioning (SCIM 2.0)", category: "identity", description: "Your identity provider creates, updates and deactivates AEGIS users.", status: "contract_tested", needs: "An API key with the scim:provision scope", configureHref: "/org/settings", docs: "docs/AGENT_IDENTITY.md" },
  { key: "webhook", name: "Signed webhook", category: "events", description: "Governance events as JSON to any HTTPS endpoint, signed with HMAC-SHA-256 and a timestamp.", status: "contract_tested", needs: "An HTTPS endpoint that verifies the signature", configureHref: "/integrations/destinations", docs: "docs/ENTERPRISE_INTEGRATIONS.md" },
  { key: "slack", name: "Slack", category: "events", description: "Security events, approvals and refusals posted to a channel through an incoming webhook.", status: "contract_tested", needs: "A Slack incoming webhook URL", configureHref: "/integrations/destinations", docs: "docs/ENTERPRISE_INTEGRATIONS.md", vendor: "Slack" },
  { key: "teams", name: "Microsoft Teams", category: "events", description: "The same events as an Adaptive Card in a channel, through a Teams workflow webhook.", status: "contract_tested", needs: "A Teams workflow (or incoming) webhook URL", configureHref: "/integrations/destinations", docs: "docs/ENTERPRISE_INTEGRATIONS.md", vendor: "Microsoft" },
  { key: "splunk_hec", name: "Splunk (HTTP Event Collector)", category: "events", description: "Every event with its full record, for your SIEM searches and alerts.", status: "contract_tested", needs: "A HEC URL and token", configureHref: "/integrations/destinations", docs: "docs/ENTERPRISE_INTEGRATIONS.md", vendor: "Splunk" },
  { key: "datadog_logs", name: "Datadog Logs", category: "events", description: "Events as Datadog logs, tagged by category and type.", status: "contract_tested", needs: "A Datadog API key and your site", configureHref: "/integrations/destinations", docs: "docs/ENTERPRISE_INTEGRATIONS.md", vendor: "Datadog" },
  { key: "servicenow", name: "ServiceNow incidents", category: "events", description: "An incident per event through the Table API, with the AEGIS event id as its correlation id.", status: "contract_tested", needs: "An instance URL and an integration user", configureHref: "/integrations/destinations", docs: "docs/ENTERPRISE_INTEGRATIONS.md", vendor: "ServiceNow" },
  { key: "sdk-typescript", name: "TypeScript SDK and framework adapters", category: "agents", description: "Guard any tool call; adapters for OpenAI Agents, LangChain, LangGraph tool nodes and Anthropic tool use.", status: "tested", needs: "An agent API key", configureHref: "/agents", docs: "docs/UNIVERSAL_GATEWAY.md" },
  { key: "sdk-python", name: "Python SDK", category: "agents", description: "The same guard for Python agents.", status: "tested", needs: "An agent API key", configureHref: "/agents", docs: "packages/sdk-python/README.md" },
  { key: "mcp", name: "MCP gateway", category: "agents", description: "A Model Context Protocol proxy that sends every tool call through AEGIS before it reaches the MCP server.", status: "tested", needs: "An agent API key", configureHref: "/agents", docs: "docs/UNIVERSAL_GATEWAY.md" },
];

export const CATALOG_CATEGORIES: Record<CatalogEntry["category"], string> = { actions: "Actions agents take", identity: "Identity and access", events: "Event destinations", agents: "Agent frameworks" };

/** What this organization has set up and verified for each catalog entry. */
export async function catalogForOrg(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "integrations:read");
  const [destinations, integrations, sso, scimKeys] = await Promise.all([
    db.eventDestination.findMany({ select: { kind: true, verifiedAt: true, enabled: true } }),
    db.integration.findMany({ select: { key: true, type: true, settings: true, lastHealthOk: true, lastHealthAt: true } }),
    db.ssoConnection.findMany({ select: { protocol: true, enabled: true } }),
    db.apiKey.count({ where: { revokedAt: null, scopes: { has: "scim:provision" } } }),
  ]);
  return INTEGRATION_CATALOG.map((e) => {
    let configured = 0;
    let verifiedAt: Date | null = null;
    if (e.category === "events") {
      const mine = destinations.filter((d) => d.kind === e.key);
      configured = mine.length;
      verifiedAt = mine.map((d) => d.verifiedAt).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    } else if (e.key === STRIPE_SYSTEM_KEY || e.key === ALPACA_SYSTEM_KEY) {
      const mine = integrations.filter((i) => (i.settings as { system?: string } | null)?.system === e.key || i.key === e.key);
      configured = mine.length;
      verifiedAt = mine.filter((i) => i.lastHealthOk && i.lastHealthAt).map((i) => i.lastHealthAt!).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    } else if (e.key === "oidc" || e.key === "saml") {
      configured = sso.filter((s) => s.protocol === e.key).length;
    } else if (e.key === "scim") {
      configured = scimKeys;
    } else if (e.key === "simulators") {
      configured = integrations.filter((i) => i.key.endsWith("-sim")).length;
    }
    return { ...e, configured, verifiedAt };
  });
}
