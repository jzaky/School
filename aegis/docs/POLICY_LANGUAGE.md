# AEGIS policy language (document version 1)

Policies are JSON documents validated by `packages/core/src/policy/schema.ts` and evaluated by the deterministic evaluator in `packages/core/src/policy/evaluate.ts`. The console renders and edits the same documents.

## Shape

```json
{
  "version": 1,
  "appliesTo": { "tools": ["issue-refund"], "actions": [], "environments": ["production"] },
  "rules": [
    {
      "id": "autonomous-under-500",
      "description": "Autonomous refunds below AED 500",
      "effect": "allow",
      "when": { "all": [ { "attr": "params.currency", "op": "eq", "value": "AED" }, { "attr": "params.amount", "op": "lt", "value": 500 } ] },
      "reason": "Within autonomous refund limit"
    },
    {
      "id": "supervisor-500-2500",
      "effect": "require_approval",
      "when": { "attr": "params.amount", "op": "between", "value": [500, 2500] },
      "approval": { "roles": ["approver"], "minApprovers": 1, "expiresInMinutes": 240, "separationOfDuties": true, "instructions": "Confirm the order exists." },
      "riskIndicators": ["elevated_amount"]
    },
    { "id": "deny-over-2500", "effect": "deny", "when": { "attr": "params.amount", "op": "gt", "value": 2500 }, "reason": "Exceeds authority", "securityEventSeverity": "medium" }
  ],
  "tests": [ { "name": "AED 100 allowed", "input": { "action": { "tool": "issue-refund" }, "params": { "amount": 100, "currency": "AED" } }, "expect": "allow" } ]
}
```

The thresholds above are illustrative and customer-configurable. They are not universal governance rules.

## Combining algorithm
Every rule of every applicable policy is evaluated (the trace is complete, not short-circuited). Then: any matching `deny` wins; otherwise any matching `require_approval` wins; otherwise a matching `allow` permits; otherwise the result is `deny` (default deny). Policies whose `appliesTo` scope does not match are skipped and listed in the explanation.

## Conditions
- `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": ... }`, `{ "always": true|false }`
- `{ "attr": "<path>", "op": "<operator>", "value": ... }`

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between` (value `[low, high]`, inclusive), `in`, `not_in`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches` (case-insensitive regular expression, max 200 chars), `exists`, `missing`, `domain_in`, `domain_not_in` (value is a list of domains, `*.example.com` allowed; works on URLs and email addresses), `subset_of`, `intersects`.

Comparisons never throw. A type mismatch evaluates to false, which under default deny is the safe direction.

## Input document
Built per request by `packages/core/src/gateway/input.ts`:

| Path | Meaning |
|---|---|
| `agent.id`, `agent.slug`, `agent.status`, `agent.environment`, `agent.riskTier`, `agent.dataClassificationLimit`, `agent.teamId`, `agent.tools[]`, `agent.version` | The requesting agent from the registry |
| `principal.type`, `principal.userId`, `principal.ref` | On whose behalf the agent acts |
| `action.tool`, `action.name`, `action.riskLevel`, `action.integration` | The tool and action |
| `resource.key`, `resource.type`, `resource.classification`, `resource.permittedActions[]` | Target resource (null when none) |
| `params.*` | Tool parameters, after schema validation |
| `context.time`, `context.hour` (UTC), `context.weekday`, `context.ip`, `context.requestCount24h`, `context.deniedCount24h`, `context.approvalsPending`, `context.destinationDomain`, `context.amount`, `context.currency`, `context.supplied.*` | Derived and caller-supplied context |
| `shield.dataClasses[]`, `shield.highestSeverity`, `shield.injectionSignals[]`, `shield.blocked` | Shield inspection results |

Before policies run, the gateway performs structural checks that are not policy: agent active, tool enabled and granted, integration active, parameters valid against the tool schema, resource permission present and unexpired, classification within the agent's limit, destination inside the tool's allowlist, gateway not paused. Any failure is a deny with a reason code.

## Lifecycle
Draft -> Review (embedded tests must pass) -> Active (four-eyes: the author cannot activate) -> Retired. Documents of non-draft versions are frozen by a database trigger. Rollback creates a new version from an old document; nothing is overwritten. Every transition writes a `policy_events` row and an evidence event.

## Explanation
Every decision stores the deciding rule, every evaluated rule with its comparisons (expected, actual, result), skipped policies, the policy version ids and the latency. Long values are truncated in the trace so evidence never stores entire payloads.
