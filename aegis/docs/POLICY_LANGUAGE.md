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

## Refund policy template

Most refund policies share one shape: an autonomous band, an approval band and a ceiling, plus a few guards. The guided template in `packages/core/src/policy/templates.ts` turns a small set of business settings into an ordinary version 1 document. In the console it is the "Refund policy (guided)" starting document in New policy, and the Thresholds tab on any policy the template generated.

### Settings (`refundTemplateSchema`)

| Field | Meaning | Default |
|---|---|---|
| `tools` | Tool keys the policy applies to (`appliesTo.tools`) | `["issue-refund", "refund-payment"]` |
| `currency` | Currency the thresholds are expressed in; always accepted | `"AED"` |
| `allowedCurrencies` | Further currencies accepted at the same numeric thresholds (no conversion) | `[]` |
| `autoApproveBelow` | Refunds strictly below this amount run autonomously; `0` means nothing runs without a human | `500` |
| `approvalUpTo` | From `autoApproveBelow` up to and including this amount needs approval; above is refused | `2500` |
| `approverRoles`, `minApprovers` (1 to 3), `approvalExpiresMinutes`, `separationOfDuties` | The approval requirement written on every `require_approval` rule | `["approver"]`, `1`, `240`, `true` |
| `blockDuplicates`, `duplicateHandling` | Guard on `context.priorRequestsSameReference > 0`; `deny` or `require_approval` | `true`, `"deny"` |
| `requireReason` | Refuse when `params.reason` is missing or blank | `true` |
| `businessHoursOnly { enabled, startHourUtc, endHourUtc }` | Outside `[start, end)` UTC every refund needs approval; the window may wrap midnight | off, 04:00 to 14:00 |
| `maxDailyDeniedAttempts` | Refuse when `context.deniedCount24h` has reached this value; `0` disables | `0` |

### Generated rules

In evaluation order: `invalid-amount` (deny: amount missing or not positive), `wrong-currency` (deny: `params.currency not_in` the accepted list, so a missing currency is also refused), `missing-reason` (deny: `params.reason missing` or matches `^\s*$`), `duplicate-refund` (deny or require_approval), `too-many-denials` (deny, security event `high`), `autonomous-band` (allow: `0 < amount < autoApproveBelow`), `approval-band` (require_approval: `amount between [autoApproveBelow, approvalUpTo]`), `after-hours` (require_approval: `not` inside the business-hours window) and `above-limit` (deny: `amount > approvalUpTo`, security event `medium`, risk indicator `authority_exceeded`). Guards that are switched off are not emitted. Every rule carries a description, a reason returned to the agent and, for approvals, instructions for the approver. The document also embeds one test per band and guard (`refundSampleRequests`), so submitting for review proves the thresholds behave as described.

### Duplicate detection input

`context.priorRequestsSameReference` is computed by the gateway (`packages/core/src/gateway/input.ts`) as the number of earlier requests in the last 30 days for the same tool and the same business reference (`orderId`, `paymentIntentId`, `chargeId`, `invoiceId`, `ticketId` or `reference`, first present key wins) that were executed, are executing, were approved or are awaiting approval. `context.duplicateReferenceKey` names the field that matched, for approvers. Any policy may use these attributes; the template's `duplicate-refund` rule is one example. The simulator accepts `priorRequestsSameReference` so the guard can be tried without creating real requests.

### Plain language, round trip and editing

`explainRefundPolicy(settings)` returns the bullet points shown in the console ("Refunds below AED 500 run automatically", "Refunds from AED 500 to AED 2,500 need one Approver within 4 hours", "Refunds above AED 2,500 are refused", "A second refund for the same order or payment is refused"). The settings are stored in the document under `meta.template = { id: "refund-v1", settings }`; `meta` is an optional top-level field that the evaluator ignores, so existing documents remain valid. `extractRefundSettings(document)` recognises a generated document and reopens the guided form. The JSON remains fully editable in the Editor tab: hand edits are kept, and the Thresholds tab warns that saving from the form would regenerate the rules. Saving from either tab goes through the same draft, review (embedded tests) and four-eyes activation flow.
