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
