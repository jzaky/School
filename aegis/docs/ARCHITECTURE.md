# AEGIS architecture

## Shape: a modular monolith with three processes

```
                      +-----------------------------+
  Browser  ---------> |  apps/web  (Next.js)        |  console + public site
                      |  server components/actions  |
                      +-------------+---------------+
                                    |  imports
  AI agents / SDKs --------+        v
  simulated systems        |  +-----------------------------+      +----------------+
  webhooks        -------> |  |  packages/core              | <--> |  PostgreSQL    |
                           |  |  identity, orgs, agents,    |      |  RLS enforced  |
                      +----+--+  policy, authz, gateway,    |      +----------------+
                      | apps/api (Fastify)                  |
                      | REST: /v1/gateway, /v1/agents, ...  | <--> |  Redis (rate limits, live events)
                      +-------------------------------------+
                                    ^
                      +-------------+---------------+
                      |  apps/worker                |  approval expiry, monitoring rules,
                      |  PostgreSQL job queue       |  notifications, evidence checkpoints,
                      +-----------------------------+  demo simulators
```

- **packages/core** holds every domain module. Each module exposes a service object that takes an `OrgContext` (tenant id, actor, request id) and a tenant-scoped database handle. Modules: `identity`, `orgs`, `agents`, `policy`, `authz`, `gateway`, `approvals`, `evidence`, `monitoring`, `shield`, `incidents`, `integrations`, `audit` (assessments), `notify`, `jobs`, `platform`.
- **packages/db** holds the Prisma schema, migrations, the `prisma/rls.sql` policies and the `tenantDb(orgId)` helper that sets `app.current_org` for every query.
- **packages/sdk** is the TypeScript client agents use to call the gateway.
- **apps/api** exposes the external REST surface (agent API keys, integration webhooks, console JSON used by live views). It is the Action Gateway process. It can be deployed independently and scaled separately.
- **apps/web** renders the console and the marketing site. Server components and server actions import `@aegis/core` directly. This avoids an internal HTTP hop and a second auth layer for the console while keeping the external API as the only path agents can use.
- **apps/worker** runs the job loop. All side effects (notifications, expiries, checkpoints) carry idempotency keys.

Tradeoffs recorded in ADR-0001. Short version: one database, one schema, three deployables; module boundaries are enforced by package structure and lint rules, not by network. Extraction into services is possible per module later because modules only talk through service interfaces and the job table.

## Request lifecycle through the Action Gateway

1. Agent authenticates with an API key (hashed at rest, scoped to one agent, revocable). Revoked or suspended agents are rejected before any policy work.
2. Request body is validated against the registered tool's parameter schema. Invalid input is denied and recorded.
3. The gateway writes an `action_requests` row (status `evaluating`) inside a transaction, with the idempotency key. A duplicate key returns the original result and never re-executes.
4. The authorization service builds the policy input (agent, principal, org, resource, action, environment, parameters, classification, amount, context) and evaluates the active policy versions assigned to the agent. Evaluation failure is a deny.
5. Shield runs data-classification and tool-security checks on the parameters. A block from Shield is a deny with a security event.
6. The result is one of `allow`, `deny`, `require_approval`. An `authorization_decisions` row is written with the full explanation and the policy version ids.
7. `allow`: the request becomes `allowed` and the gateway issues its single execution grant (five minutes, bound to the hash of tool, action and the parameters that will execute). Execution then runs in its own phases, described below.
8. `require_approval`: an `approval_requests` row is created with an expiry. Nothing executes. Approvers decide in the Approval Center; every response is an `approval_responses` row. On approval the gateway re-validates that the request hash still matches, re-checks agent status and the emergency pause, marks the request `approved` and issues the single grant. Execution happens after the approval transaction commits, never inside it. An expired approval can never be used.
9. Every step appends an `evidence_events` row to the hash chain.

## Execution phases and the one-live-grant rule

