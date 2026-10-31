# Enterprise attack validation

Date: 2026-10-31. Scope: the AEGIS API (`apps/api`) and the core services behind it, attacked as an outside
tenant, a low-privilege user and a compromised agent or integration key. Method: black-box requests through the
real Fastify application and a real PostgreSQL database with row-level security, plus core regression tests for
every fix. This is AEGIS's own testing. It is not an independent penetration test (`PENTEST_RFQ.md`).

**What the results mean.** A passing test shows that AEGIS resisted that specific attack, in this environment, at the
concurrency tried. Thousands of passing requests are evidence of resistance to the attacks tested. They are not
proof that AEGIS is secure against every attack, and this report claims nothing beyond the attacks listed.

Suites (all run in CI on every push):
- Phase 1:
  - `apps/api/tests/enterprise-attacks.test.ts` (16 tests);
  - `packages/core/tests/attack-validation-regressions.test.ts` (7 tests).
- Phase 2:
  - `apps/api/tests/enterprise-attacks-deep.test.ts` (2 tests);
  - `apps/api/tests/enterprise-attacks-identity.test.ts` (10 tests);
  - `apps/api/tests/enterprise-attacks-races.test.ts` (6 tests).
- Console server actions: `apps/web/tests/actions/console-actions.test.ts` (9 tests).
- Shared world: `apps/api/tests/attack-harness.ts`. Body synthesis: `apps/api/tests/body-synthesis.ts`.

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

## Phase 2 (2026-10-31)

Phase 2 attacked the gaps phase 1 reported.

### Write routes with bodies they accept

In phase 1, 1,458 of 3,769 requests stopped at input validation. In phase 2 each body is built from the route's
own validation errors:
- The API now returns each issue's path, kind and limits (never the values sent).
- A body is filled one round at a time until the route stops answering 400.
- Id-shaped fields get ids chosen by name: the victim's for cross-tenant attacks, the attacker's own for privilege
  attacks.

Results:
- **Cross-tenant, the attacker's owner against all 132 write routes:** 116 got past validation, answering 200
  (14), 201 (8), 401 (9), 403 (6), 404 (78) or 406 (1). The victim's rows were unchanged and no victim id
  leaked. 16 routes still answered 400. The synthesizer cannot build unions, discriminated types, cross-field
  rules or file uploads. Eight of those 16 (assignments, access requests, delegations, the lab schedule,
  watch-only, freezes, discovery resolution, custom scenarios) are covered by phase 1's hand-written valid-body
  attacks.
- **Privilege, with the attacker's own ids, as a viewer, an agent key and an integration key:** every write
  route was tried. Nothing was written outside an explicit allow-list, in which each entry carries its reason:
  - a viewer may verify the evidence chain, run the dry-run inspection and injection checks, and ask for
    software to be assessed;
  - an agent may submit actions and report its own tools' definitions;
  - an integration may report discovered agents, its tools' definitions and payment documents.

  The test also fails on any other table changed or any other kind of evidence recorded.

### Identity and sessions

Held:
- A signed-out session is dead.
- Tampered, forged, truncated and empty session cookies are refused.
- Removal from the organization ends access at once, and a disabled account is refused.
- A session cannot switch into an organization its user does not belong to.
- A single sign-on session cannot switch to another organization of the same user.
- With two-factor sign-in on, a password alone opens nothing.
- Revoked and expired keys are refused at once, and a session cookie does not rescue a bad key.
- An attacker's SCIM provisioning key cannot read, change, deactivate, delete or adopt the victim's users.

Two findings, both fixed (E-7, E-8 below).

### Race conditions

Twelve or six requests are fired at once, and the invariant is checked afterwards. Held:
- Approvers deciding the same approval at once: exactly one decision is accepted, and at most one grant exists.
- One grant verified by many downstream calls at once: consumed exactly once.
- One idempotency key sent with small and large amounts: one stored request, and the large amount is never
  allowed. The losing variants get 409.
- Many refunds for one order at once: at most one allowed.
- An agent starting one granted request many times at once: started once.

One finding, fixed (E-9). The pause test staggers the pause over six delays and requires at least one round in
which decisions landed both before and after it. Its first version always paused first and proved nothing; that
is why the delays were added.

## Console server actions (2026-10-31)

The console does not call the API: its pages call server actions that use the core services directly. The console
has 208 server actions. All of them are attacked, called directly with real sessions against the real database.
Only the Next.js request plumbing (cookies, headers, redirects, cache revalidation) is replaced by small stubs
(`apps/web/vitest.config.ts`). A test fails if any action escapes both groups below.

