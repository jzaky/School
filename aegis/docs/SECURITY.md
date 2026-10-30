# AEGIS security architecture

## Principles
Fail closed, least privilege, every action attributable, tamper-evident evidence, tenant isolation enforced in the database.

## Identity
- Console users: argon2id password hashes, lockout after 8 failures, server-side sessions (12 hour absolute, 2 hour idle) in HttpOnly Secure SameSite=Lax cookies, TOTP MFA (RFC 6238), per-organization OpenID Connect with PKCE and JIT provisioning limited to allowed email domains. SAML 2.0 (node-saml, signed assertions, audience and validity checks, one-time assertion ids recorded in the database per organisation, so a replay is refused by every replica; service-provider initiated only: the signed assertion must answer the request AEGIS sent (InResponseTo), and the relay state must match a cookie on the browser that started the login, so neither an unsolicited response nor a login started elsewhere is accepted).
- Agents and integrations: API keys `aegis_ak_<prefix>_<secret>`, SHA-256 hashed at rest, shown once, scoped to one subject, revocable, revoked automatically when an agent is revoked.
- Roles: 8 system roles over 22 explicit permissions; custom roles cannot hold the wildcard. Four-eyes rule on policy activation. Separation of duties on approvals (owners of an agent cannot approve its requests).

## Authorization path
Registry checks (agent active, tool granted and enabled, integration active, parameter schema, resource permission, classification, destination allowlist, gateway pause) then Shield inspection then deterministic policy evaluation with default deny. Decisions, approvals and receipts are written in the same transaction as the evidence event; an evidence failure rolls back the decision. Execution grants are single use, five minutes, bound to the SHA-256 of tool, action and parameters; downstream systems verify them. At most one live grant exists per request (partial unique index), consuming a grant moves the request to `executing`, and pause, suspension and revocation void outstanding grants. Execution runs in separate phases from the decision (see AEGIS_ARCHITECTURE.md); an ambiguous downstream outcome is recorded as `unknown` and reconciled from the downstream system's own record by idempotency key, never retried blindly. Only test-mode credentials are accepted for the Stripe connector; live keys are refused at storage and at use.

## Data protection
- Secrets at rest: AES-256-GCM with a data key, ciphertext bound to the row (AAD); each envelope records the id of the key that wrote it (see Key management).
- Logs: pino redaction of credentials and tool parameters; evidence payloads carry hashes and summaries, traces truncate long values.
- Sensitive data in tool parameters: detector registry with mask, redact, block and approval actions (Shield).
- Documents uploaded to Audit never leave the deployment; no external AI calls exist in this version.

## Key management
- `AEGIS_KEY_PROVIDER=env` (default, development and demo): `AEGIS_MASTER_KEY` is the 32-byte data key itself.
- `AEGIS_KEY_PROVIDER=aws-kms` or `azure-keyvault`: `AEGIS_MASTER_KEY` holds the data key wrapped by a key that never leaves the vault (`AEGIS_KMS_KEY_ID`, or `AEGIS_AZURE_KEY_URL` with client credentials or a managed identity). Each process unwraps it once at startup (`initKeyring`) and keeps it only in memory; reading the environment is no longer enough to decrypt stored secrets.
- Wrapping: `pnpm --filter @aegis/core data-key wrap-current --provider aws-kms` wraps the current data key and checks it unwraps.
- Rotating the data key: `data-key new --provider <name>` prints a new wrapped key; set it as `AEGIS_MASTER_KEY` with a new `AEGIS_MASTER_KEY_ID`, move the old one to `AEGIS_PREVIOUS_MASTER_KEYS` (`id:value`), restart, run `data-key rotate --dry-run` and then `data-key rotate`; remove the previous key once the report shows no failures. Rotating only the vault key needs no row changes: re-wrap the same data key.
- Verified by `packages/core/tests/keyring.test.ts` against local stand-ins for AWS KMS (through the AWS SDK, signed requests) and Azure Key Vault, including a full rotation read back through the real readers. Not yet run against a real KMS or Key Vault.

## Tenant isolation
Row-level security on every tenant table, app role `NOBYPASSRLS` and non-owner, transaction-local `app.current_org`, three SECURITY DEFINER functions for the only cross-tenant lookups (API key by hash, memberships by user, invitation by hash). Tests: `packages/db/tests/isolation.test.ts`.

## Integrity
Per-organization SHA-256 hash chain over canonical JSON, UPDATE and DELETE rejected by trigger, Ed25519 checkpoints with the key outside the database, verification API and exports with the public key. Tamper-evident, not immutable: an attacker with the owner role and the signing key could rewrite history; externally stored checkpoints make that detectable.

## Process boundaries
The api, web and worker processes run as the non-owner database role and refuse to start in production if they find `MIGRATION_DATABASE_URL` or `AEGIS_APP_PASSWORD` in their environment (`assertApplicationProcess`). Only the migrate job carries owner credentials. Uploaded documents live on shared storage mounted into every process.

## Network and runtime
Rate limits per key and per IP, body limits, Helmet headers, CORS allowlist, a nonce-based Content-Security-Policy on the console (`script-src 'self' 'nonce-...' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`; tested by `apps/web/tests/e2e/csp.spec.ts`, including that injected inline script does not run), HMAC-signed webhooks with a replay window, non-root containers, Kubernetes network policy template for egress.

## Supply chain checks in CI
Blocking steps in `.github/workflows/aegis-ci.yml`: `pnpm audit --audit-level high` (exceptions and overrides in `pnpm-workspace.yaml`, explained in SOFTWARE_SECURITY.md), a Gitleaks scan of the AEGIS history (`.gitleaks.toml` allowlists only the synthetic secrets in tests), and a Trivy scan of the api and web images that fails on fixable high and critical findings.

## Known gaps (also in THREAT_MODEL.md)
The evidence signing key is still read from an environment variable (the credential vault key can be held by AWS KMS or Azure Key Vault, see Key management); the key-vault providers have been verified against local stand-ins only, not a real KMS or Key Vault; rotation is an operator procedure (`data-key new`, then `data-key rotate`), not automatic; the console Content-Security-Policy still allows inline styles (`style-src 'unsafe-inline'`); network egress enforcement for real downstream systems depends on the customer's platform; prompt-injection detection is heuristic; no independent penetration test has been performed.
