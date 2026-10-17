# Performance and reliability

## Gateway throughput for one organization: the bottleneck and the fix (14 October 2026)

### Workload (reproducible)

```
pnpm --filter @aegis/core bench:gateway:setup 2 10          # 2 organizations, 10 agents each, fresh every run
AEGIS_URL=http://127.0.0.1:4000 pnpm --filter @aegis/core bench:gateway 600 20 1   # requests, concurrency, organizations
```

**Each request:**
- is an `issue-refund` sent over HTTP to `POST /v1/gateway/actions` with an agent's own API key;
- is spread round-robin over the organization's agents;
- has a unique order and a unique idempotency key;
- has an amount that rotates through the refund policy's tiers:

  | Amount | Policy outcome |
  |---|---|
  | Below AED 200 | Allowed and executed against the simulated support system |
  | AED 1,000 to 2,500 | Waits for approval |
  | Above AED 2,500 | Denied |

  The policy's velocity rule also denies an agent's tenth refund in 24 hours.

**How it is measured:**
- 30 warm-up requests per organization are excluded.
- Results are throughput, p50, p95, p99 and maximum latency, the error rate (HTTP 5xx, 429 or network error) and the outcome counts.
- The JSON records are in `docs/validation/performance/`.

**Environment:**
- The build container: 4 vCPU, shared by PostgreSQL 16, the API in production mode and the load generator.
- `DATABASE_URL` with `connection_limit=25`.
- This is not a production environment, and the CPU ceiling below belongs to this machine.

### Results

| Run | Throughput | p50 | p95 | p99 | Max | Errors |
|---|---|---|---|---|---|---|
| Before: 1 organization, concurrency 20 | **7.0/s** | 2,118 ms | 5,812 ms | 6,481 ms | 6,892 ms | 0 |
| After: 1 organization, concurrency 10 | 19.5/s | 473 ms | 829 ms | 1,052 ms | 1,359 ms | 0 |
| After: 1 organization, concurrency 20 | **20.7 to 21.1/s** | 960 to 981 ms | 1,452 to 1,522 ms | 1,626 to 1,655 ms | 1,692 to 1,702 ms | 0 |
| After: 1 organization, concurrency 40 | 19.8/s | 1,914 ms | 3,245 ms | 3,456 ms | 3,646 ms | 0 |
| After: 2 organizations, concurrency 40 | 22.6/s in total (11.3/s each) | 1,605 ms | 3,235 ms | 3,465 ms | 3,621 ms | 0 |

**Same decisions before and after.** The outcome counts at concurrency 20 were identical: 178 executed, 108 waiting for approval and 114 denied of 400. The change removed waiting; it did not change any decision.

**Verdict on the 20/s target.** It is met at concurrency 20 and narrowly missed at 10 and 40 (19.5 and 19.8). After the fix the limit is this machine's CPU, not the organization:
- Two organizations together get about the same total as one.
- The CPU is about 90% busy, mostly Prisma's query engine.

On a host where the database, the API and the load generator do not share four cores, the figure should be higher. That has not been measured.

### What limited it, and what changed

