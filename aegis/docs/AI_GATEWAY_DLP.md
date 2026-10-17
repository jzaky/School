# AI gateway and data loss prevention (Secure S1 and S2)

Status: implemented and tested locally against a fake provider. Not deployed. No real provider has been called.

## What it does

People and internal applications send OpenAI-style chat requests to AEGIS instead of to the model provider:

```
POST {API}/v1/ai/chat/completions
Authorization: Bearer <AEGIS key with the ai:chat scope>
```

For each request AEGIS:

1. Identifies who is asking. A personal key acts as that person, and their role and teams are read from their membership. An application key acts as the application. If the application names a person in the `user` field, AEGIS records that name as a claim; it does not verify it, and it never sends it to the provider. Agent keys cannot hold the `ai:chat` scope; agents act through the action gateway.
2. Finds sensitive data with the organization's data classes. This runs on the AEGIS server with deterministic detectors: checksummed card numbers and IBANs, Emirates ID, secrets and keys, JWTs, private keys, contact details, IP addresses, and custom patterns. No content is sent to any model to decide whether it is confidential.
3. Decides, in this order, each check final:
   - The model is not offered by an approved provider, or the provider is blocked: **block**.
   - The request has images, audio or files AEGIS cannot inspect: **block**.
   - A data class whose action is block or require approval is present: **block**.
   - An AI usage policy fails its integrity check (its stored hash does not match): **block**.
   - The AI usage policies are evaluated by the same policy engine that governs agents (category `ai_usage`, assigned to the organization). An allow is forwarded. A restrict is forwarded with every detected value removed. Deny, quarantine, more-information and approval outcomes **block**. The gateway does not hold requests for approval, and it says so in the reason.
   - With no AI usage policy active, the data classes decide alone. The record says `basis: data_classes_only`.
4. Rewrites values whose class says mask or redact, even when the request is allowed.
5. Sends the request to the provider with the provider key from the credential vault. DNS is pinned and private addresses are refused, as for event destinations. Redirects are not followed.
6. Inspects the answer. Mask and redact classes are rewritten. An answer containing a block class (for example a key) is withheld and replaced with an explanation.

Refused requests get HTTP 403 in the OpenAI error shape, with `type: aegis_policy_block` and a plain-language reason. When the model was the problem, the reason lists the approved models to use instead. Responses carry `x-aegis-decision`, `x-aegis-forwarded` and `x-aegis-event-id` headers.

## What is recorded

Every request writes one row in `ai_gateway_events` and evidence events (`ai_gateway.allow|redact|block`, then `ai_gateway.completed`). The row holds:

- who asked;
- the provider and model;
- the decision, its basis and its reasons;
- the policy versions used;
- the data classes found, with counts, in the prompt and the answer;
- a keyed fingerprint of the prompt (HMAC with a key derived from the deployment master key, so short prompts cannot be found by hashing guesses);
- sizes, the provider status, latency and whether the answer was withheld.

It never holds prompt or answer text.

`forwarded` becomes true only after the provider answered. A block is recorded as not forwarded because the request was not sent, not because a detector fired. A block caused by a data class also raises a security event (`ai_gateway.sensitive_prompt_blocked`). Its title names the classes, never the values.

## Monitor mode

Each organization has a mode: **enforce** (default) or **monitor**. In monitor mode a request the policy would block is still sent, unchanged. The row keeps `decision: block` with `mode: monitor` and `forwarded: true`. The security event is `ai_gateway.sensitive_prompt_monitored`, titled "not blocked". The console shows these as "Would block (monitor mode)" and counts them separately from real blocks. Changing the mode needs `security:write` and a reason, and is recorded as evidence.

## Providers

An approved provider is an integration of type `ai_provider`:

- base URL, HTTPS and public (checked on save);
- the model names it may be used for;
- an API key in the credential vault;
- a declared processing region and retention terms.

The region and retention terms are statements by an administrator. AEGIS shows them as stated and never as verified. Blocking a provider needs `agents:control`; approving one needs `integrations:write`.

