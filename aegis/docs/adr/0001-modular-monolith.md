# ADR-0001: Modular monolith with three deployables

Status: accepted, 2026-10-10

## Context
The specification lists twelve services. Building them as separate network services in v1 would multiply the ways the enforcement path can fail open (a timeout between the gateway and the evidence service, for example) and would slow a small team.

## Decision
One TypeScript codebase. Domain modules live in `packages/core` and are only reachable through their service interfaces. Three processes are built from it: `web` (console), `api` (gateway and external API), `worker` (jobs). One PostgreSQL database with row-level security. Redis for rate limiting and live event fan-out only.

## Consequences
- Decision and evidence writes happen in one database transaction. Fail-closed is a property of the transaction, not of retry logic.
- The gateway can be scaled and deployed on its own because it only needs `core` and the database.
- Extracting a module later means wrapping its service interface in a transport; callers do not change.
- Tradeoff: a bug in one module can take down a process that hosts others. Mitigated by health checks, process supervision and the fact that `api` and `web` are separate processes.
