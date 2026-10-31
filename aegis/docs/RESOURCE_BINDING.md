# Resource binding

An agent names the resource it acts on in the request's `resource` field, and AEGIS checks its permissions,
classification limit and policies against that resource. The downstream system, though, acts on whatever the
parameters say. Without a binding, an agent permitted on `support-tickets` could name that resource while its
parameters point at `payments-core`. A resource binding rule closes that gap (audit finding P2-3).

It is optional and off until an organization adds rules.

## A rule

```json
{
  "id": "ledger-account-binding",
  "description": "The ledger account a transfer debits must be the resource the agent claims",
  "enabled": true,
  "mode": "audit",
  "scope": { "agentIds": [], "tools": ["initiate-transfer"], "actions": ["transfer"] },
  "param": "fromAccount",
  "match": "mapped",
  "map": { "AE07 0331 2345 6789 0123 456": "payments-core" }
}
```

- `scope`: empty lists mean every agent, tool or action; otherwise the rule applies only to the listed ones.
  Rules are per organization, narrowed by agent, tool and action.
- `param`: a dot path into the request parameters (up to five levels, names only).
- `match`: `exact` (the parameter holds the resource key) or `mapped` (an explicit map from parameter value to
  resource key; any value not in the map is a violation).
- `mode`: `audit` records the result and never blocks; `enforce` refuses a violation at the door.

Every applicable rule is checked; any enforce-mode violation denies the request.

## Outcomes

| Outcome | Meaning | In enforce mode |
| --- | --- | --- |
| `match` | The parameter addresses the claimed resource | Passes |
| `mismatch` | The parameter addresses a different resource | Denied |
| `missing_claim` | The request names no resource | Denied (fail closed) |
| `missing_param` | The parameter is absent, or not a plain string or number | Denied (fail closed) |
| `unmapped` | A mapped rule has no entry for the value | Denied (fail closed) |

## What is recorded

For every decision a rule applied to, in either mode: the rule id and version, the mode, the parameter, the
claimed resource, the actual resource and the outcome. They are in the decision's explanation (Decision
Inspector) and in the decision's evidence event (`resourceBinding` in the payload of `gateway.decision.*`), so
they are in the tamper-evident ledger. An audit-mode violation also adds the risk indicator
`resource_binding:audit_mismatch`. An enforce-mode violation is a `resource_binding_mismatch` baseline failure.
Changing the rules writes a `resource_binding.rules_set` evidence event; a rule's version increases only when
its content changes, so each decision names the exact rule version that applied.

## Why an agent cannot get around it

- The actual resource is read only from the request parameters: the values the downstream system receives and
  the execution grant's hash covers. `context`, the justification and other request metadata are ignored, so an
  agent cannot satisfy a rule by adding fields there (tested).
- Parameter paths read only the parameters' own properties, never inherited ones such as `constructor`.
- Rules live in organization settings that only a person with `policies:activate` can change, through
  `PUT /v1/gateway/resource-bindings`. Agents and integrations are refused, and an ordinary organization settings
  save cannot change or remove the rules (they are a protected setting).
- A rule that applies and cannot be evaluated is a violation, never a pass.

## API

- `GET /v1/gateway/resource-bindings`: the rules (console users).
- `PUT /v1/gateway/resource-bindings` `{ rules: [...] }`: replaces the rules (a person with `policies:activate`).

Tests: `packages/core/tests/resource-binding.test.ts`.

## Limits

- Data protection can rewrite parameters before execution (masking or redaction). The binding is checked on the
  parameters the agent sent; a rule should name a parameter that data protection does not rewrite.
- Rules are configured through the API; there is no console editor yet.