Any OpenAI-compatible endpoint works. That includes an organization's own LiteLLM proxy, if it prefers LiteLLM for provider routing and cost tracking.

## Policies

Policies use the normal policy model and lifecycle: drafts, tests, review, activation, assignment and history. There is one engine. The console's new-policy dialog offers an **Employee AI use** template. Input attributes:

| Attribute | Meaning |
|---|---|
| `action.tool` | always `ai.chat` |
| `principal.type` | `user` or `integration` |
| `principal.role` | the person's role key; null for an application |
| `principal.teams` | the person's team keys |
| `principal.claimedUser` | the person an application named; unverified |
| `provider.key`, `provider.approved` | the provider the model resolved to |
| `model` | the requested model |
| `data.classes`, `data.total`, `data.maxSeverity`, `data.blockClasses` | what was found |
| `prompt.chars`, `prompt.messages` | size |

Department rules use `principal.role` or `principal.teams`. The tests include a rule that stops viewers using one model.

## Running it as its own process

`pnpm --filter @aegis/api start:ai-gateway` starts a process that serves only `/health` and `/v1/ai` on `AI_GATEWAY_PORT` (default 4100). Load or a fault in forwarding to providers then cannot affect approvals, policies or the action gateway. The same routes are also mounted on the main API for small deployments.

## Console

**Security, AI Gateway** shows:

- counts for 30 days;
- the mode and a switch;
- approved providers, with approve and block buttons;
- a dry-run check that sends nothing and records nothing;
- the person's own keys (issued for 90 days, shown once, revocable);
- the recent request log.

The demo tenant has a simulated provider and history produced by running real requests through the gateway code. Only the provider is simulated, in-process. The provider is labelled "demo, simulated".

## Tests

- `packages/core/tests/ai-gateway.test.ts` (16) runs against a local HTTP server that stands in for the provider and records every request it receives. The tests show that:
  - blocked prompts never reach it;
  - masked values are masked in what it received;
  - the claimed user is not sent;
  - images and streaming are refused;
  - blocked providers and unapproved models are refused;
  - a secret in an answer is withheld;
  - a restrict policy strips every value;
  - monitor mode sends and records "not blocked";
  - role rules work;
  - a former member's key fails;
  - the dry run records nothing;
  - no row contains the prompt text.
- `apps/api/tests/ai-gateway-api.test.ts` (4) covers:
  - the HTTP contract;
  - refusal of keys without the scope and of agent keys;
  - that the standalone process serves nothing else.
- `apps/web/tests/e2e/ai-gateway.spec.ts` (2) covers the console on a production build.

## Not built yet

These are not claimed:

- **Streaming responses.** They are refused with a clear message.
- **Tokenization.** Reversible replacement of values. Only masking and redaction exist.
- **Exact data matching and document fingerprinting.** There is no matching against a customer's own records, and no semantic or model-based classification. Presidio was evaluated (`docs/OPEN_SOURCE_RESEARCH.md`). It would run as a local sidecar detector; it is not integrated.
- **Holding a request for approval.** The gateway blocks instead.
- **Per-person or per-department rate limits and cost budgets.** The global API rate limit applies, but there is no spend tracking.
- **Warn and allow-with-audit as distinct actions.** Every request is already recorded, so allow is allow-with-audit, but there is no warning shown to the user.
- **Browser, desktop and network coverage.** The gateway sees only requests sent to it. Traffic that bypasses it is the job of Shadow AI discovery (`docs/SHADOW_AI.md`). That reports observations; it does not block.

## LiteLLM

LiteLLM was evaluated as the foundation and not adopted. It is a Python service, so adopting it would put a second runtime and a second policy and guardrail system in the request path. Its enterprise features sit in a separately licensed directory. AEGIS needs its decisions made by the one policy engine it already proves and records. The gateway here is small: parse, inspect, decide, forward, inspect, record. An organization that wants LiteLLM's provider routing can still register its LiteLLM proxy as an approved provider behind AEGIS.
