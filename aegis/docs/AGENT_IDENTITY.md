# Agent identity and access

How AEGIS identifies AI agents, decides what each may do, and how people grant, narrow and remove
that access. Enforcement happens at the Action Gateway (see `UNIVERSAL_GATEWAY.md`).

## The agent record

| Field | Meaning | Enforced where |
| --- | --- | --- |
| Identity | Id, slug, organization, and a workload identity shown as `spiffe://aegis/<org>/agent/<slug>` | API key resolves to exactly one agent |
| Owners | Business and technical owner | Owners cannot approve their agent's requests |
| Purpose | What the agent is for, in business terms | Shown to approvers |
| Environment, model, provider | Where it runs and on what | Policy input (`agent.environment`) |
| Tools | Tool grants, optionally time-limited | Gateway refuses ungranted or expired tools |
| Resources | Permissions with actions, optionally time-limited | Gateway refuses other resources and actions |
| Data classification limit | Highest classification it may touch | Gateway refuses above it; unknown classifications are refused |
| Allowed destinations | Domains it may send to, on top of each tool's own list | Gateway refuses other destinations |
| Authority ends on | Re-certification date | Gateway refuses every request after it |
| Risk tier | low, medium, high, critical | Policy input |
| Approval requirements | Written in policies | Approval routing |
| Versions | Manifest history | Evidence |
| State | draft, registered, active, suspended, revoked, archived | Gateway refuses anything not active |

## Agents never raise their own permissions

Agent API keys carry no console permissions. Every function that changes access (tool grants,
resource permissions, temporary access, delegation, role changes) requires a person with the
matching permission; an agent calling them is refused. This is tested in
`packages/core/tests/agent-identity.test.ts`.

## Temporary access

1. A person with `agents:write` asks for one tool, or for actions on one resource, with a reason and a
   number of hours (at most 14 days).
2. A different person with `agents:control` approves or rejects it. Nobody decides their own request.
3. On approval the grant is created with an end time. The gateway refuses it the moment that time
   passes; the worker then marks the request expired. An approver can end it early.
4. A permanent grant already in force is never shortened by a temporary one.

## Delegation

A person lets one agent act for another, for a set of the delegator's own tools, with optional caps,
for at most 30 days. A delegated request must pass both agents' grants and resource permissions, the
delegation's scope and caps, and both agents' policies. Revocation applies to the next request.

## Least-privilege suggestions

From the last 30 days of requests: tools never requested, resources never touched, actions never
used, a classification limit above anything used, and sensitive access without an end date.
Suggestions only; a person acts on them.

## Emergency revocation

One action suspends or revokes the agent, voids live execution grants, ends delegations in both
directions and temporary access, closes pending approvals and held requests so they can never run,
and on revoke revokes its API keys. Requests already executing downstream are listed for follow-up:
AEGIS cannot undo an action another system has already carried out.

## Discovery

Integrations and deployment pipelines report the agents they see (`POST /v1/identity/discovery/agents`
with an integration key that has `discovery:report`). Known agents are linked automatically; unknown
ones raise a medium security event and wait on the Agent discovery page for a person to link or
dismiss with a reason. Discovery only covers what something reports.

## People: sign-in and provisioning

- Passwords (argon2id, lockout after 8 failures), TOTP two-factor (each code accepted once; five
  wrong codes close the session), sessions (12 h absolute, 2 h idle).
- The organization can require two-factor for every member; without it a member reaches only the
  account page and API calls with their session are refused.
- Single sign-on with OpenID Connect or SAML 2.0. The identity provider must assert a verified email
  (OIDC) or sign the assertion (SAML); the email domain must be one the organization lists; an
  existing account that is not already a member is never attached by email; sessions opened this way
  stay in that organization. SAML assertions must be signed, addressed to AEGIS, inside their validity
  window, and are accepted once.
- SCIM 2.0 (`/scim/v2`) for Microsoft Entra ID and Okta: users join as viewers, groups map to roles,
  owner and administrator are never assigned through SCIM, deprovisioning suspends the membership
  and closes its sessions.
- Roles: nobody grants, removes or creates permissions they do not hold, and nobody changes their own
  role.

## Service identities

API keys belong to an agent or an integration and carry scopes:

| Scope | Allows | Default for |
| --- | --- | --- |
| `gateway:submit` | submit actions, fetch grants, report execution | agents |
| `gateway:read` | read its own requests | agents, integrations |
| `grants:verify` | verify and consume grants issued for its integration | integrations |
| `webhooks:send` | signed webhooks | integrations |
| `discovery:report` | report agents it has seen | integrations |
| `scim:provision` | SCIM provisioning | none (must be granted explicitly) |

A key with no scopes listed has its type's defaults, so keys issued before scopes were enforced keep
exactly the routes they had.

## Concurrent action limits

An agent can be limited to a number of actions in flight at once: set `maxConcurrentActions` in the
agent's metadata. Actions in flight are live, unused execution grants plus executions under way. A
per-agent lock held until the decision commits makes simultaneous requests count one after another, so
they cannot all slip under the limit. Past the limit the request is refused, saying how many are in
flight. Test: `security-regression.test.ts` (five simultaneous requests with a limit of two give exactly two
permissions).

## Credential rotation

Agent API keys are revoked and reissued; a revoked key stops working on the next request. Integration
credentials rotate to a new version and ciphertext, sealed to their record. Test:
`security-regression.test.ts` "credential rotation".

## Limits

- The SAML replay check is kept in each API or web process; several replicas each keep their own.
  The assertion validity window still bounds reuse.
- Email domains listed for single sign-on are not verified through DNS. The membership rules above
  are what prevents cross-organization takeover.
- SCIM supports the subset identity providers use (filters on `userName eq` only, no bulk, no ETags).
- Live verification against Microsoft Entra ID, Okta and a production SAML provider is pending real
  tenants; tests use a local OpenID Connect provider and self-signed SAML assertions.
