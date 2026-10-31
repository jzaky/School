# AEGIS Security Readiness Report

Date: 2026-10-31. Branch `claude/aegis-ai-governance-bgmcnk`, pull request #1 (unmerged).

This report brings together, in one place:
- every security vulnerability found in AEGIS so far;
- how each was resolved and what test guards it;
- what the testing covers and what it does not;
- the risks that remain;
- whether AEGIS is ready to deploy.

The detail stays in the source documents named in each section.

**How to read it.** Every result here comes from AEGIS's own testing: code review, static analysis, attack suites
and a local production-like deployment. None of it is independent.
- A passing test shows that AEGIS resisted that attack, in that environment, at the concurrency tried.
- Thousands of passing requests are evidence of resistance to the attacks tested. They are not proof that AEGIS is
  secure against every attack.
- No certification (SOC 2, ISO 27001 or other) is held or claimed.

## 1. Summary

| | State |
| --- | --- |
| Vulnerabilities found | 15 ranked security findings from the platform audit (S1 to S15), 7 P1 and 16 P2 audit defects, 9 P3 hygiene items, issues from the first SAST scans, 3 from the pull request's CodeQL scan, 11 from enterprise attack validation (E-1 to E-11) and 2 from staging preparation (D-1, D-2). |
| Open | P2-7 is partly fixed (external publishing of evidence checkpoints is not built). P2-14 is in a validation script, not product code. The principal named in a request is still asserted by the agent (P2-3 remainder). |
| Regression tests | Every P1 and every E- and D-finding has a test that fails on the old code. Most P2s do too (section 2). |
| Authorization coverage | API: every route swept cross-tenant; 116 of 132 write routes reached past input validation with synthesized bodies, and 8 of the other 16 are covered by hand-written attacks. Console: all 208 server actions reach their authorization checks. |
| CI | AEGIS CI (lint, typecheck, unit, integration, attack suites, console action tests, browser suite, secret scan, dependency and container scans) and SAST (CodeQL, Semgrep, blocking gate). Green on `6f45fe3`. `2831a28` was running when this was written. |
| GitHub configuration | Owner actions pending: dismiss 6 CodeQL alerts as reviewed, and make the SAST gate a required check (section 6). |
| Staging | Prepared on Fly.io, **not deployed**. Configuration review waiting for the owner's sign-off (`docs/STAGING_CONFIG_REVIEW.md`). |
| Independent pentest | Not done. Pack ready (`docs/PENTEST_READINESS.md`, `docs/PENTEST_RFQ.md`). To be arranged once staging is operational. |

**Verdict:** ready for a **staging** deployment with synthetic data, once the owner signs off the configuration
review. **Not ready for production or customer data** until:
- the independent penetration test is done and its findings are resolved;
- the GitHub security configuration is complete;
- the production items in section 7 are closed.

## 2. Every vulnerability, its resolution and its test

### 2.1 Platform audit: security findings (S-series)

Source: `docs/AEGIS_FULL_PLATFORM_AUDIT.md` section 4. All fixed.

| Id | Finding | Resolution | Test |
| --- | --- | --- | --- |
| S1 | SSO cross-tenant account takeover (unverified domains, email match on global users) | Closed in phase 2 (identity). | SSO and OIDC tests |
| S2 | Escalation to owner by `users:write`; custom roles could carry `org:admin` | Closed in phase 2 (administrator self-escalation). | Org and role tests |
| S3 | Draft policy activated without review; rollback and API bypassed four-eyes | Closed in phases 1 and 2: policy activation needs review. | Policy tests |
| S4 | Integration keys read every request and consumed any grant | Integrations read only their own; grants are bound to the integration (see also P2-2). | Gateway tests |
| S5 | `provideApprovalInfo` had no permission check | Permission check. | Approval tests |
| S6 | Approval bound stored hashes, not re-hashed parameters | Parameters re-hashed at decision. | Approval tests |
| S7 | Console sign-in and two-factor unthrottled; TOTP replay | Codes accepted once; five wrong codes close the session; sign-in attempts limited (see also E-7). | Auth and identity attack tests |
| S8 | Users, sessions, jobs, organizations without row-level security; worker trusted the job payload's org | RLS on all of them; the worker refuses a mismatched org. | `packages/db/tests/platform-isolation.test.ts`, `jobs.test.ts` |
| S9 | Evidence signing optional and untested; no key rotation | Key ring with rotation; production refuses to start without a signing key. | `evidence-signing.test.ts` |
| S10 | Demo reset disabled append-only triggers for all tenants; shared demo password | Trigger allows only a scoped owner delete; platform admin has its own password. | `platform-isolation.test.ts` |
| S11 | Grants hashed with the session secret, not bound to an integration | Own key; bound. | Grant tests |
| S12 | Unknown data classification passed; `__proto__` in trace paths | Unknown classification fails closed; prototype keys refused (see CodeQL below). | Baseline and boundary tests |
| S13 | Report generation on read permission; server paths returned | `audit:write`; no paths. | `audit.test.ts` |
| S14 | Rate limits per process; key suffix as bucket | Limits counted in PostgreSQL across replicas; credentials bucketed by hash. | `jobs.test.ts` |
| S15 | Public form unthrottled; `/ready` leaked database errors | Shared limiter; no error text. | Health and marketing tests |

