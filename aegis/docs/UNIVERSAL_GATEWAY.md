# Universal Action Gateway

The Action Gateway is the point where AEGIS decides whether an AI agent's action may proceed. This
document covers how agents reach it, the six outcomes, how grants work, delegation, and the limits of
what AEGIS can enforce.

## What AEGIS can and cannot enforce

AEGIS enforces an action only when the action passes through an enforcement boundary AEGIS controls:

1. **The gateway executes the call itself** through a registered connector. The agent never holds the
   downstream credential. This is the strongest path.
2. **The downstream system verifies the grant** (`POST /v1/gateway/grants/verify` with that system's
   integration key) before it acts. An agent that skips AEGIS has no grant, so the system refuses.
3. **A wrapper in the agent's process** (the SDK adapters and the MCP gateway below) asks AEGIS first and
   runs the tool only on allow or restrict. This holds only while the agent cannot reach the tool around
   the wrapper.

An agent that holds a working credential for a system and calls it directly is outside AEGIS. AEGIS does
not claim universal interception. Two controls narrow the gap:

- **Enforcement-path audit** (`packages/core/src/gateway/enforcement.ts`): for every integration whose
  connector can list its own recent operations, each operation is matched to an AEGIS request that was
  authorized and executed through a consumed grant. Operations without an AEGIS request id (made around
  the gateway), with an unknown id, or naming a request AEGIS refused raise a security event. Systems
  that cannot list operations are reported as "not observable", never as clean. The worker runs the
  audit hourly; the console runs it on demand on each integration page; the API exposes
  `POST /v1/gateway/enforcement/:integrationId/audit`.
- **Enforcement coverage** (`GET /v1/gateway/enforcement/coverage`): for each agent and granted tool,
  whether the gateway executes it, a downstream system verifies grants, the agent self-reports, or no
  integration is attached at all.

Connectors that list operations today: the six simulated systems and Stripe test mode (refund metadata
carries the AEGIS request id). Alpaca paper does not yet.

## Outcomes

| Decision | HTTP | Request status | Agent sees |
| --- | --- | --- | --- |
| allow | 200 | allowed, then executed (gateway mode) | receipt, or a grant in agent mode |
| restrict | 200 | allowed, then executed | `restrictions.applied` and `restrictions.params` (use these, not the originals) |
| require_approval | 202 | pending_approval | approval id and expiry |
| request_more_information | 202 | awaiting_information | `moreInformation.fields`; resubmit with the same idempotency key |
| quarantine | 202 | quarantined | security event id; a reviewer must act |
| deny, error | 403 | denied | reasons |

The combining order and policy syntax are in `docs/POLICY_LANGUAGE.md`. Every decision is an
append-only record with the full rule trace, plus an evidence event in the hash chain.

## Execution grants

Grants are single-use, five-minute, signed tokens (`aegis_gr2.<claims>.<signature>`):

- claims: grant id, organization, request id, request hash (sha256 of canonical
  `{toolKey, action, params}`), integration id, expiry, nonce;
- signature: HMAC-SHA256 under a key derived from `AEGIS_MASTER_KEY` for grants only;
- storage: only a keyed hash of the token; the database row is the source of truth for consumed,
  voided and expired state;
- at most one live grant per request (application check plus a partial unique index);
- consuming moves the request to `executing` atomically, so a replayed grant is refused as `consumed`;
- a forged or altered token is refused as `invalid_token` before any lookup;
- a grant is bound to the tool's integration: another integration's key gets `integration_mismatch`;
- pause, agent suspension and revocation void live grants.

A grant is not exactly-once execution. A lost downstream response is handled by the downstream
idempotency key (`aegis:<requestId>`) and reconciliation, documented in `docs/ARCHITECTURE.md`.

## Agent-to-agent delegation

A person with `agents:write` lets one agent act for another (`createDelegation`), for a set of the
delegator's own tools, with optional caps (`maxAmount`) and an expiry of at most 30 days. Agents cannot
create or extend delegations. A delegated request (`onBehalfOf: { agentId }`) must pass:

1. the delegate's own grants and permissions,
2. the delegator's grants and resource permissions,
3. the delegation's tool list and caps,
4. both agents' policies, combined strictest-first.

So a delegate never holds more than either agent. Revocation (`agents:control`) applies to the next
request; actions already executed are not reversed. Every refused delegated request raises an
`authorization.delegation_refused` security event.

## Ways in

| Path | Package | Tested with |
| --- | --- | --- |
| HTTP API | `apps/api` (`POST /v1/gateway/actions`) | `apps/api/tests` |
| TypeScript SDK and `guardedCall` | `packages/sdk` | fake gateway; fail-closed on network error and 5xx |
| OpenAI Agents SDK tools | `aegisOpenAIAgentsTool` | duck-typed tool shape; the SDK itself is not installed |
| LangChain JS tools | `aegisLangChainTool` | duck-typed `invoke`; LangChain is not installed |
| LangGraph tool node | `aegisToolNode` | tool-call arrays as LangGraph produces them |
| Anthropic Messages tool use | `aegisAnthropicToolUse` | `tool_use` and `tool_result` block shapes |
| Plain function calling (Microsoft Agent Framework, others) | `guard`, `aegisFunction` | plain functions |
| Python: CrewAI, AutoGen, Semantic Kernel | `packages/sdk-python` (`crewai_tool`, `autogen_function`, `semantic_kernel_function`, `guard`) | local HTTP stand-in; the frameworks are not installed |
| MCP clients | `packages/mcp-gateway` (`aegis-mcp-gateway -- <server command>`) | a real stdio MCP server process |

"Tested with" is literal: the adapters are tested against each framework's public tool shape, not
against the frameworks themselves. Live verification with each framework is listed as pending in
`docs/AEGIS_BUILD_PROGRESS.md`.

### MCP gateway

`aegis-mcp-gateway` sits between an MCP client and an MCP server over stdio. It exposes only tools.
Each `tools/call` asks AEGIS first and is forwarded only on allow or restrict, with the gateway's
arguments. Refusals return a tool result with `isError: true` and the reason. `--hide` removes tools
from the list and refuses calls to them. Resources, prompts and server-initiated requests (sampling,
elicitation) are refused so nothing reaches the server around the gateway. The client must be
configured to launch the gateway instead of the server; a client that can still start the server
directly is outside AEGIS.

## Who can read what

- Users need `gateway:read` to list or open requests.
- An agent key sees only its own requests.
- An integration key sees only requests routed through its own tools, and consumes only grants
  issued for its integration.
- Only the requesting agent, its owners or an approver may answer an approver's question.
