# ADR-0004: Hash-chained evidence with signed checkpoints

Status: accepted, 2026-10-10

## Decision
Per-organization hash chain over canonical JSON (RFC 8785 style key ordering implemented locally). SHA-256. UPDATE and DELETE on `evidence_events` are rejected by trigger. Ed25519 checkpoints signed with a key from `EVIDENCE_SIGNING_KEY` (never stored in the database). Verification API recomputes the chain and validates checkpoint signatures.

## What this is and is not
Tamper-evident: a modification is detectable by anyone holding the checkpoints. Not immutable: a database owner can rewrite rows; they cannot produce valid signatures without the key, and exported checkpoints make deletion detectable. Documentation and UI use the words "tamper-evident" only.

## Ordering and concurrency (added 2026-10-11)
Every tenant transaction that may write takes `pg_advisory_xact_lock(hashtext('evidence:' || orgId))` as its first statement (`withTenant`). Appends therefore never race for the next sequence number, and the deadlock observed between a long seeding transaction and the worker (row locks held while waiting for the chain lock) cannot recur. Read-only callers may pass `readOnly: true` to skip the lock. Throughput is bounded to one writing transaction per organization at a time, which is adequate for governance traffic (hundreds of decisions per second per tenant is not the design target).
