# AEGIS development plan and acceptance criteria

## Phases
0. Research and architecture (this folder).
1. Foundation: monorepo, database with RLS, identity, organizations, roles, navigation shell, agent registry, first dashboard.
2. Control: policy schema and evaluator, gateway, approvals, receipts, emergency controls, banking and refund demos, authorization tests.
3. Assurance: evidence chain and verification, governance dashboard from real records, policy history, monitoring rules and alerts, compliance mapping, exports.
4. Shield: detectors and actions, tool security, injection signals and eval corpus, security events and incidents, credential vault and webhook verification, sensitive-data demo.
5. Audit: document ingestion, frameworks and controls, assessments with evidence references, remediation, JSON and PDF reports.
6. Enterprise readiness: OIDC, MFA, OpenTelemetry, Docker Compose, Kubernetes manifests, CI, backup and recovery runbook, security review.
7. Public website and implementation report.

## Acceptance criteria (summary)

### Control
- A denied action returns `deny` and no downstream call is made (asserted on the simulator's ledger).
- A `require_approval` action creates exactly one approval request and does not execute until approved.
- Approval of request R with parameter hash H cannot execute a request with hash H'.
- An approval past `expires_at` moves to `expired` and cannot be used.
- Suspending or revoking an agent causes the next gateway call with its key to fail with 403 before evaluation.
- Duplicate idempotency key returns the original decision without a second execution.
- A policy evaluator exception yields `deny` and a security event.
- A user without the approver role cannot approve (403), and owners of the requesting agent cannot approve it.

### Assurance
- Every gateway step produces an evidence event; `verify` over the chain returns `valid: true`; flipping one byte in one row returns `valid: false` with the first bad sequence.
- Dashboard numbers equal SQL counts over the same tables.
- Policy activation and rollback leave the prior version row unchanged.

### Shield
- A parameter containing a card number is masked, redacted or blocked according to the data class action.
- Sending classified data to a destination outside the tool's allowlist is denied and raises a security event and an incident.
- Injection corpus: every case that asks for an unauthorised tool is denied by the gateway regardless of detection outcome.
- Webhook with a bad signature or stale timestamp is rejected.

### Audit
- PDF, DOCX, TXT and MD upload produce chunks; a control with matching evidence is `covered` or `partial` with a cited excerpt; a control with none is `missing`.
- Reports are generated as JSON and PDF and state whether each finding is automated or human validated.

### Platform
- Tenant isolation test suite passes against the app role.
- Typecheck, lint and all test suites pass; counts reported in STATUS.md.
