# AEGIS security architecture

## Principles
Fail closed, least privilege, every action attributable, tamper-evident evidence, tenant isolation enforced in the database.

## Identity
- Console users: argon2id password hashes, lockout after 8 failures, server-side sessions (12 hour absolute, 2 hour idle) in HttpOnly Secure SameSite=Lax cookies, TOTP MFA (RFC 6238), per-organization OpenID Connect with PKCE and JIT provisioning limited to allowed email domains. SAML is not implemented.
- Agents and integrations: API keys `aegis_ak_<prefix>_<secret>`, SHA-256 hashed at rest, shown once, scoped to one subject, revocable, revoked automatically when an agent is revoked.
- Roles: 8 system roles over 22 explicit permissions; custom roles cannot hold the wildcard. Four-eyes rule on policy activation. Separation of duties on approvals (owners of an agent cannot approve its requests).

## Authorization path
Registry checks (agent active, tool granted and enabled, integration active, parameter schema, resource permission, classification, destination allowlist, gateway pause) then Shield inspection then deterministic policy evaluation with default deny. Decisions, approvals and receipts are written in the same transaction as the evidence event; an evidence failure rolls back the decision. Execution grants are single use, five minutes, bound to the SHA-256 of tool, action and parameters; downstream systems verify them.

## Data protection
- Secrets at rest: AES-256-GCM with the master key, ciphertext bound to the row (AAD).
- Logs: pino redaction of credentials and tool parameters; evidence payloads carry hashes and summaries, traces truncate long values.
- Sensitive data in tool parameters: detector registry with mask, redact, block and approval actions (Shield).
- Documents uploaded to Audit never leave the deployment; no external AI calls exist in this version.

## Tenant isolation
Row-level security on every tenant table, app role `NOBYPASSRLS` and non-owner, transaction-local `app.current_org`, three SECURITY DEFINER functions for the only cross-tenant lookups (API key by hash, memberships by user, invitation by hash). Tests: `packages/db/tests/isolation.test.ts`.

## Integrity
Per-organization SHA-256 hash chain over canonical JSON, UPDATE and DELETE rejected by trigger, Ed25519 checkpoints with the key outside the database, verification API and exports with the public key. Tamper-evident, not immutable: an attacker with the owner role and the signing key could rewrite history; externally stored checkpoints make that detectable.

## Network and runtime
Rate limits per key and per IP, body limits, Helmet headers, CORS allowlist, HMAC-signed webhooks with a replay window, non-root containers, Kubernetes network policy template for egress.

## Known gaps (also in THREAT_MODEL.md)
No SAML; keys in environment variables rather than a KMS; master key rotation is manual; network egress enforcement for real downstream systems depends on the customer's platform; prompt-injection detection is heuristic; no independent penetration test has been performed.
