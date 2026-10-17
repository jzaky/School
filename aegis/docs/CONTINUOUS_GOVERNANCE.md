# Continuous governance

An optional mode, off by default, available on every license tier. It lets AEGIS respond to monitoring alerts on its own, inside limits the organization chose in advance, instead of only notifying a person.

## Two modes

| Mode | What happens when a monitoring rule raises an alert |
|---|---|
| Assisted (default) | People with monitoring access are notified for high and critical alerts. Every containment step (suspend an agent, pause the gateway, disable an integration) is a human decision in the console. |
| Continuous | The response configured for that rule runs immediately, with a system actor, inside the same monitoring run that raised the alert. The result is written to the alert, to the evidence ledger (`governance.auto_response`) and to a notification for every administrator. People remain in charge of reversing it. |

Switching modes or changing a response needs `org:admin` and is recorded in evidence as `governance.mode_changed`.

## Responses

| Response | Target | Effect | Reversal |
|---|---|---|---|
| Notify people only | nobody | Same as assisted mode | not needed |
| Suspend the agent | the agent the alert names | Agent status becomes `suspended`; outstanding execution grants are voided; its pending approvals cannot execute | Resume from the agent page (`agents:control`) |
| Pause the gateway | the organization | Every new request from every agent is denied at the baseline stage; outstanding grants are voided; approving while paused is refused | Resume from Settings or the Action Gateway page (`org:admin`) |
| Disable the integration | the integration the alert names (RM-005 only) | Executions through it fail closed | Re-enable from the integration page (`integrations:write`) |

Automatic responses only ever reduce what agents may do. Nothing in this mode approves, executes or retries an action. The decision path for actions (policy evaluation, approvals, grants) is unchanged.

Which responses are offered per rule:

| Rule | Offered responses | Shipped starting point |
|---|---|---|
| RM-001 repeated denials, RM-002 permission escalation, RM-003 unusual tool usage, RM-004 unexpected transaction volume, RM-008 abnormal activity | notify, suspend the agent, pause the gateway | suspend the agent (RM-003: notify) |
| RM-005 integration failures | notify, disable the integration, pause the gateway | disable the integration |
| RM-010 evidence chain integrity | notify, pause the gateway | pause the gateway |
| RM-006, RM-007, RM-009, RM-011, RM-012 | notify, pause the gateway | notify |

The starting point is offered the first time the mode is switched on; every entry is editable before saving.

## Guarantees

- One response per alert. Alerts are deduplicated by rule and window, so the same situation cannot trigger a response twice; the result is stored on the alert and a second run skips it.
- Skips are recorded too. If the agent is already suspended, the gateway already paused, or the alert names no target, the alert records `outcome: skipped` with the reason, and the administrators are still notified.
- Evidence first. Every applied or skipped response is an evidence event with the rule, the alert, the action, the target and the outcome, written by the system actor.
- No silent failure. If a response throws, the error text is stored on the alert and the monitoring run reports it; the alert itself is still raised.

## Where it lives

- Core: `packages/core/src/governance/continuous.ts` (`readContinuousGovernance`, `setContinuousGovernance`, `applyAutoResponses`, `responseOptionsForRule`, `DEFAULT_AUTO_RESPONSES`). `runMonitoring` calls `applyAutoResponses` for newly raised alerts and reports `autoResponses` in its result.
- Settings stored on the organization: `settings.continuousGovernance = { mode, responses }`. No schema migration.
- Console: Settings, panel "Continuous governance"; Alerts show "Automatic response applied" or "skipped" on the row and the reason in the detail.
- Tests: `packages/core/tests/continuous-governance.test.ts` (4 tests: defaults and validation, assisted mode takes no action, suspend once with evidence and notification then a human resumes, pause once and skip when already paused), `apps/web/tests/e2e/governance.spec.ts` (2 tests: switch on, persist, evidence, switch off; viewer cannot change).

## Not in this mode (planned)

- Responses that act on a specific request (for example, expiring one pending approval) rather than on an agent, the gateway or an integration.
- Time-boxed responses that lift themselves after a period.
- A dry-run mode that records what would have happened without acting.