The audit also left open one item: child rows could reference a parent in another organization. It is now closed
by same-organization reference triggers in `packages/db/prisma/rls.sql`.

### 2.2 Platform audit: defects P1 to P3

Source: `docs/DEFECT_REGISTER.md`. Every P1 had a regression test that reproduced it before the fix.

| Id | Severity | Finding (short) | Status |
| --- | --- | --- | --- |
| P1-1 | P1 | Agent could list other agents' requests via the `agentId` filter | Fixed |
| P1-2 | P1 | Allowed or approved requests executable indefinitely; grants after policy retirement | Fixed (execution window, active policy check) |
| P1-3 | P1 | Settings save could undo an emergency pause or freeze (lost update) | Fixed (merge under row lock) |
| P1-4 | P1 | SCIM could pull another organization's user into a tenant | Fixed |
| P1-5 | P1 | Delegates escaped the delegator's limits | Fixed |
| P1-6 | P1 | API trusted `X-Forwarded-For` from any client | Fixed (private proxies only) |
| P1-7 | P1 | `.dockerignore` missed key and upload files | Fixed (inspection) |
| P2-1 to P2-16 | P2 | Coverage data exposure, unscoped grants, resource binding, lockout atomicity, SAML `InResponseTo` and `RelayState`, execution mode, evidence anchoring, uncertainty escalation, SDK start order, discovery linking, coverage overstatement, delegation revoke, payment matching, a validation script, readiness rule, OPA documentation | Fixed, except P2-7 (partly: external checkpoint publishing open), P2-14 (open, script only) and P2-3 (the principal remains asserted) |
| P3 (9 items) | P3 | Trials, currency decimals, AED defaults, frameworks per kit, unpinned actions, worker image scan, SAST and SBOM, Compose port binding, third-party record | Fixed |

### 2.3 Static analysis

Source: `docs/SAST.md`.

| Found | Resolution |
| --- | --- |
| AES-GCM without a fixed tag length (a truncated tag could be accepted) | `authTagLength: 16`; `crypto.test.ts` (whose tamper test was later made deterministic: it passed by chance in about 1 run in 256) |
| Shell injection in three non-AEGIS workflows | Inputs passed as environment variables |
| Regular expressions with quadratic worst cases | Linear-time code, with timing tests |
| Unescaped value in a regex, weak path check, partial `@` encoding, check-then-write races, unanchored URL patterns | Fixed |
| Unpinned GitHub Actions | All pinned to commit SHAs |
| **Pull request scan:** prototype pollution through policy attribute paths (`context.__proto__.x`) | Prototype keys skipped and per-segment guards; `attack-validation-regressions.test.ts` |
| **Pull request scan:** migration name passed through a shell | Argument list (`execFileSync`) |
| **Pull request scan:** workflows with a writable `GITHUB_TOKEN` | `permissions: contents: read` |
| 6 alerts reviewed as false positives (token and evidence hashing, developer scripts) | In-source suppressions with reasons. The gate accepts them; **the owner dismisses them on GitHub** (section 6). |

### 2.4 Enterprise attack validation

Source: `docs/ENTERPRISE_ATTACK_VALIDATION.md`. Each has a regression test that failed before the fix.

