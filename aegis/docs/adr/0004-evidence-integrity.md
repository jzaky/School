# ADR-0004: Hash-chained evidence with signed checkpoints

Status: accepted, 2026-10-10

## Decision
Per-organization hash chain over canonical JSON (RFC 8785 style key ordering implemented locally). SHA-256. UPDATE and DELETE on `evidence_events` are rejected by trigger. Ed25519 checkpoints signed with a key from `EVIDENCE_SIGNING_KEY` (never stored in the database). Verification API recomputes the chain and validates checkpoint signatures.

## What this is and is not
Tamper-evident: a modification is detectable by anyone holding the checkpoints. Not immutable: a database owner can rewrite rows; they cannot produce valid signatures without the key, and exported checkpoints make deletion detectable. Documentation and UI use the words "tamper-evident" only.
