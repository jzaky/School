# Risk method and register (draft)

## Method

Each risk is scored for **likelihood** and **impact** from 1 (low) to 3 (high). Score = likelihood
times impact.

| Score | Level | Treatment |
|---|---|---|
| 6 to 9 | High | Treat before the next release or pilot; top management tracks it |
| 3 to 4 | Medium | Treat within the quarter, or accept with a recorded reason |
| 1 to 2 | Low | Accept and review yearly |

Treatment options: reduce (add controls), avoid (stop the activity), transfer (contract or insurance),
accept (top management signs). The register is reviewed at least every quarter, after an incident,
and before each customer deployment.

## Register

| ID | Risk | L | I | Score | Treatment | Controls (Annex A) | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| R1 | A vulnerability in AEGIS lets an attacker bypass a customer's controls | 2 | 3 | 6 High | Reduce: security regression suite, fail-closed design, CI scans, independent penetration test | A.8.8, A.8.25 to A.8.29, A.5.35 | Founder | Pen test not yet done |
| R2 | One customer reads another customer's data in a shared deployment | 1 | 3 | 3 Medium | Reduce: row-level security, non-owner app role, isolation tests; offer single-tenant and on-premises | A.8.3, A.5.15 | Founder | Controls in place |
| R3 | Secrets or keys leak from source code or logs | 2 | 3 | 6 High | Reduce: secret scanning in CI, sealed secrets, no personal data in logs, key rotation | A.5.17, A.8.24, A.8.15 | Founder | Controls in place; keep monitoring |
| R4 | A compromised dependency or image enters a release (supply chain) | 2 | 3 | 6 High | Reduce: lockfile, dependency audit and image scan block releases, pinned versions | A.5.21, A.8.8 | Founder | Controls in place |
| R5 | The founder's laptop or accounts are compromised | 2 | 3 | 6 High | Reduce: disk encryption, MFA everywhere, hardware key for code host, patching | A.8.1, A.8.5, A.5.17 | Founder | To do: record device checks |
| R6 | AI-written code introduces a subtle security flaw | 2 | 3 | 6 High | Reduce: tests and CI gates on every change, security review of sensitive changes, penetration test, part-time security reviewer when funded | A.8.28, A.8.29, A.8.30 | Founder | Partly in place |
| R7 | Key-person dependency: only one person can operate and fix AEGIS | 3 | 2 | 6 High | Reduce: documented procedures, scripted installs and recovery; hire when funded | A.5.37, A.5.29 | Founder | Partly in place |
| R8 | Data loss in a hosted environment | 1 | 3 | 3 Medium | Reduce: backups and restore drills; transfer: provider SLA | A.8.13, A.5.30 | Founder | Drill script exists; schedule it |
| R9 | Customer data stored outside the UAE against a requirement | 1 | 3 | 3 Medium | Reduce: residency declarations and checks, UAE hosting or on-premises install | A.5.23, A.5.34 | Founder | Controls in place |
| R10 | Overstated claims in sales material (certification, results) | 2 | 2 | 4 Medium | Reduce: claims checked against the Proof page and this pack before use | A.5.31 | Founder | In place |
| R11 | Penetration test or audit cannot be funded before a buyer requires it | 2 | 2 | 4 Medium | Transfer: include the penetration test in the paid pilot price | A.5.35 | Founder | Planned |
| R12 | Attack techniques against AI agents outpace AEGIS's detectors | 3 | 2 | 6 High | Reduce: policy controls that do not rely on detection (limits, approvals, allowlists), regular review of new techniques, Attack Simulation Lab | A.5.7, A.8.16 | Founder | Partly in place |

**Accepted by:** ____________________ (Founder and CEO)  **Date:** ____________
