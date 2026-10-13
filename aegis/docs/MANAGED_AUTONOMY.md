# Managed autonomy

Phase 3 of the enterprise expansion. Status: implemented and tested in this repository (core, API and browser tests listed below). Not independently reviewed. Not verified in a customer deployment.

The design is AEGIS's own. Its public foundations are listed in `docs/PROVENANCE.md` section 4: the human-automation literature on levels of automation and NIST AI RMF 1.0.

## What it is

Every agent has an **autonomy level from 0 to 4**, stored on the agent and enforced by the Action Gateway on every request, after the policies and data protection have decided.

| Level | Name | What the gateway enforces |
|---|---|---|
| 0 | Observe only | Nothing the agent asks for is executed. The decision records what the policies would have done, so an agent can be evaluated before it acts. |
| 1 | Approve every action | Every action the policies would allow waits for a person. |
| 2 | Low-risk autonomy | Only actions on low-risk tools run without a person, and only up to the agent's amount ceiling. With no ceiling, any action with an amount needs approval. |
| 3 | Bounded autonomy | Actions on high and critical risk tools, and amounts above the ceiling, wait for a person. Other allowed actions run. |
| 4 | Policy autonomy | The active policies decide alone. This is the default, so existing agents behave exactly as before. |

**The rule that keeps levels safe:** a level can only make a decision stricter. It never turns a refusal, a quarantine or a request for information into something looser, and never removes an approval that policy requires. A property test checks this over 2,000 random inputs (`packages/core/tests/autonomy.test.ts`).

**More rules:**
- **Unreadable levels.** A stored level outside 0 to 4 is treated as level 0.
- **Currency.** An amount in another currency than the organization's cannot be compared with the ceiling, so it needs approval at levels 2 and 3.
- **Delegation.** When one agent acts for another, the stricter of the two agents' settings applies.

## Changing a level

| Change | Who | Effect |
|---|---|---|
| Lower the level, or tighten the ceiling | Anyone with `agents:control` | Immediate. Unused execution grants for the agent are voided, so nothing permitted under the old level can still run. Open raise requests are cancelled. |
| Raise the level, or loosen the ceiling | A request by anyone with `agents:control` | Nothing changes until a different person with `agents:control` approves. The requester cannot decide their own request. A request lapses after 72 hours. It is cancelled if the level changes meanwhile. |
| Automatic downgrade | AEGIS, when the organization turns it on | The rules below. Never raises. |

Every change is an `autonomy_transitions` row. The table is append-only through a database trigger, and each row has an evidence event (`autonomy.lowered`, `autonomy.raised`, `autonomy.automatic_downgrade`, `autonomy.raise_requested`, `autonomy.raise_rejected`).

**People only.** An agent can never change its own level. API keys carry no permissions, and every governance-changing API route refuses API keys before reading the request (`apps/api/tests/self-governance.test.ts`).

## Automatic downgrades

Off by default, like continuous governance. An administrator turns them on under Agents, Autonomy. When on:

| Rule | Lowers the agent to |
|---|---|
| A critical security event about the agent | Level 0 |
| A high security event about the agent | Level 1 |
| A burst of refused requests (default 5 in 60 minutes) | One level lower, never below 1, at most once per window |
| An execution whose outcome cannot be confirmed | Level 2 at most |

A downgrade commits in the same transaction as its cause, notifies everyone with `agents:control`, and records the rule and the facts that triggered it.

## Measuring autonomy

**Readiness for a raise.** Five measures over the last 30 days:
- At least 20 decided requests.
- A refusal rate of 5% or less.
- Approvers rejected 5% or less of its requests.
- No high or critical security events.
- No automatic downgrade in the last 14 days.

The measures are a guide shown to the people deciding. They never raise a level by themselves.

**Simulation.** Replays the agent's requests from the last 30 days at another level and ceiling. It reports how many would have run on their own, waited for approval or been refused, against what was recorded. It uses the policy outcome stored with each decision, so it is exact for the level step. It does not re-run policies that have changed since.

**Analytics.** Covers active agents per level, changes in the period by kind, open raise requests, and how many decisions a level made stricter, with the reason for each.

## Where it is

| Layer | Location |
|---|---|
| Rules | `packages/core/src/autonomy/levels.ts` (pure) |
| Service | `packages/core/src/autonomy/service.ts` (changes, downgrades, readiness, simulation, analytics) |
| Gateway | `packages/core/src/gateway/gateway.ts`. The level is applied after policy and data protection, and the result is recorded in each decision's explanation under `autonomy`. |
| Database | Migration `20261014100000_managed_autonomy`. The `agents.autonomy_level` column has a CHECK constraint for the range 0 to 4. |
| API | `/v1/autonomy/...` (`apps/api/src/routes/autonomy.ts`) |
| Console | Agents, Autonomy (overview and settings). The Autonomy tab on each agent (level, change, simulation, raise requests, readiness, history). A column on the agents list. |

## Tests

| Suite | Tests |
|---|---|
| Core | `autonomy.test.ts`, 14 tests |
| API | `self-governance.test.ts`, 13 tests |
| Browser | `autonomy.spec.ts`, 4 tests |

The core tests cover the rules, the property test, the gateway at every level, two-person raises, automatic downgrades, burst limits, append-only history, simulation and analytics.

## Not done

- No per-tool or per-action level overrides. The level applies to the whole agent.
- No time-boxed raises that return to the previous level by themselves.
- The demo tenant keeps automatic downgrades off, because its scenarios must behave the same on every run.
