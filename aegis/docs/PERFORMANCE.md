# Performance and reliability

## Targets and measured results (15 October 2026)

Measured in the development container: 4 vCPU, PostgreSQL 16 on the same host, the demo database after
many test runs (53,000 evidence events, 7,500 action requests). Every figure below was produced by a
command in this repository; nothing is estimated. These are not production numbers.

| Measure | Target | Measured | Result | Command |
|---|---|---|---|---|
| Policy evaluation, 50-rule policy, p95 | 1 ms or less | 156 microseconds (p50 91, p99 236) | met | `pnpm --filter @aegis/core bench` |
| Policy evaluation, 200-rule policy, p95 | none set | 489 microseconds | measured | same |
| Evidence ingestion, one organization | 50 events per second or more | 144 per second (500 sequential appends, one transaction each) | met | same |
| Gateway decision, one request at a time, p95 | 300 ms or less | 220 to 234 ms (p50 184 to 189 ms) | met | `scripts/perf-gateway.mts 100 1` |
| Gateway throughput, one organization | 20 per second | 5.1 to 6.5 per second at concurrency 10 | missed | `scripts/perf-gateway.mts 200 10` |
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
| Database performance | `aegis_db_query_seconds` (from the database client's own timing) |
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
