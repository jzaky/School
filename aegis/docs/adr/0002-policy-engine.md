# ADR-0002: Original deterministic policy evaluator, OPA as optional adapter

Status: accepted, 2026-10-10

## Context
See OPEN_SOURCE_RESEARCH.md. OPA and Cerbos are strong, but both need a sidecar and a policy language customers must learn. The enforcement path must be deterministic, explainable and testable.

## Decision
Policies are JSON documents validated by a Zod schema (`packages/core/src/policy/schema.ts`). A policy has ordered rules; each rule has a condition tree over the input document (`agent.*`, `principal.*`, `action.*`, `resource.*`, `params.*`, `context.*`), an effect (`allow`, `deny`, `require_approval`) and, for approvals, approver requirements and an expiry. Combining algorithm: any `deny` wins; otherwise any `require_approval` wins; otherwise an `allow` is needed; otherwise default deny. Evaluation returns a decision plus a trace of every rule with its match result and the resolved operand values.

Policy versions are immutable rows with a content hash. Activation, deactivation and rollback are events, never updates.

An `OpaEvaluator` implements the same interface over OPA's public REST API for customers that already standardise on OPA. It is experimental and off by default.

## Public sources
- OPA documentation for the input/decision model and policy testing concept.
- Cerbos documentation for the readable resource-policy shape.
- XACML combining algorithms (deny-overrides) as a public standard.

No code was copied from any of these.