1. **The organization lock covered whole transactions (cause of the 7/s).**
   - **Before:** every gateway transaction took the organization's ledger lock before its first statement and held it to commit, so an organization's decisions ran one at a time, each taking about 77 queries. The lock exists to keep the evidence chain strictly ordered.
   - **Now:** the API's gateway route runs with a new `deferred` lock mode (`withTenant(..., { lock: "deferred" })`). Evidence appended during the transaction is buffered and written, under the lock, just before commit. The lock now covers only the ledger writes and the commit.
   - **Unchanged:** the rows, hashes and chain order are produced exactly as before. Evidence still commits or rolls back with the decision.
   - **Narrower locks** keep exact what the big lock used to guarantee, always taken in this order:
     1. per idempotency key;
     2. per agent (the agent's 24-hour counters, approvals pending and its concurrency limit);
     3. per business reference (the duplicate-refund check).
   - **A latent race, found and fixed.** The duplicate check only counted requests created before the deciding request's start time. A competing request that committed while this one waited could therefore be missed; the organization lock had hidden this. Live decisions now count every committed request and exclude only themselves; replays keep the time bound.
2. **Connection pool.** Prisma's default pool is two connections per CPU plus one (9 here), below the gateway's concurrency. The deployment guidance is now `connection_limit` at least the expected concurrency (25 in these runs) and below PostgreSQL's `max_connections`.
3. **Per-query events.** The database client asked Prisma for an event on every query, for one duration metric. That cost the query engine noticeable CPU on every statement, so it is now opt-in: `AEGIS_DB_QUERY_METRICS=1`.
4. **The integration's settings JSON is no longer loaded with the tool on the decision path.** In the demo tenant this blob holds the simulated systems' ledgers, about 60 KB each, and was read three times per decision.

The effect of each step, at concurrency 20 with one organization:

| After step | Throughput |
|---|---|
| Before | 7.0/s |
| 1 (lock) | 18.1/s |
| 2 (pool) | 19.2/s |
| 3 and 4 | 21.1/s |

### What proves nothing was weakened

`packages/core/tests/deferred-evidence.test.ts` runs real concurrency against the database. It shows that:
- 30 simultaneous decisions from three agents leave one unbroken, gap-free evidence chain that verifies;
- the same idempotency key sent five times at once creates one request and one execution;
- two agents refunding the same order at the same moment, in five races per run, allow exactly one;
- evidence written at commit has the same shape and verifies;
- a failed transaction leaves no evidence.

It passed 25 consecutive runs after the fix. Before the fix, the race test caught the double refund about once in fifteen runs.

The full core, API and database suites pass. Tenant isolation is unchanged: row-level security and the cross-tenant reference triggers are untouched. Authorization is unchanged: every check, the policy evaluation and fail-closed handling run as before.

### Next steps (not done)

- Fewer queries per decision. An allowed request makes about 77 across five transactions; two of those transactions belong to the simulated downstream system.
- Prisma's TypeScript query compiler, which removes the native engine's CPU cost. It needs its own evaluation.
- A measurement with PostgreSQL, the API and the load generator on separate hosts, and with two API replicas.

## Earlier measurements (before the fix above)

### Targets and measured results

Measured in the development container: 4 vCPU, PostgreSQL 16 on the same host, the demo database after
many test runs (53,000 evidence events, 7,500 action requests). Every figure below was produced by a
command in this repository; nothing is estimated. These are not production numbers.

| Measure | Target | Measured | Result | Command |
|---|---|---|---|---|
| Policy evaluation, 50-rule policy, p95 | 1 ms or less | 156 microseconds (p50 91, p99 236) | met | `pnpm --filter @aegis/core bench` |
| Policy evaluation, 200-rule policy, p95 | none set | 489 microseconds | measured | same |
| Evidence ingestion, one organization | 50 events per second or more | 144 per second (500 sequential appends, one transaction each) | met | same |
| Gateway decision, one request at a time, p95 | 300 ms or less | 220 to 234 ms (p50 184 to 189 ms) | met | `scripts/perf-gateway.mts 100 1` |
| Gateway throughput, one organization | 20 per second | 5.1 to 6.5 per second at concurrency 10 (superseded: see the section above) | missed then; 19.5 to 21.1 per second after the fix | `scripts/perf-gateway.mts 200 10` |
| Gateway latency at concurrency 10, one organization, p95 | none set | 1.95 s (refusals), 2.08 s (allowed transfers including execution) | measured | same |

### Why per-organization throughput is about 5 per second

Decisions for one organization are serialized by its ledger lock, so the evidence chain is strictly ordered.
Concurrency inside one organization therefore queues, and throughput is the reciprocal of one decision's
time under the lock. One decision runs about 47 sequential queries (down from 62 before the optimizations
below). Inside an interactive transaction each costs about 1.6 ms here, measured with
`withTenant` on a bare `SELECT`. The CPU profile of 50 in-process decisions shows the process 95% idle,
waiting on the database. Policy evaluation itself is 0.16 ms of the roughly 180 ms.

Throughput across organizations is not bounded by this lock and grows with replicas and database capacity;
that has not been measured.

The 11 October run (18.8 per second) predates the uncertainty, reasoning, autonomy, injection response,
model governance, exception and integrity stages, each of which adds reads to a decision.

### Optimizations made in this phase (each verified by the full test suite)

- Policy versions for an agent are read in one query instead of one per assignment.
- Organization settings are read once per decision instead of six times (a per-transaction cache that only
  the decision path primes).
- After the first evidence append in a transaction, later appends reuse the chain head they wrote instead of
  taking the lock and reading again. The transaction holds the lock until it commits, so the head cannot
  change.
- Policies are resolved once per decision; the integrity check and the evaluation share them.

### Next steps to reach the throughput target (not done)

- Fold the read-only checks (grants, permissions, counters for velocity rules) into fewer queries.
- Move the evidence append for a decision into a single statement.
- Measure again with PostgreSQL on its own host and a connection pooler.

## Observability

- **Metrics.** `packages/core/src/lib/metrics.ts` records each instrument to OpenTelemetry (exported when `OTEL_EXPORTER_OTLP_ENDPOINT` is set) and to an in-process registry served in Prometheus format. The API serves it at `/metrics`, which needs `AEGIS_METRICS_TOKEN` as a bearer token or, without one, a request from the same host. The worker serves it on `127.0.0.1:AEGIS_WORKER_METRICS_PORT` when that is set. Labels are results, statuses, job types, route groups and system keys, never ids.

| Requirement | Instrument |
|---|---|
| Gateway authorization latency | `aegis_gateway_decision_seconds{result}`, `aegis_gateway_decisions_total{result}` |
| Policy evaluation latency | `aegis_policy_evaluation_seconds` |
| Database performance | `aegis_db_query_seconds` (from the database client's own timing; opt-in with `AEGIS_DB_QUERY_METRICS=1` because it costs CPU on every query) |
| Queue processing time | `aegis_job_seconds{type}`, `aegis_job_wait_seconds{type}`, `aegis_jobs_total{type,outcome}` |
| Integration reliability | `aegis_executions_total{system,outcome}`, `aegis_execution_seconds{system}`, `aegis_destination_deliveries_total{kind,outcome}` |
| Error rates | `aegis_http_requests_total{route,status}`, `aegis_http_request_seconds{route}` |
| Approval delays | `aegis_approval_delay_seconds{decision}` |
| Evidence ingestion throughput | `aegis_evidence_appended_total` |
| Concurrent agent activity | `aegis_gateway_in_flight` |

- **Structured logging.** pino JSON logs with redaction of secrets and tool parameters (`packages/core/src/lib/logger.ts`).
- **Distributed tracing.** Spans `gateway.decide`, `gateway.execute` and `job.run`, exported through OpenTelemetry when configured; evidence events carry the trace id field.
- **Health checks.** `/health` (process), `/ready` (database and queue), System Health per organization, Infrastructure Health for the platform.

## Reliability controls

- **Rate limiting.** Per credential, shared by every replica through PostgreSQL (600 per minute globally, 300 per minute on the gateway).
- **Backpressure.** Each API process decides at most `AEGIS_GATEWAY_MAX_IN_FLIGHT` requests at once (default 64). Beyond that it answers 503 with `Retry-After: 1` at once, decides nothing and runs nothing; the SDK treats it as a refusal.
- **Circuit breakers.** Five ambiguous outcomes in a row from one downstream system open its circuit for 30 seconds. Further executions fail at once, definitively, with nothing sent. Event destinations open after five server errors for 60 seconds, and deliveries wait and retry. Circuits are per process (`packages/core/src/lib/circuit.ts`).
- **Worker recovery.** Jobs left running by a dead worker return to the queue after ten minutes. A job that has used all its attempts that way is dead-lettered instead of looping.
- **Dead-letter queue.** A job that fails its last attempt keeps status `failed` with its last error. It is recorded as a platform event, counted, and listed on Infrastructure Health, where a platform administrator can requeue it.
- **Alerting.** Every five minutes the worker checks: dead-lettered jobs, a job backlog, open circuits, checkpoint lag over 15 minutes, five evaluation errors in 15 minutes, failing deliveries, and executions with an unknown outcome after 30 minutes. Each firing alert is recorded once per hour and posted to `AEGIS_OPS_ALERT_WEBHOOK` when set. Infrastructure Health shows the live list.

## Earlier notes

# Performance notes (development environment, 2026-10-11)

Measured with `scripts/perf-gateway.mts` against the local API (single Node process, PostgreSQL 16 on the same container, worker running). Numbers are indicative for a developer container, not a production benchmark.

| Scenario | Requests | Concurrency | Throughput | p50 | p95 | Errors |
|---|---|---|---|---|---|---|
| Refund tiers (allow, approval, deny mix; all ended as deny because the velocity rule had tripped) | 300 | 10 | 18.8/s | 482 ms | 814 ms | 0 |
| Treasury transfer, allow and execute through the simulated core banking system | 300 | 10 | 12.7/s | 767 ms | 868 ms | 0 |
| Treasury transfer at 20 concurrency | 200 | 20 | rate limited | 21 ms | 73 ms | 200 x HTTP 429 (per-key limit of 300 per minute working as designed) |

## What the first run taught us
The first load test failed badly: 289 of 300 requests timed out at the 15 second transaction limit. Root cause: a read inside the tenant transaction went through the shared connection pool. Under load every pooled connection was held by a transaction waiting for the per-organization lock, so the lock holder waited for a connection that never freed. Fix: no code path may touch the shared pool while a tenant transaction is open; the organization and user tables are now read through the transaction client. A second class of issue, deadlocks between long seeding or monitoring transactions and the request path, is handled by taking the organization lock up front for short request transactions, a lazy lock mode for long jobs, and automatic retry on deadlock or serialization failure.

## Design limits
- Writes for one organization are serialized by an advisory lock so the evidence chain is strictly ordered. Throughput per tenant is bounded by the work done under the lock, about 50 to 80 ms per gateway decision here. Horizontal scaling helps across tenants, not within one.
- Prisma's interactive transaction timeout is 15 s on the request path; a request that waits longer fails closed (HTTP 500, which the SDK treats as deny).
- Production deployments should put PgBouncer or an equivalent pooler in front of PostgreSQL and size the pool above the API's concurrency.

## Not yet measured
Multi-replica API, PostgreSQL on a separate host, sustained runs longer than a minute, and the console under concurrent users.
