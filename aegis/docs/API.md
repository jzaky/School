# AEGIS API (v1)

Base URL: `API_PUBLIC_URL` (default http://localhost:4000). JSON everywhere. Errors: `{ "error": { "code", "message", "details" }, "requestId" }`.

## Authentication
- Console users: session cookie `aegis_session` (set by `POST /v1/auth/login`).
- Agents and integrations: `Authorization: Bearer aegis_ak_<prefix>_<secret>`. Keys are scoped to one agent or integration and are revoked when the agent is revoked.

## Gateway (agents)
- `POST /v1/gateway/actions` body `{ tool, action?, params, resource?, idempotencyKey, correlationId?, justification?, principal?, context?, executionMode? }`
  - `200` allowed (executed in gateway mode, receipt included), `202` approval required, `403` denied, `409` idempotency conflict, `401` bad key. Non-2xx must be treated as deny by callers.
  - Header `Idempotency-Key` may carry the idempotency key instead of the body.
- `GET /v1/gateway/actions`, `GET /v1/gateway/actions/:id` (agents see only their own)
- `POST /v1/gateway/actions/:id/grant` agent mode: the single live grant for an allowed or approved request. `409` while a grant is outstanding, when the request is already `executing`, or while the gateway is paused. Returns `{ grant, expiresAt, requestHash, params }`; the agent must execute exactly `params`.
- `POST /v1/gateway/actions/:id/execute` agent mode: the agent reports the outcome of its own execution, body `{ grant, outcome: "succeeded" | "failed", reference?, summary? }`. The grant must belong to the request; if the downstream system never verified it, it is consumed here. Idempotent. If the agent does not know whether the call happened it must not report; the gateway reconciles instead.
- `POST /v1/gateway/grants/verify` (integration key) `{ grant, toolKey, action, params }` downstream verification; consuming moves the request to `executing`. `403` when the grant is unknown, expired, consumed, voided (pause, suspension), the agent is inactive, the gateway is paused, or the parameter hash differs. The response carries `reason`.
- Request statuses: `evaluating`, `allowed`, `denied`, `pending_approval`, `approved`, `rejected`, `expired`, `executing`, `executed`, `failed`, `unknown`. Receipt statuses: `succeeded`, `failed`, `skipped`, `unknown`.
- `POST /v1/gateway/approvals/:id/info` answer a request for information

## Approvals (users)
- `GET /v1/approvals?status=pending|approved|rejected|expired|more_info|escalated|all&mine=true`
- `GET /v1/approvals/:id` includes `requestHash`, policy version, evidence timeline and the caller's eligibility
- `POST /v1/approvals/:id/decide` `{ decision: approve|reject|request_info|escalate|reassign, comment, targetUserId?, requestHash }`

## Policies (users)
- `GET /v1/policies`, `POST /v1/policies`, `GET /v1/policies/:id`, `GET /v1/policies/history`
- `POST /v1/policies/:id/versions`, `POST /v1/policies/versions/:versionId/submit`, `POST /v1/policies/versions/:versionId/activate`, `POST /v1/policies/versions/:versionId/rollback`, `POST /v1/policies/:id/deactivate`, `POST /v1/policies/:id/assignments`
- `POST /v1/policies/simulate` `{ document, input }` dry run, records nothing

## Webhooks (integrations)
- `POST /v1/webhooks/:integrationKey` requires the integration API key plus `X-Aegis-Timestamp` (ms epoch, 5 minute window) and `X-Aegis-Signature` (hex HMAC-SHA256 of `timestamp.rawBody` with the integration's webhook secret)

## Health
- `GET /health` liveness, `GET /ready` database and job queue

## SDK
`packages/sdk` wraps the gateway for agents (`authorize`, `waitForApproval`, `getGrant`, `reportExecution`) and downstream systems (`verifyGrantDownstream`). Transport errors are reported as deny.