Execution is deliberately not one transaction, because a downstream call is an external side effect that cannot be rolled back.

1. Phase 1 (transaction): re-check status, agent and pause; consume the grant. Consuming moves the request to `executing`, which means no further grant can be issued and no other grant verifies. A partial unique index on `execution_grants` guarantees at most one live grant per request even under concurrent issuance; pause, suspension and revocation void live grants.
2. Phase 2 (no transaction): the downstream call, carrying the stable idempotency key `aegis:<requestId>`. Real providers (Stripe test mode) receive it as their idempotency key; simulators honour it too. The connector reports `succeeded`, `failed` (nothing happened downstream) or `unknown` (the call may have happened, no definitive answer).
3. Phase 3 (transaction): the receipt and the final status. `unknown` keeps the request `executing` and schedules reconciliation: the connector looks the operation up by idempotency key and the request becomes `executed` or `failed` from the downstream system's own record. When the system cannot tell after several attempts, the request becomes `unknown`, a security event and a monitoring alert (RM-012) ask a human to check the downstream system and settle it with a reason. Nothing is ever re-sent blindly.

A single-use grant is therefore not a claim of exactly-once execution. The guarantee is: the gateway never starts a request twice, every outcome is recorded against the downstream system's own record, and ambiguity is surfaced rather than guessed.

## Fail-closed guarantees

| Failure | Behaviour |
|---|---|
| Policy evaluation throws | deny, evidence event `policy.evaluation_failed`, security event |
| Database unavailable | gateway returns 503, nothing executes |
| Evidence append fails | the transaction that contains the decision rolls back, nothing executes |
| Approval expired | status `expired`, execution refused |
| Parameters changed after approval | request hash mismatch, new evaluation required |
| Agent suspended or revoked | rejected at authentication, before evaluation |
| Downstream system refuses before acting | receipt `failed`, no retry without a new request |
| Downstream call sent but no definitive answer | receipt `unknown`, request stays `executing`, reconciled by idempotency key; never re-sent blindly |
| Reconciliation cannot determine the outcome | request `unknown`, security event and alert, human settlement with a recorded reason |
| Gateway paused after approval | execution refused, grants voided, request stays `approved` until an administrator resumes and runs it |

## Tenant isolation

Every tenant table has `org_id`. PostgreSQL row-level security is enabled and forced on every tenant table. The application role `aegis_app` is not the table owner and cannot bypass RLS. `tenantDb(orgId)` runs each query inside a transaction that sets `app.current_org`. Platform-admin code reads the global tables (organizations, platform_events, users) through the application connection and takes per-tenant counts inside each tenant context; no application process holds the owner credential. The isolation test suite inserts rows for two organizations and proves that reads, writes and raw SQL through the app role see only one.

## Evidence integrity

`evidence_events` rows carry `seq` (per org), `prev_hash` and `hash = sha256(canonical(event) || prev_hash)`. Triggers reject UPDATE and DELETE for the app role. The worker writes a signed checkpoint (Ed25519 over the latest hash) every N events or minutes, and verification recomputes the chain. This is tamper-evidence: an attacker with the database owner role could rewrite history and re-sign if they also had the signing key, so the key lives outside the database and checkpoints can be exported to customer storage. The UI says "tamper-evident", never "immutable".

## Where the four products live

| Product | Modules | Console sections |
|---|---|---|
| Control | agents, policy, authz, gateway, approvals, integrations | AI Agents, Policies, Action Gateway, Approvals, Integrations |
| Assurance | evidence, monitoring, policy history, compliance mapping | Evidence Ledger, Risk Monitoring, Governance Reports, Policy History |
| Shield | shield (detectors, tool security, injection), incidents, integration security | Security Events, Data Protection, Tool Security, Incidents |
| Audit | documents, frameworks, assessments, remediation, reports | Assessments, Standards, Documents, Remediation, Reports |

All four share identity, organizations, roles, policy versions, the evidence ledger and notifications.
