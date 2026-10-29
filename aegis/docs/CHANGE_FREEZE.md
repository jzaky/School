# Change freezes and two-person recovery

During a change freeze, AI agents cannot make changes: no payments, deletions, configuration changes
or anything else above a chosen risk level. Reading stays possible. This answers the incident where
an agent deleted a live database of 1,206 records during an explicit code and action freeze. The
freeze was an instruction to the agent, which the agent could ignore. A freeze in AEGIS is enforced
at the gateway, outside the agent, so the agent cannot ignore it.

- Code: `packages/core/src/gateway/freeze.ts`, applied in `gateway/baseline.ts` and `gateway/gateway.ts`
- Console: Action Gateway page, "Change freezes" panel
- API: `GET/POST /v1/gateway/freezes`, `POST /v1/gateway/freezes/:id/end`, `POST /v1/gateway/freezes/two-person-recovery`
- Tests: `packages/core/tests/change-freeze.test.ts`, `apps/api/tests/freezes-api.test.ts`, `apps/web/tests/e2e/change-freeze.spec.ts`

## What a freeze covers

| Setting | Meaning |
|---|---|
| Starts, ends | The window. A freeze can be scheduled ahead. |
| During the freeze | **Refuse changes**: refused at the door, before any policy runs. **Hold changes for a person**: each change becomes an emergency change that a person must approve. |
| Tools covered | Tools at or above a risk level (every tool, medium and above, high and above, critical only). A tool with an unknown risk level is treated as covered. |
| Agents covered | All agents, or chosen agents. |

A freeze only ever makes an outcome stricter: a request that policy already refuses stays refused.
Watch-only pilot mode and policy exceptions never relax a freeze, because a freeze is an order a
person gave. An agent cannot start or end a freeze: the routes need a signed-in person.

## Evidence

Starting a freeze writes `gateway.freeze_created`, with the window, scope and reason. Ending it early
writes `gateway.freeze_ended`, with who ended it and why. Every refused or held request carries the
freeze's title and reason in its decision record.

## Two-person recovery

When it is on, the person who paused the gateway (the emergency stop) or started a freeze cannot be
the one who resumes the gateway or ends the freeze early. A second person must, with a reason. This
stops one compromised or mistaken account from undoing an emergency control alone. Turning it on or
off needs `org:admin` and is recorded as `gateway.two_person_recovery_set`.

## Permissions

| Action | Permission |
|---|---|
| See freezes | `gateway:read` |
| Start or end a freeze | `agents:control` |
| Pause or resume the gateway, turn two-person recovery on or off | `org:admin` |