| Id | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| E-1 | P2 | Agent and integration keys could start monitoring runs, which can fire automatic responses | `monitoring:write` required |
| E-2 | P3 | Static catalog routes answered without credentials | Session or authentication required |
| E-3 | P3 | Policy assignments accepted targets outside the organization | Refused |
| E-4 | P3 | Access reviews dropped unknown agents and started empty | Refused |
| E-5 | P3 | Unknown alert acknowledgement answered 500 | 404; record-not-found maps to 404 API-wide |
| E-6 | P3 | NUL or very deep nesting answered 500 (failed closed) | Refused as invalid input at the gateway and for every body |
| E-7 | P2 | Parallel two-factor codes all checked before the failure limit applied | Attempt reserved before checking |
| E-8 | P3 | Core password change left other sessions alive | Other sessions revoked |
| E-9 | P3 | A pause committing during a decision left one fresh grant live | Pause re-checked under lock before commit; evidence flush fix |
| E-10 | P3 | Console actions with foreign ids showed a server error | "Not found in this organization"; proper refusal for Entra sync |
| E-11 | P2 | Open redirect after sign-in (`next=/\evil.example`) | Only same-site paths (`safe-next.ts`) |

### 2.5 Staging preparation

Source: `docs/STAGING_CONFIG_REVIEW.md` section 2.

| Id | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| D-1 | P2 | Seeded personas, the owner among them, used the password published on the site and in the repository, so an internet-facing seed could be opened as owner | `AEGIS_SEED_PERSONA_PASSWORD`, required for staging; the remote check proves the published password is refused; `seed-persona-password.test.ts` |
| D-2 | P3 | Without a token, `/metrics` admits loopback, which behind a proxy rests on the forwarded address | Proxy behaviour tested (spoofed loopback refused); staging requires `AEGIS_METRICS_TOKEN` |

## 3. Test coverage

| Suite | What it attacks or checks | Size |
| --- | --- | --- |
| Core unit and integration (`packages/core`) | Policy, gateway, approvals, execution safety, evidence, identity, SSO, SCIM, Shield, monitoring, security regressions, attack regressions | 563 tests |
| Database (`packages/db`) | Row-level security and platform isolation | 22 tests |
| API attack suites (`apps/api/tests/enterprise-attacks*.test.ts`) | Phase 1: every route swept cross-tenant with spoofed org headers, tool-call manipulation, grant tampering, policy enforcement under pause and suspension. Phase 2: synthesized write bodies, identity and sessions, races. | 16 + 2 + 10 + 6 tests |
| Console server actions (`apps/web/tests/actions`) | All 208 actions: signed out, API keys as credentials, cross-tenant (row fingerprints, leaked ids, foreign references), viewer allow-list, sign-in, sign-out, demonstrations | 9 tests |
| Browser (`apps/web/tests/e2e`) | End-to-end journeys, CSP, permissions in the UI | 141 tests |
| SAST | CodeQL (`security-extended`) and Semgrep, with a blocking gate | Every push |
| Supply chain and secrets | `pnpm audit`, Trivy on the api, worker and web images, CycloneDX SBOMs, Gitleaks over history | Every push |
| Deployment | Production images under Compose: 27 of 27 checks, including role separation, restarts and evidence verification; 141 of 141 browser tests (`docs/DEPLOYMENT_VALIDATION.md`). Staging image with staging settings: 16 of 19, the 3 failures being TLS checks that need Fly (`docs/STAGING_CONFIG_REVIEW.md` section 3). | Run 2026-10-31 |

**Authorization coverage is meaningful, not only input validation:**
- API write routes are attacked with bodies built from each route's own validation errors.
- Every console action is required to get past input validation in both the cross-tenant and the viewer pass;
  the test fails otherwise.
- Every pass checks that denied calls changed no rows (fingerprints of every organization table) and leaked no
  victim ids.

## 4. Coverage gaps

These are the places the independent test should go first (`docs/PENTEST_READINESS.md` section 8a):
- **16 API write routes** were not reached past validation by synthesized bodies. Their input uses unions,
  discriminated types, cross-field rules or file uploads. 8 of them are covered by hand-written attacks; **8 are
  not**.
- **One representative input per action** for the 23 console actions with hand-written arguments, and one
  synthesized body per API route. Other input shapes were not tried.
