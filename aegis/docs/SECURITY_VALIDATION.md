# Security validation

What protects each security property, which automated test proves it, and how AEGIS behaves when a part of
its own infrastructure fails. "Tested" means an automated test in this repository exercises it on every CI
run; "drilled" means a script was run against a real database and its output is recorded here. Nothing in
this document has been assessed by an independent party.

## Requirement matrix

| Requirement | Mechanism | Proof |
|---|---|---|
| Cross-tenant isolation | Row-level security on every table with `org_id`; the application role is not the owner and cannot bypass RLS | `packages/db/tests/isolation.test.ts`, `platform-isolation.test.ts` (tested); live check on the Deployment page |
| Cross-tenant references | Foreign keys are checked by PostgreSQL without RLS, so a tenant that learned another tenant's row id could point at it. 67 triggers (every single-column foreign key between tenant tables, plus 31 listed plain reference columns) refuse a reference to another organization's row | `security-regression.test.ts` "cross-tenant references" (tested) |
| Authorization bypass attempts | Only agents submit requests; the agent's own organization is fixed by its key; tool grants, resource permissions, classification limits and destinations are checked before policy | `gateway.test.ts`, `agent-identity.test.ts`, `security-regression.test.ts` "an agent of another organization cannot act in this one" (tested) |
| Replay attacks | Execution grants are single use (partial unique index allows one live grant per request); approvals are bound to a hash of the exact parameters; SAML assertions are single use | `execution-safety.test.ts`, `gateway.test.ts` approval integrity, `saml.test.ts` (tested) |
| Concurrent action limits | `agent.metadata.maxConcurrentActions`: live grants plus executions in progress; a per-agent advisory lock held until the decision commits makes simultaneous requests count one after another | `security-regression.test.ts`: five simultaneous requests with a limit of two give exactly two permissions (tested) |
| Approval separation of duties | Agent owners and the requesting principal cannot approve; exceptions need a second person; autonomy raises are decided by someone else | `gateway.test.ts`, `policy-advanced.test.ts`, `autonomy.test.ts` (tested) |
| Credential rotation | Integration credentials rotate to a new version and ciphertext; agent API keys are revoked and reissued; evidence checkpoints verify across signing-key rotation | `security-regression.test.ts` "credential rotation", `evidence-signing.test.ts` (tested) |
| Policy tampering | Versions are frozen by a trigger once out of draft; each version's content hash is recomputed before every decision and a mismatch refuses the request with a critical security event (the agent's autonomy is not lowered for it) | `security-regression.test.ts` "policy tampering": an owner-role rewrite with the trigger disabled is detected (tested) |
| Evidence integrity | Hash chain per organization, append-only triggers, signed checkpoints | `foundation.test.ts`, `evidence-signing.test.ts`, `isolation.test.ts` append-only (tested) |
| Worker failures | Jobs left running by a dead worker are recovered; executions stuck between phases are reconciled by the sweep | `jobs.test.ts`, `execution-safety.test.ts` (tested); System Health reports a missing worker |
| Redis outages | Redis is not on any request path: the job queue, rate limits and sessions are in PostgreSQL. `REDIS_URL` is optional and unused by the application | not applicable (by design) |
| Database outages | Every decision is one transaction; if any write fails, nothing is recorded and no permission exists | `gateway.test.ts` "an evidence write failure rolls the decision back", `security-regression.test.ts` "database failure during a decision" (tested) |
| Gateway failures | The SDK treats an unreachable, failing, hanging or malformed gateway as a refusal and never runs the tool | `packages/sdk/tests/adapters.test.ts` (tested) |
| Idempotency | Same key returns the recorded outcome; same key with other parameters is refused; downstream calls carry the gateway's key | `gateway.test.ts`, `stripe-connector.test.ts`, `trading.test.ts` (tested) |
| Execution reconciliation | An ambiguous outcome is recorded as unknown and reconciled from the downstream system's own record | `execution-safety.test.ts`, `stripe-connector.test.ts`, `trading.test.ts` (tested) |
| Backup restoration | `pnpm --filter @aegis/core drill:restore`: dump, restore into a scratch database, compare row counts and verify every evidence chain against the source | drilled, see below |
| Disaster recovery | Runbook in docs/BACKUP_RECOVERY.md | the restore drill covers one region; a point-in-time recovery drill with WAL archiving has not been performed |
| Emergency revocation | Suspend or revoke an agent: voids live grants, revokes keys and delegations, expires pending approvals | `agent-identity.test.ts` "emergency revocation" (tested) |
| Event destination SSRF and DNS rebinding | HTTPS only, public addresses only, no redirects; the delivery resolves the name through a lookup that refuses private, loopback and metadata answers, so the address checked is the address connected to | `destinations.test.ts`, `security-regression.test.ts` "DNS pinning" (tested) |

