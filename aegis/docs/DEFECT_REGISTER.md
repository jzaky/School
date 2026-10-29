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

## P2 (open unless marked)

| ID | Finding | Plan |
| --- | --- | --- |
| P2-1 | Enforcement coverage data is readable by any API key, not only administrators. | Restrict to `gateway:admin`. |
| P2-2 | A grant without an integration scope can be consumed by any integration key in the organization. | Require the tool's integration on consume; refuse unscoped grants for tools that have one. |
| P2-3 | `resource` and `principal` are asserted by the agent; nothing binds them to the parameters. | Optional per-tool binding from a parameter to the resource key; document the trust boundary until then. |
| P2-4 | Password lockout counting is not atomic; parallel attempts can exceed the limit. | Single conditional update. |
| P2-5 | SAML: `InResponseTo` is not checked against an issued request and `RelayState` is not bound to the browser session. | Store issued request ids; bind RelayState to a cookie. |
| P2-6 | `issueGrantForRequest` ignores the request's execution mode (a gateway-mode request can be fetched as an agent-mode grant). | Refuse unless the request was submitted in agent mode. |
| P2-7 | Evidence anchoring: deletion of the newest rows is not detectable without an external anchor, and the verifier trusts the key bundled with the export. | External checkpoint publication; verifier takes the expected public key as input. |
| P2-8 | Uncertainty: a low reported confidence does not escalate while a missing one does; agent-supplied evidence is labelled "measured". | Treat low as at least as strict as missing; relabel as "reported by agent". |
| P2-9 | SDK agent mode runs the tool before the grant is consumed. | Consume first, then execute. |
| P2-10 | Discovery links shadow agents to registered ones by display name. | Link by stable identifiers only; name match becomes a suggestion. |
| P2-11 | Enforcement coverage overstates (counts tools with any policy as covered). | Count only tools whose calls were seen through the gateway. |
| P2-12 | Delegation create and revoke need different permissions in a way that lets an agent owner create but not revoke. | Align: whoever can create can revoke. |
| P2-13 | Payment matching: the currency check is skipped when the parameter is missing; a document voided after approval can still be paid; require-approval mode lets duplicates reach a person. | Fail closed on missing currency; re-check document status at grant time; deny duplicates in every mode. |
| P2-14 | `validate/run.mts` hardcodes Stripe hosts. | Read from the connector configuration. |
| P2-15 | Readiness check RM-004 is tied to the demo tool name. | Check the property, not the name. |
| P2-16 | The OPA adapter is present but not wired into decisions; documentation implies it is. | Correct the documentation now; wiring is a later milestone. |

## P3

Indefinite trial when no end date is set; billing `toMinor` assumes two decimal places; AED defaults inside core;
UAE frameworks applied to every pilot kit; CI actions not pinned by commit SHA; the worker image is not scanned;
no SAST or SBOM step in CI; Compose publishes ports on all interfaces; `THIRD_PARTY.md` is stale (sharp is now a
direct dependency of core, which contradicts the note that the LGPL component is removable).

## Documentation drift

Counts in `STATUS.md`; the security page's SAML, KMS and key-rotation statements; the Proof page "not yet" item for
OSV.dev (now validated live, see `LIVE_VALIDATION.md`); the roadmap; OPA environment variables; Stripe and Alpaca
labelled "Sandbox tested" where only the fake servers ran in CI; the WAL archiving claim in `BACKUP_RECOVERY.md`;
Syft and cosign statements in `QUANTOS_INTEGRATION.md`.