- **Races** were tried at 6 to 12 concurrent requests on one machine. Other interleavings, more replicas and other
  database settings were not.
- **Not attacked:**
  - the SAML and OIDC protocol exchanges themselves (they have their own tests);
  - the AI gateway's model-provider path;
  - multi-replica behaviour.
- **Known product gap:** splitting a refund into several requests under the per-request limit passes unless a rate
  or volume rule is configured (`docs/ATTACK_SIMULATION_LAB.md`).

## 5. Remaining risks

| Id | Risk | State |
| --- | --- | --- |
| R1 | No independent penetration test | Pack and RFQ ready; scheduled after staging |
| R2 | Six CodeQL alerts not yet dismissed on GitHub, and the SAST gate not yet a required check | Owner action (section 6) |
| R3 | Keys in environment variables, not a KMS or HSM; manual master key rotation (K1, K2) | Documented; the key-vault seam exists, KMS integration is not built |
| R4 | Prompt-injection detection is heuristic (K4) | Signal only; authorization never relies on model output |
| R5 | Egress enforcement for downstream systems depends on the customer's network (K5) | Network policy template only |
| R6 | Document parsing in process, not sandboxed (K6) | Size, type and time limits |
| R7 | Rate limiting not tested against distributed volume (K7) | Shared limits per key and address |
| R8 | Secure execution workspaces not built (K8) | Not claimed in the UI |
| R9 | Console CSP still allows inline styles (K10) | Scripts are nonce-based |
| R10 | Evidence checkpoints are not published outside AEGIS (P2-7) | The verifier takes an expected key and last record |
| R11 | The principal in a request is asserted by the agent (P2-3) | Resources can be bound; principals cannot yet |
| R12 | Images are large (web 5.6 GB) and carry development dependencies | Larger scan surface and slow pulls; pruning recommended before production |
| R13 | Uploads on a single volume: staging is one machine, and production needs object storage | Decision 1 in the staging review |
| R14 | No restore drill on cloud infrastructure; RPO and RTO are unmeasured targets | Local drill recorded (`docs/SECURITY_VALIDATION.md`); Fly drill is in the runbook |
| R15 | Fly has no Gulf region | Staging is synthetic data only. Residency must be settled before a customer pilot (`docs/DEPLOYMENT_OPTIONS.md`). |

## 6. GitHub security configuration (owner)

Pull request #1 stays unmerged until both are done:

1. **Dismiss the six CodeQL alerts** individually, as reviewed false positives. The reason for each is in the
   pull request comment and in `docs/SAST.md`:
   - `tokenDigest` and `tokenMac`;
   - the evidence hash chain;
   - the developer and validation scripts.
2. **Make `SAST gate` a required status check** on the default branch, alongside the AEGIS CI jobs, by branch
   protection or a ruleset.

## 7. Deployment readiness

| Target | Ready? | Conditions |
| --- | --- | --- |
| Local or on-premises evaluation | Yes | `docs/DEPLOYMENT_VALIDATION.md` |
| Fly.io staging, synthetic data | Yes, after sign-off | Owner signs `docs/STAGING_CONFIG_REVIEW.md`, answers its six decisions, and the preflight passes. After deploy: the remote check, the browser suites, and the restart and restore drills. |
| External penetration test | After staging is operational | `docs/PENTEST_READINESS.md`, `docs/PENTEST_RFQ.md`; staging seeded with private persona passwords |
| Production or customer data | No | Pentest done and findings fixed; section 6 done; object storage for replicas; residency decided; KMS or equivalent for keys; images pruned; cloud restore drill with measured times |

## 8. Sources

- `docs/AEGIS_FULL_PLATFORM_AUDIT.md`
- `docs/DEFECT_REGISTER.md`
- `docs/SAST.md`
- `docs/ENTERPRISE_ATTACK_VALIDATION.md`
- `docs/SECURITY_VALIDATION.md`
- `docs/DEPLOYMENT_VALIDATION.md`
- `docs/STAGING_FLY.md`
- `docs/STAGING_CONFIG_REVIEW.md`
- `docs/PENTEST_READINESS.md`
- `docs/PENTEST_RFQ.md`
- `docs/THREAT_MODEL.md`
