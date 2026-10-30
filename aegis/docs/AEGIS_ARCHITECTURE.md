# AEGIS architecture

Current as of 15 October 2026. Decisions behind it are in `docs/adr/`; security properties and their tests
in docs/SECURITY_VALIDATION.md; performance in docs/PERFORMANCE.md.

## Shape: a modular monolith with three processes

```
  Browser ------------> apps/web (Next.js 15)          console, public site, server actions
                            | imports
  Agents, SDKs, MCP ---> apps/api (Fastify 5)          REST /v1/*, gateway, webhooks, SCIM, /metrics
                            | imports
                        packages/core                  every domain module, pure engines
                            |
                        packages/db (Prisma 6) ------> PostgreSQL 16
                            ^                           row-level security, append-only triggers,
                            |                           cross-tenant reference guards
                        apps/worker                     PostgreSQL job queue: expiries, reconciliation,
                                                        checkpoints, event delivery, monitoring,
                                                        usage snapshots, operational alerts
```

- **packages/core** holds every domain module. A module takes an `OrgContext` (organization, actor, request id) and a tenant-scoped transaction client. Modules: `identity` (sessions, MFA, SSO, SCIM, API keys), `orgs`, `agents` (registry, access, delegation, discovery, posture, revocation), `policy` (schema, evaluator, replay, analysis, exceptions, templates), `gateway` (pipeline, grants, connectors, simulators), `approvals`, `autonomy`, `uncertainty`, `reasoning`, `shield` (data classes, tool security, injection), `security` (Attack Simulation Lab), `incidents`, `monitoring`, `governance` (continuous governance, models, data, regulatory), `evidence`, `assurance` (reports, Control Center, health, operational alerts), `audit` (documents, frameworks, assessments), `integrations` (connectors, catalog, event destinations), `deployment` (manifest, residency, readiness), `commercial` (plans, metering, invoices, support), `demos`, `jobs`, `notify`, `platform`.
- **packages/db**: the Prisma schema, migrations, `prisma/rls.sql` (policies, append-only triggers, cross-tenant reference guards, security-definer functions) and `withTenant(orgId, fn)`, which runs `fn` in a transaction with `app.current_org` set and the organization's lock taken.
- **packages/sdk** (TypeScript) and **packages/sdk-python**: clients that fail closed. **packages/mcp-gateway**: a proxy that puts AEGIS in front of any MCP server.
- **apps/api** is the only path agents can use. **apps/web** imports core directly for the console. **apps/worker** runs idempotent jobs.

No application process holds the database owner credential in production; the process guard refuses to start if it finds one. Redis is not used on any request path.

## The decision pipeline (`packages/core/src/gateway/gateway.ts`)

One request, one transaction, in this order. Each later stage can only make the outcome stricter.

1. **Authenticate** the agent's API key (hashed, scoped, revocable). Suspended and revoked agents stop here.
2. **Idempotency.** The same key returns the recorded outcome; the same key with other parameters is refused.
3. **Structural checks.** The agent is active and its credential has not expired. The tool must be granted, enabled and integration-active, with valid parameters. Resource permission, classification limit and destination allowlist are checked, along with the delegation scope and the gateway pause. Two further checks were added in Phase 13:
   - **Policy integrity:** every active version's hash is recomputed.
   - **Concurrent action limit:** the agent's in-flight actions are counted under a per-agent lock.

   A failure is a refusal.
4. **Shield.** Data classes in the parameters, tool security, and injection signals. A block is a refusal; sensitive data can require approval.
5. **Uncertainty** is assessed from the evidence the agent supplied: contradictions, missing items, freshness, trusted sources, calibrated confidence.
6. **Policies:**
   - Every active version assigned to the agent, its team or the organization is evaluated deterministically. Deny overrides, and with no match the default is deny.
   - Under a delegation, the delegator's policies apply too.
   - Approved exceptions skip their rule.
7. **Escalations, each only stricter:**
   - sensitive data;
   - conflicting rules;
   - uncertainty;
   - the agent's stated reasons (reasoning governance);
   - injection response;
   - model governance;
   - the agent's managed autonomy level.
8. **Outcome:** one of six:
   - allow;
   - restrict (the parameters are narrowed);
   - require approval;
   - request more information;
   - quarantine;
   - deny.

   The decision row records the full explanation, the policy version ids and the uncertainty level. Evidence is appended to the hash chain in the same transaction; if that write fails, the decision rolls back.