## Fail-closed design

For protected actions, losing any part of the authorization path never results in permission to execute.

| What fails | What AEGIS does | Operational consequence |
|---|---|---|
| Database unavailable | The API cannot record a decision and answers with an error; no grant exists | Agents using the SDK receive a refusal and stop. Nothing protected runs until the database is back. Approvers cannot decide in the meantime |
| A write inside a decision fails (evidence, decision, grant) | The whole transaction rolls back | The request leaves no trace and has no permission; the agent may retry with the same idempotency key |
| API unreachable, slow or answering garbage | The SDK returns a refusal with the transport error | Same as above. Downstream systems that verify grants also refuse, because verification needs the API |
| A policy no longer matches its recorded hash | Refused before evaluation; critical security event | Every agent covered by that policy is refused until the policy is restored or a new version is activated |
| Data protection inspection throws, or a classification is unknown | Refused | The affected requests stop; the security event names the cause |
| Worker stopped | Authorization is unaffected. Checkpoints, event deliveries, approval expiry sweeps and reconciliation pause | System Health shows "failing" for the worker after ten minutes; restart it and it catches up (all jobs are idempotent) |
| Evidence signing key missing in production | The process refuses to start | Configure the key before starting |
| Destination resolves to a private address at delivery time | The connection is refused; the delivery is marked failed | No data leaves; the failure is visible on the destination page |

## Backup restore drill (recorded)

Run on 15 October 2026 against the development database (PostgreSQL 16.15), command
`MIGRATION_DATABASE_URL=... pnpm --filter @aegis/core drill:restore`:

- Row counts matched for 11 core tables, for example 7,547 action requests, 7,605 decisions and 53,177 evidence events.
- 1,202 evidence chains (43 live organizations and the retained evidence of removed test organizations), 53,177 events: every chain gave the same verification result on the restored copy as on the source. 39 chains were already invalid in the source, because test suites tamper with evidence on purpose, and stayed invalid at the same row.
- The dump was 14.92 MB. Dump and restore took 8.0 seconds, and the whole drill took 20.4 seconds.

This is a development database on one host. It is not a production drill, and it does not measure a recovery time objective.

## Load and failure-injection tests

- **Failure injection:** a write failure is injected into a decision (`security-regression.test.ts`) and an evidence failure into another (`gateway.test.ts`). The worker's death mid-job is covered in `jobs.test.ts`, lost responses in `execution-safety.test.ts`, and an unreachable, failing, hanging or garbled gateway on the SDK side in `adapters.test.ts`.
- **Load:** `scripts/perf-gateway.mts` measures gateway latency and throughput against a running API. Measured results are recorded in docs/PERFORMANCE.md; none are claimed here.

## Enterprise attack validation

Black-box suites attack the API as another tenant, a viewer and a compromised agent or integration key: every
registered route swept with the victim's ids and spoofed organization headers, well-formed cross-tenant writes,
tool-call manipulation, grant tampering, policy enforcement under pause and suspension, identity and session attacks, races and every console server action. Results, eleven fixed
findings and the limits of the method: `docs/ENTERPRISE_ATTACK_VALIDATION.md`.

## Not yet done

- An independent penetration test.
- A production point-in-time recovery drill.
- Chaos testing of a multi-instance deployment.
