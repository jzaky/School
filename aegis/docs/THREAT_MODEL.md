# AEGIS threat model (v1)

Method: STRIDE over the main trust boundaries. Updated per phase.

## Assets
Policy documents and versions; approval decisions; evidence chain; downstream credentials; agent API keys; customer documents uploaded for assessment; user sessions.

## Trust boundaries
1. Internet to `apps/web` and `apps/api`.
2. Agent (untrusted code, possibly compromised by prompt injection) to the gateway.
3. Gateway to downstream systems (hold credentials).
4. Application role to PostgreSQL (RLS boundary between tenants).
5. Worker to database and notification providers.
6. Platform admin to tenant data.

## Threats and controls

| Id | Threat | Control | Status |
|---|---|---|---|
| T1 | Agent bypasses the gateway and calls the downstream system directly | Downstream simulators require an execution grant issued by the gateway; credentials live only in the vault; guidance for real systems: network egress only through the gateway | Built for simulators; network control is deployment guidance |
| T2 | Agent replays an approved request with changed parameters | `params_hash` bound into the approval; mismatch forces re-evaluation | Built, tested |
| T3 | Expired approval reused | Expiry checked in the same transaction as execution; worker also sweeps | Built, tested |
| T4 | Tenant A reads tenant B data via a forged id | RLS forced on all tenant tables; app role cannot bypass | Built, tested |
| T5 | Prompt injection makes the agent request an unauthorised tool | Authorization uses registered permissions and policies, never model text; injection signals raise security events | Built; detection is heuristic and labelled as such |
| T6 | Sensitive data exfiltrated through an allowed tool | Shield classifies parameters, destination allowlists per tool, block or approval actions | Built |
| T7 | Evidence tampering by an insider with database access | Hash chain plus signed checkpoints, key outside the database, exportable checkpoints | Built; owner-role rewrite is detectable, not prevented |
| T8 | Stolen API key | Hashed at rest, prefix shown once, revocation, per-agent scope, rate limits, suspension kills the key path | Built |
| T9 | Credential stuffing on console login | argon2id, rate limiting per ip and account, optional TOTP, lockout | Built (lockout basic) |
| T10 | Session theft | HttpOnly Secure cookies, server-side sessions, rotation on privilege change, revoke all | Built |
| T11 | Webhook spoofing from a simulated system | HMAC-SHA256 signature with timestamp, constant-time compare, replay window | Built, tested |
| T12 | Secrets in logs | Pino redaction paths; secrets never placed in log objects; tests grep log output | Built |
| T13 | Authorization service down | Gateway returns 503; SDK treats non-200 as deny | Built, tested |
| T14 | Policy evaluation bug or exception | try/catch to deny plus security event | Built, tested |
| T15 | Approver approves their own agent's request (separation of duties) | Rule: requesting agent's owners cannot approve; enforced server side | Built |
| T16 | Document upload used to attack parsers | Size limits, mime allowlist, parsing in a worker with timeout, no shell tools | Built (in-process parsing with timeout) |
| T17 | Uploaded documents sent to third-party AI | No external model calls in the Audit module unless the org enables an AI provider explicitly; default off | Built (no external calls exist in v1) |
| T18 | Platform admin accesses tenant data without trace | Platform module writes platform events for every tenant read | Built |
| T19 | Denial of service on the gateway | Rate limits per key, body size limits, timeouts | Built (basic) |
| T20 | Dependency vulnerabilities | `pnpm audit` in CI, lockfile pinned | CI step defined |

## Known gaps
- No SAML.
- No hardware-backed key storage for the evidence signing key or the credential vault key (environment variable; KMS integration is a documented next step).
- Network-level egress enforcement for real downstream systems depends on the customer's deployment.
- Injection detection is heuristic; false negatives expected; it is a signal, not a guarantee.