- **201 in the sweeps.**
  - Arguments are built from each action's own validation errors.
  - The 23 whose input that cannot build (formatted strings, unions, cross-field rules, CSV, JSON documents) get
    arguments written by hand, with every id naming an object of the organization under attack.
  - The test fails if any action still stops at input validation, so every one reaches its lookups and permission
    checks.
- **7 in their own tests.** These end the session or build a demonstration organization: sign-in, the two-factor
  step, sign-out, signing out everywhere, and the three sales-demonstration actions.

What held:
- **Signed out:** every action redirects to sign-in and nothing changes in either organization. Three public forms
  are the exception by design: the marketing form, the language switch and the support form.
- **API keys are not console credentials:** an agent or integration key, sent as a bearer header or as the session
  cookie, opens no action.
- **Cross-tenant:** the attacker's owner, naming the victim's objects in every argument:
  - changed none of the victim's rows;
  - saw no victim id that the call did not send;
  - left no reference (uuid column) in the attacker's own organization pointing at a victim object.
- **A viewer:** with the organization's own ids, a viewer wrote nothing outside an explicit allow-list:
  - their own two-factor enrolment, language, notifications and personal AI key (`ai:chat` only, expiring);
  - reads, exports, previews and dry runs, which record that they ran;
  - a support request and an enterprise pricing enquiry.

  Any other successful action, changed table or kind of evidence fails the test.
- **Sign-in:** the victim's email with a wrong password opens no session.
- **Signing out:**
  - "sign out everywhere" ends the user's other sessions and keeps the one that asked;
  - signing out ends that session too;
  - the victim's sessions are untouched.
- **Sales demonstrations:** refused outside a demonstration organization; no organization is created and the victim
  is unchanged.

Found and fixed: E-10 and E-11.

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
| E-7 | P2 | The two-factor failure limit (5 wrong codes per session) was counted after each code was checked. 20 codes sent at once were all checked (18 counted). With enough source addresses to pass the per-address rate limit, someone holding the password could try far more than 5 codes per session. | Each attempt reserves its place in the count with one conditional update before the code is checked; at the limit the session is closed. |
| E-8 | P3 | Changing a password signed out other sessions only in the console action that called it; the core function did not, so another caller could leave stolen sessions alive. | The core function revokes every other session, keeping only the one named. |
| E-9 | P3 | An emergency pause could commit while a decision was in progress, after the pause had voided every live grant, so one fresh grant survived it. The grant could not be used while paused (consumption re-checks the pause) and an allowed request can be re-granted after a resume by design, so there was no added capability. But the pause did not void every outstanding grant as documented, and its evidence count missed it. | The decision re-checks the pause under the organization lock just before commit and voids its own grant. The evidence ledger also schedules a new flush for evidence appended after an earlier flush in the same transaction, which this fix relies on. |
| E-10 | P3 | In the console, four actions given an id outside the organization (disabling an integration, revoking a credential, renaming a policy) failed with a database "record not found" error. The user saw "Something went wrong" instead of "not found". Nothing changed. Separately, the Entra sync action reported a missing permission as an unexpected error. | The console's action wrapper answers "Not found in this organization" for such errors (as the API does since E-5), and the permission error is a proper refusal. |
| E-11 | P2 | Open redirect after sign-in. The page to open after signing in (`next`) was accepted when it started with one slash and not two, so `/\evil.example` passed; browsers read a backslash there as a slash and go to another site. A link to the real sign-in page could send the user to a look-alike site after they signed in. | Only a path on this site is accepted: one slash followed by neither a slash nor a backslash, with no whitespace or control characters (`apps/web/src/lib/safe-next.ts`). The regression test fails on the old check. |

## Limits of this validation

- **Generic bodies.** Phase 1's route sweep sends generic bodies, so for many write routes input validation answers
  before any lookup (1,458 of the 3,769 requests got 400). Phase 2's synthesized bodies reach 116 of 132 write
  routes past validation; 16 are not reached that way, and 8 of those are covered by hand-written attacks.
- **Race coverage.** The races were tried at 6 to 12 concurrent requests on one machine. Other interleavings, more
  replicas or a different database configuration could behave differently.
- **Console coverage.** All 208 console server actions reach their authorization checks. For the 23 with
  hand-written arguments, each attack uses one representative input per action, not every input shape.
- **Not attacked here:** the SAML and OIDC protocol exchanges themselves (they have their own tests; phase 2
  covered the sessions they produce), password reset (AEGIS has no self-service reset), and the model provider
  path of the AI gateway.
- **Known gap.** Splitting a refund into several requests under the per-request limit still passes. This is the
  Attack Simulation Lab's documented gap; a rate or volume rule closes it (`docs/ATTACK_SIMULATION_LAB.md`).
- **Independence.** An independent penetration test is still needed (`PENTEST_RFQ.md`).
