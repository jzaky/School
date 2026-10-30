# Pilot demo: an AI agent attempts a financial action

`scripts/pilot-demo.mts` runs the whole story over HTTP against a running AEGIS API and the synthetic demo tenant:

1. **A small refund (AED 120):** allowed and executed once.
2. **A mid-size refund (AED 1,450):** held for a person. A viewer's approval is refused, the finance approver approves the exact parameters, and the refund executes once with a single-use grant.
3. **The same request with the amount changed:** refused.
4. **A refund above the hard limit (AED 6,200):** denied. The record shows that no call reached the refund system.
5. **The auditor:** reads the evidence for each request and verifies the hash chain and signed checkpoints.

Run it: `npx tsx scripts/pilot-demo.mts`. Set `AEGIS_API_URL` for another host. It exits non-zero if any check fails.

## What is real and what is simulated

| Component | In this demo |
|---|---|
| AEGIS API, Action Gateway, policy engine, approvals, single-use grants | **Real:** production code over HTTP |
| Database, row-level security, evidence ledger and its verification | **Real** |
| People: viewer, approver, auditor | **Real** sign-ins as synthetic demo personas |
| The AI agent | **Simulated.** The script uses the agent's API key. No language model is involved. A real agent would call the same endpoint through the SDK (OpenAI Agents, LangChain, LangGraph, Anthropic tool use, MCP). |
| The refund system | **Simulated** (`support-platform-sim`) by default. If a Stripe **test-mode** integration is connected, the receipt names Stripe instead. Live Stripe keys are refused. |
| Money | **None moves.** |

## Recorded run (14 October 2026, local API, synthetic data)

The full output is in `docs/validation/pilot/pilot-demo-2026-10-14.txt`. Every check passed:

| Step | Outcome |
|---|---|
| AED 120 | Allowed, executed once (simulated refund system) |
| AED 1,450 | Held. The viewer was refused (403). The approver approved and it executed once (simulated refund system). |
| Amount changed under the same request key | Refused (409) |
| AED 6,200 | Denied ("Refunds above AED 2,500 are refused"). No receipt exists, so nothing was sent downstream. |
| Evidence | 4, 4 and 2 events for the three requests. The ledger verified with 3,157 events checked. |

## Presenting it live

1. Open the console as the approver (Lina Mansour) on the Approvals page.
2. Run the script in a terminal beside it. The AED 1,450 request appears in Approvals.

   The script approves it itself. For a live approval click, run steps 1 and 2 separately from the API reference in `docs/API.md` instead.
3. As the auditor (Hana Youssef), open Evidence and verify the ledger on screen.
