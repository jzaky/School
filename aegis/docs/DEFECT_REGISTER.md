# Defect register

Source: the October 2026 repository audit (governance, core security and infrastructure reviews of the code as it
stands, not of the documentation). Every P1 has a regression test that reproduced the defect before its fix.

Severity: P1 = a control can be bypassed or an emergency control undone; P2 = a weakness that needs a second
mistake or an insider to exploit, or a control that is weaker than documented; P3 = hardening and hygiene.

Status: Fixed (with the commit and test), Open (planned, see the implementation matrix), Accepted (documented
limitation, with the reason).

## P1

| ID | Finding | Status | Regression test |
| --- | --- | --- | --- |
| P1-1 | An agent could list other agents' action requests by passing their id as the `agentId` filter: the filter was applied after the agent's own-id restriction and overwrote it. | Fixed: the restriction is applied last. | `packages/core/tests/audit-regressions.test.ts` P1-1 |
| P1-2 | An allowed or approved request stayed executable indefinitely, and a grant could still be issued after a policy that decided it was retired. | Fixed: grants require the request to be inside an execution window (`AEGIS_EXECUTION_WINDOW_MINUTES`, default 60, from the decision or the approval) and every deciding policy version to still be active. A stale request is marked expired, with evidence, and must be submitted again. | P1-2 (two tests) |
| P1-3 | Saving organization settings wrote the whole settings object from the caller's snapshot, so a save started before an emergency pause could resume the gateway or drop a change freeze (lost update). | Fixed: settings are merged under a row lock; gateway pause, freezes and two-person recovery keep their current values and change only through their own functions. A key set to null is removed. | P1-3 |
| P1-4 | SCIM provisioning attached an existing global account to the provisioning organization when the email domain was in that organization's SSO `emailDomains`, which any tenant can set. A tenant could pull another organization's user into its own. | Fixed: SCIM never attaches an existing account; it must accept an invitation, signed in as itself. | P1-4 |
| P1-5 | Under a delegation the delegate escaped the delegating agent's limits: the delegator's destination allow-list, data classification limit and credential expiry were not checked, and the delegator's policies were evaluated with the delegate's attributes (so a rule on the delegator's risk tier never matched). | Fixed: all three limits are checked for the delegator, and its policies are evaluated on its own attributes; the strictest outcome wins. | P1-5 (four tests) |
| P1-6 | The API trusted `X-Forwarded-For` from any client (`trustProxy: true`), so a client could choose its address for rate limiting and the localhost-only metrics check. | Fixed: only loopback, link-local and private-range proxies are trusted by default; `AEGIS_TRUST_PROXY` overrides. | `apps/api/tests/trust-proxy.test.ts` |
| P1-7 | `.dockerignore` did not exclude `.bench-keys.json`, `.uploads/` or `deploy/seed-output/`, which can hold API keys and uploaded documents. | Fixed. | Inspection (no runtime test) |

## P2

Regression tests: `packages/core/tests/audit-p2.test.ts`, plus the files named below.

| ID | Finding | Status |
| --- | --- | --- |
| P2-1 | Enforcement coverage data is readable by any API key, not only administrators. | Fixed: console users with integrations:read only. |
| P2-2 | A grant without an integration scope can be consumed by any integration key in the organization. | Fixed: an integration consumes only a grant issued for it; an unscoped grant cannot be consumed downstream. |
| P2-3 | `resource` and `principal` are asserted by the agent; nothing binds them to the parameters. | Fixed for resources (approved 2026-10-31): optional resource binding rules per organization, agent, tool and action, exact or mapped, audit or enforce mode, fail closed, recorded in the decision and its evidence (`docs/RESOURCE_BINDING.md`, `tests/resource-binding.test.ts`). The principal remains asserted by the agent. |
| P2-4 | Password lockout counting is not atomic; parallel attempts can exceed the limit. | Fixed: each attempt reserves its place with one atomic update before the password is checked. |
| P2-5 | SAML: `InResponseTo` is not checked against an issued request and `RelayState` is not bound to the browser session. | Fixed: the request id is derived from the relay-state nonce and the signed assertion's InResponseTo must equal it; the nonce must match a cookie set on the browser that started the login (`tests/saml.test.ts`). Identity-provider-initiated responses are refused. |
| P2-6 | `issueGrantForRequest` ignores the request's execution mode (a gateway-mode request can be fetched as an agent-mode grant). | Fixed: agent-mode grants only for requests submitted in agent mode. |
| P2-7 | Evidence anchoring: deletion of the newest rows is not detectable without an external anchor, and the verifier trusts the key bundled with the export. | Partly fixed: the verifier takes the expected key (`--key`, `--fingerprint`) and an expected last record (`--expect-through`), and says when neither was given (`tests/impact.test.ts`). Open: publishing checkpoints outside AEGIS. |
| P2-8 | Uncertainty: a low reported confidence does not escalate while a missing one does; agent-supplied evidence is labelled "measured". | Fixed: a figure below the minimum fails, calibrated or not; evidence the agent supplies is labelled as reported by the agent (`tests/uncertainty.test.ts`). |
| P2-9 | SDK agent mode runs the tool before the grant is consumed. | Fixed: new `POST /v1/gateway/actions/:id/start` consumes the grant first; the SDK guard and MCP gateway call it before every tool call (`packages/sdk/tests/adapters.test.ts`). |
| P2-10 | Discovery links shadow agents to registered ones by display name. | Fixed: only the external id matching a slug links automatically; a name match is recorded as a suggestion and the observation stays unregistered. |
| P2-11 | Enforcement coverage overstates (counts tools with any policy as covered). | Fixed: strength comes from observed traffic: a tool with no calls is not_observed, and downstream_verifies needs downstream grant verifications for that tool (`tests/enforcement.test.ts`). |
| P2-12 | Delegation create and revoke need different permissions in a way that lets an agent owner create but not revoke. | Fixed: agents:write or agents:control may revoke. |
| P2-13 | Payment matching: the currency check is skipped when the parameter is missing; a document voided after approval can still be paid; require-approval mode lets duplicates reach a person. | Fixed: a missing currency fails the match; voiding a document voids the live grant and refuses later grants; void and already-paid documents are refused in every mode (`tests/payment-matching.test.ts`). |
| P2-14 | `validate/run.mts` hardcodes Stripe hosts. | Open (validation script only, not product code). |
| P2-15 | Readiness check RM-004 is tied to the demo tool name. | Fixed: the transaction volume rule covers every tool whose calls carry an amount unless a tool key is set. |
| P2-16 | The OPA adapter is present but not wired into decisions; documentation implies it is. | Fixed in documentation (`OPEN_SOURCE_RESEARCH.md`); wiring stays a later milestone. |

## P3

| Finding | Status |
| --- | --- |
| Indefinite trial when no end date is set | Fixed: moving to the trial plan without a date gives the plan's standard 30 days (`tests/commercial.test.ts`). |
| Billing `toMinor` assumes two decimal places | Fixed: amounts and invoices use each currency's ISO 4217 decimals (KWD, BHD, OMR three; JPY none) (`tests/commercial.test.ts`). |
| AED defaults inside core | Fixed: with no organization currency set, no currency mismatch is assumed (gateway and autonomy simulation); the demo tenant sets AED explicitly. The refund template still suggests AED as an editable default. |
| UAE frameworks applied to every pilot kit | Fixed: kits map to ISO/IEC 42001 and NIST AI RMF everywhere; UAE IA, Dubai ISR and the PDPL are added only for an organization whose data residency is the UAE (`tests/pilots.test.ts`). |
| CI actions not pinned by commit SHA | Fixed: every action is pinned to a commit, with the tag in a comment. |
| The worker image is not scanned | Fixed: CI builds and scans the worker image with the API and web images. |
| No SAST or SBOM step in CI | Fixed: CycloneDX SBOMs of the three images; CodeQL and Semgrep on every push and pull request with a blocking gate (`docs/SAST.md`). The first scans found and fixed real issues listed there. |
| Compose publishes ports on all interfaces | Fixed: ports bind to 127.0.0.1 unless `AEGIS_BIND_ADDRESS` is set. |
| `THIRD_PARTY.md` stale on sharp | Fixed: sharp is recorded as a direct core dependency, used by receipt validation. |

## Enterprise attack validation (2026-10-31)

Found by black-box attack suites against the API, phases 1 and 2 (`docs/ENTERPRISE_ATTACK_VALIDATION.md`). Each fix has a regression
test in `packages/core/tests/attack-validation-regressions.test.ts` or `apps/api/tests/enterprise-attacks.test.ts`.

| Finding | Status |
|---|---|
| E-1 (P2) Agent and integration keys could start a monitoring run, which can fire automatic responses | Fixed: `runMonitoring` requires `monitoring:write`. |
| E-2 (P3) Static catalog routes answered without credentials | Fixed: person-only routes require a session; the template catalog requires authentication. |
| E-3 (P3) Policy assignments accepted targets outside the organization | Fixed: policy and target must belong to the organization. |
| E-4 (P3) Access reviews silently dropped unknown agent ids and started empty | Fixed: refused. |
| E-5 (P3) Acknowledging an unknown alert answered 500 | Fixed: 404, and record-not-found database errors map to 404 API-wide. |
| E-6 (P3) NUL characters or very deep nesting in a gateway request answered 500 (failed closed) | Fixed: refused as invalid input at the gateway and, as defense in depth, for every API body. |
| E-7 (P2) Parallel two-factor codes were all checked before the per-session failure limit applied | Fixed: each attempt reserves its place in the count before the code is checked (`enterprise-attacks-identity.test.ts`). |
| E-8 (P3) The core password change left other sessions signed in | Fixed: it revokes every other session (`enterprise-attacks-identity.test.ts`). |
| E-10 (P3) Console actions given an id outside the organization showed a server error instead of "not found" | Fixed: the console's action wrapper maps it to not found; the Entra sync permission error is a proper refusal (`apps/web/tests/actions/console-actions.test.ts`). |
| E-11 (P2) Open redirect after sign-in: `next=/\evil.example` passed the same-site check | Fixed: only a path on this site is accepted (`apps/web/src/lib/safe-next.ts`, `console-actions.test.ts`). |
| E-9 (P3) A pause committing during a decision left that decision's fresh grant live | Fixed: the decision re-checks the pause under the organization lock before commit; evidence appended after a flush is no longer dropped (`enterprise-attacks-races.test.ts`). |

## Documentation drift

Corrected on 2026-10-30: the security page (SAML, key vault, rotation, lockout, execution window, isolation test count, AI calls), the Proof page OSV.dev item, the website integration labels ("Tested against a stand-in" instead of "Sandbox tested"), the backup RPO and RTO (now stated as unmeasured targets), the QuantOS Syft and Trivy rows, and a current-status section in `STATUS.md`.

Found by the audit: counts in `STATUS.md`; the security page's SAML, KMS and key-rotation statements; the Proof page "not yet" item for
OSV.dev (now validated live, see `LIVE_VALIDATION.md`); the roadmap; OPA environment variables; Stripe and Alpaca
labelled "Sandbox tested" where only the fake servers ran in CI; the WAL archiving claim in `BACKUP_RECOVERY.md`;
Syft and cosign statements in `QUANTOS_INTEGRATION.md`.
