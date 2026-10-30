# ADR-0003: PostgreSQL job table instead of Temporal or BullMQ in v1

Status: accepted, 2026-10-10

## Decision
`jobs(id, org_id, type, payload, idempotency_key unique, run_at, attempts, locked_at, locked_by, status, last_error)`. The worker claims jobs with `FOR UPDATE SKIP LOCKED`, runs the handler, and marks done or reschedules with backoff. Handlers are idempotent; the unique idempotency key stops duplicate scheduling.

## Why
Approval expiry must be durable and transactional with the approval row. A job row written in the same transaction as the approval request cannot be lost. Redis-backed queues would need an outbox anyway. Temporal is the right tool when AEGIS orchestrates multi-step agent workflows itself; that is deferred.

## Consequences
- At-least-once semantics; every handler checks current state before acting.
- Throughput is bounded by PostgreSQL, which is fine for governance workloads (hundreds of jobs per second is not the design target).
