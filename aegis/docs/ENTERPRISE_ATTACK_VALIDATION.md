# Enterprise attack validation

Date: 2026-10-31. Scope: the AEGIS API (`apps/api`) and the core services behind it, attacked as an outside
tenant, a low-privilege user and a compromised agent or integration key. Method: black-box requests through the
real Fastify application and a real PostgreSQL database with row-level security, plus core regression tests for
every fix. This is AEGIS's own testing. It is not an independent penetration test (`PENTEST_RFQ.md`).

Suites:
- `apps/api/tests/enterprise-attacks.test.ts` (16 tests)
- `packages/core/tests/attack-validation-regressions.test.ts` (6 tests)

Both run in CI on every push.

## Set-up

- **Victim organization:** the synthetic sales demonstration, with all six scenarios run. That gives agents,
  tools, policies, action requests, pending approvals, decisions, security events, autonomy changes and evidence.
- **Attacker organization:**
  - an owner (every permission in that organization) and a viewer;
  - agent keys and integration keys holding every scope;
  - a refund agent under the refund policy: up to 500 alone, 500 to 2,500 with an approver, above 2,500 refused,
    and one refund per order.

Every route the application registers is collected at start-up, so a route added later is swept without
editing the test.

## What was attacked, and what held

### Cross-tenant access

**The route sweep.** It covers 236 routes and 3,769 requests from the attacker's owner, agent and integration.
- Every path parameter carries the victim's ids. The owner gets one id of every kind the victim owns, from every
  tenant table.
- Every request also carries the victim's organization id in headers (`x-org-id`, `x-aegis-org`,
  `x-organization-id`), in the query string and in the body.

Checks:
- Every row the victim owns, in every tenant table, is digested before and after. The digests are identical.
- No response contains a victim id that the request did not itself send.
- No request is answered 5xx.
- None is rate limited. An early version was, which made its pass meaningless; the test now fails if that
  happens again. More than 100 requests must succeed, which proves the sessions and keys stayed live.

**Well-formed requests naming the victim's objects.** These use valid bodies, so they reach past input
validation:
- approve a pending approval, with its real request hash;
- request access to the victim's tool;
- delegate to or from the victim's agent;
- emergency-revoke, lower or raise the victim's agent;
- link a discovered agent to it;
- run the lab against it, schedule it, or target it with a custom scenario;
- put it in watch-only mode;
- freeze it, or review its access;
- quarantine or answer the victim's request;
- assign a policy to the victim's agent or team;
- fetch, start or report the victim's request with the attacker's agent key.

All are refused. Nothing in the attacker's organization references a victim object afterwards.

### Authorization bypass

- Without credentials, only the public routes answer 2xx: health, readiness, metrics, sign-in, sign-out,
  registration, password reset and the session check.
- A viewer, an agent key and an integration key sweep every write route. None changes any row, except as
  recorded in an allow-list:
  - a viewer may verify the evidence chain, which records that it ran;
  - a webhook with a bad signature records its rejection.
- An agent key can read only `/v1/agents/me`, its own requests and a static catalog of policy templates.
  Policies, approvals, evidence and the lab stay closed, so a compromised agent cannot read its own thresholds.

### Tool-call manipulation (refund agent key)

- **Type confusion.** The amount sent as a string, array, object, null, boolean, negative, `1e21`, `"1e3"` or
  `" 100"`: never allowed. Over the limit is refused; the approval band is held.
- **Prototype pollution** (`__proto__`, `constructor.prototype`, at the parameter or body level): refused at
  parsing.
- **Duplicate JSON keys:** the last value is the one decided on, stored and bound into the grant.
- **Look-alike tool names** (case, spaces, underscore, NUL, Cyrillic letter, zero-width space): never the refund
  tool.
- **Identity fields in the body** (`agentId` of another agent, the victim's `orgId`, `actor`, `isLab`, and
  `lab`, `approved` or override flags in the context): ignored. The key alone decides who asks, and a request
  over the limit is still refused.
- **An idempotency key replayed with a larger amount:** never a new allow. The stored parameters stay those of
  the first request.
- **Grants:**
  - bound to the parameters: a different amount, order or an extra field is refused;
  - bound to one use: a second verification is refused;
  - one live grant per request;
  - another agent of the same organization cannot fetch one.
- **A held request:** no grant, and the agent's key cannot approve it.
- **A second refund for the same order:** refused.
- **Oversized bodies:** 413.

### Policy enforcement failures

- A paused gateway allows nothing; after resuming, a routine request passes again.
- A suspended agent is allowed nothing.
- Deny, approval and duplicate rules hold through the HTTP path (above).

## Findings and fixes

Each has a regression test that failed before the fix.

| Id | Severity | Finding | Fix |
| --- | --- | --- | --- |
| E-1 | P2 | `POST /v1/assurance/monitoring/run` had no permission check (only the console did). An agent or integration key could start a monitoring run, which raises alerts and can fire continuous-governance automatic responses (suspending agents, pausing the gateway). | The core service requires `monitoring:write` (the scheduler's system context is exempt). |
| E-2 | P3 | Four catalog routes answered without credentials: the lab's built-in scenarios and custom-scenario templates, pilot kits and sector policy templates. They hold no tenant data, but the lab documentation said every lab route needs a signed-in person. | `requirePerson` now also requires a session; the template catalog requires authentication. |
| E-3 | P3 | A policy assignment accepted any id as its agent or team target, including another organization's agent. Row-level security kept the assignment in the attacker's organization, so it applied to nothing, but it was a dangling reference, and a typo in one's own organization failed silently. | The policy and the target must belong to the organization. |
| E-4 | P3 | An access review silently dropped agent ids that were not the organization's and started an empty review, which then blocked starting a real one. | Unknown agent ids are refused. |
| E-5 | P3 | Acknowledging an alert the organization cannot see answered 500. | Not found (404). The API also maps any "record to update not found" database error to 404. |
| E-6 | P3 | A gateway request with a NUL character, or nesting deeper than the database driver accepts (about 100 levels), answered 500. It failed closed: nothing was allowed and nothing was stored. But it was a server error, not a recorded refusal. | The gateway input schema refuses NUL characters and nesting beyond 32 levels (400), checking depth without recursion. As defense in depth, the API refuses any body with a NUL character or nesting beyond 48 levels; the hostile-body sweep showed no other route reached the database with such input even without that check. |

## Limits of this validation

- **Generic bodies.** The route sweep sends generic bodies, so for many write routes input validation answers
  before any lookup (1,458 of the 3,769 requests got 400). The well-formed attacks cover the cross-tenant writes
  judged most valuable. They do not cover every write route.
- **API only.** The console's server actions call the same core services, but they were not swept.
- **Not attacked here:** single sign-on and SCIM protocol flows (they have their own tests), and the model
  provider path of the AI gateway.
- **Known gap.** Splitting a refund into several requests under the per-request limit still passes. This is the
  Attack Simulation Lab's documented gap; a rate or volume rule closes it (`docs/ATTACK_SIMULATION_LAB.md`).
- **Independence.** An independent penetration test is still needed (`PENTEST_RFQ.md`).
