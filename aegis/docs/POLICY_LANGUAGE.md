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

## Score-band policy template

`packages/core/src/policy/score-band.ts`. The customer's own fraud, risk or confidence model scores each request; the agent sends that score with the request and the template routes it into four bands the business owns. AEGIS never calls the model.

### Settings (`scoreBandTemplateSchema`)

| Setting | Default | Meaning |
|---|---|---|
| `tools` | `["issue-refund"]` | Tool keys in scope |
| `scoreSource` | `context` | Where the agent puts the score: `context.supplied.<attribute>` (the request's free-form `context`) or `params.<attribute>` |
| `scoreAttribute` | `riskScore` | Field name |
| `scale` | `unit` | `unit` is 0 to 1, `percent` is 0 to 100 |
| `reviewFrom`, `holdFrom`, `blockFrom` | 0.40, 0.55, 0.70 | Band boundaries, non-decreasing, within the scale |
| `missingScore` | `deny` | `deny` or `require_approval` when no score is sent |
| `approverRoles`, `minApprovers`, `approvalExpiresMinutes`, `separationOfDuties` | as the refund template | Review band approval |
| `holdExpiresMinutes`, `holdEscalateToRoles` | 60, `[]` | Hold band approvals expire sooner and can escalate |

### Generated rules

`score-missing` (effect per `missingScore`), `score-out-of-range` (deny), `clear-band` (allow, score below `reviewFrom`), `review-band` (require_approval), `hold-band` (require_approval with risk indicators `score_hold` and `hold`, a low security event, shorter expiry and escalation roles; the approver instructions say to place a hold), `block-band` (deny, medium security event). Bands are inclusive at their lower boundary and exclusive at the upper one. A non-numeric score matches no band and falls to the default deny.

### Samples and round trip

`scoreBandSampleRequests` produces one request per band plus missing and out-of-range; they become the document's embedded tests and the console's live preview. `extractScoreBandSettings` reopens the guided form from `meta.template`; `scoreBandDocumentMatchesSettings` detects hand edits. The demo tenant seeds "Refund fraud score routing (example)" active but unassigned, so no demo agent is refused for lacking a score.

## Replay calibration

`packages/core/src/policy/replay.ts`, `replayPolicy(db, ctx, { policyId, document, options: { days, limit } })`. Before activating a draft, see what it would have done: every recorded request for the draft's tools in the last 7, 30 or 90 days (up to a limit, most recent first) is re-evaluated with today's active policy set, the policy being edited replaced by the draft (or the draft added, for a new policy). The result gives counts per outcome before and after, the number of changed outcomes, approvals per day before and after, and the most recent 50 changed requests with the deciding rule. Nothing is written.

Stated approximations: agents are taken as they are today; counts over 24 hours and 30 days (requests, denials, duplicates) are recomputed as of each request's own time; requests refused before policy evaluation are skipped; Shield findings are not replayed. In the console: the Replay tab of a policy (selected version), and a replay panel under both guided forms that uses the unsaved settings when they differ from the stored version.

## Autonomy posture

`packages/core/src/agents/posture.ts`, `postureFromFacts(agent, policies)` and `agentPostures(db, ctx, agents)`. One named level per agent, derived from facts AEGIS already holds, with no new setting: suspended (the agent is not active, every request is refused at the gate), restricted (no tool is granted, or no active policy covers its tools, so the default deny applies), supervised (at least one applicable rule sends requests to a person) and autonomous (applicable rules only allow or refuse; nothing waits for a person). Each posture carries one sentence; for the refund and score-band templates it is the template's own explanation of the bands. Shown as a column on the Agents list and as a row on the agent page. It changes only when the agent's state, its tool grants or the active policies change.

## Boundary sentence

`packages/core/src/policy/boundary.ts`, `boundarySentence({ document, ruleId, params, context, trace, policyKey })`. One sentence on every approval saying which boundary the request was close to, in the policy's own units. Guided templates give exact wording: the refund template states how far the amount sits from the automatic limit and the ceiling (or which prohibited condition matched: duplicate, after hours, wrong currency, missing reason, too many refused attempts); the score-band template states the distance to the next band boundary. Any other policy falls back to the deciding rule's matched comparisons from the stored decision trace, in words ("Matched because amount (250,000) is between 50,000 and 1,000,000"). Context values the request no longer carries are rebuilt from the trace (`contextFromTrace`). Shown in the approval list ("Boundary") and on the approval page under "Why a person is needed".

## Trading template (AEGIS Trading)

`packages/core/src/policy/trading.ts`, template id `trading-v1`. Settings: tools (default
`submit-order`, `place-order`), currency, instrument allowlist, allowed sides, allowed order types,
`maxOrderQty`, `autoApproveNotionalBelow`, `approvalNotionalUpTo`, approver roles, minimum approvers,
approval expiry (default 30 minutes), separation of duties, `blockDuplicates`, `requireReason`,
`marketHoursOnly` (UTC window and whether outside means approval or refusal), `maxDailyLoss` (reads
`context.supplied.dayPnl` as sent by the agent; 0 disables) and `maxDailyOrders` (reads
`context.requestCount24h`; 0 disables).

Generated rules, in order: `invalid-order`, `instrument-not-allowed`, `side-not-allowed`,
`order-type-not-allowed`, `missing-reason`, `duplicate-order`, `daily-loss-cap`, `too-many-orders`,
`oversize-order`, `autonomous-band`, `approval-band`, `outside-market-hours`, `above-ceiling`. The
bands read `params.notional`; the per-order cap reads `params.qty`. Samples cover every band and
guard and become the document's embedded tests. `extractTradingSettings` reopens the guided
"Mandate" tab; `tradingDocumentMatchesSettings` detects hand edits. The boundary sentence and the
autonomy posture use the template's wording. Product context and stated limits: `docs/TRADING.md`.