9. **After the decision:**
   - an allow or restrict decision issues one execution grant, bound to the exact parameters;
   - an approval creates an approval request with an expiry;
   - a refusal can raise a security event, lower autonomy (when automation is on) and suspend an opted-in agent.

Policy evaluation is a pure function (about 0.16 ms for a 50-rule policy). A decision runs about 47 queries; see docs/PERFORMANCE.md.

## Execution phases and the one-live-grant rule

Execution is deliberately not one transaction, because a downstream call is an external side effect that cannot be rolled back.

1. Phase 1 (transaction): re-check status, agent and pause; consume the grant. Consuming moves the request to `executing`, which means no further grant can be issued and no other grant verifies. A partial unique index on `execution_grants` guarantees at most one live grant per request even under concurrent issuance; pause, suspension and revocation void live grants.
2. Phase 2 (no transaction): the downstream call, carrying the stable idempotency key `aegis:<requestId>`. Real providers (Stripe test mode) receive it as their idempotency key; simulators honour it too. The connector reports `succeeded`, `failed` (nothing happened downstream) or `unknown` (the call may have happened, no definitive answer).
3. Phase 3 (transaction): the receipt and the final status. `unknown` keeps the request `executing` and schedules reconciliation: the connector looks the operation up by idempotency key and the request becomes `executed` or `failed` from the downstream system's own record. When the system cannot tell after several attempts, the request becomes `unknown`, a security event and a monitoring alert (RM-012) ask a human to check the downstream system and settle it with a reason. Nothing is ever re-sent blindly.

A single-use grant is therefore not a claim of exactly-once execution. The guarantee is: the gateway never starts a request twice, every outcome is recorded against the downstream system's own record, and ambiguity is surfaced rather than guessed.

## Isolation, in layers

1. **Row-level security** on every table with `org_id`; the application role is not the owner and cannot bypass it (checked live on the Deployment page).
2. **Cross-tenant reference guards.** Foreign keys are checked without row-level security, so 67 triggers refuse a row that points at another organization's row.
3. **Per-organization encryption context.** Secrets are AES-256-GCM envelopes bound to their record and organization.
4. **Organization-scoped jobs.** A job runs as the organization in its row; a payload naming another organization is refused.
5. **Platform administration** reads global tables through the application connection and tenant data inside each tenant's context.

## Evidence integrity

`evidence_events` rows carry `seq` (per org), `prev_hash` and `hash = sha256(canonical(event) || prev_hash)`. Triggers reject UPDATE and DELETE for the app role. The worker writes a signed checkpoint (Ed25519 over the latest hash) every N events or minutes, and verification recomputes the chain. This is tamper-evidence: an attacker with the database owner role could rewrite history and re-sign if they also had the signing key, so the key lives outside the database and checkpoints can be exported to customer storage. The UI says "tamper-evident", never "immutable".

## Observability and reliability

Metrics are recorded to OpenTelemetry and served in Prometheus format by the API (`/metrics`) and the worker. Spans cover decisions, executions and jobs, and logs are pino JSON with redaction. The gateway applies backpressure (503 beyond its in-flight limit). Circuit breakers protect downstream systems and event destinations. The queue has a dead-letter state with requeue, and operational alerts run every five minutes. Details: docs/PERFORMANCE.md.

## Where the products live

| Product | Modules | Console |
|---|---|---|
| Control | agents, policy, gateway, approvals, autonomy, uncertainty, reasoning, integrations | Agents, Approvals, Activity, Policies, Action Gateway, Autonomy, Uncertainty, Integrations |
| Assurance | evidence, monitoring, assurance, governance | Control Center, Evidence Ledger, Risk Monitoring, Governance Reports, Models, Data Inventory, Regulatory Changes |
| Shield | shield, security, incidents | Security Events, Data Protection, Tool Security, Incidents, Attack Simulation Lab |
| Audit | audit | Assessments, Standards, Documents, Remediation, Reports |
| Platform | deployment, commercial, platform | Deployment, Billing, Support, System Health; for platform administrators Tenants, Customers, Infrastructure Health |

Everything shares identity, organizations, roles, policy versions, the evidence ledger and notifications.
