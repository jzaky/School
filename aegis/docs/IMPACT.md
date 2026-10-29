# Impact: before and after AEGIS

What the same AI agent requests do to a system without AEGIS and with it, measured, with evidence
anyone can check.

- Run: `pnpm --filter @aegis/core impact`
- Code: `packages/core/src/validation/impact.ts`, `packages/core/scripts/impact.ts`
- In CI: `packages/core/tests/impact.test.ts`
- Latest results: `docs/validation/results/IMPACT_REPORT.md` and `IMPACT_RESULTS.json`
- Evidence for that run: `docs/validation/results/impact-evidence/`

## How it works

Every case of the sector validation lab (`docs/SECTOR_LAB.md`, 11 sectors) is sent twice to a
simulated downstream system that applies the action's effect: money paid, records released, a
setting changed.

- **Without AEGIS:** the request goes straight to the system, which does what it is asked, as it
  would for an agent with direct access.
- **With AEGIS:** the request goes through the real gateway. The system acts only after it verifies
  and consumes AEGIS's single-use permission for exactly those parameters, then reports the result,
  which AEGIS records as a receipt.

The system then tries what an attacker would: acting on a forged permission, and reusing a
permission that was already used. Both must be refused.

Measured from what the system did and from the evidence ledger: harmful actions carried out and
their value, attacks that worked, risky actions done with no person checking, legitimate work
carried out, fields released when policy narrows a request, forged and reused permissions refused,
evidence records written and verified, and the decision time AEGIS adds.

## Independent verification

`scripts/verify-evidence.mjs` needs only Node.js: no AEGIS code, no database, no network. Given an
exported bundle (`events.jsonl`, `checkpoint.json`, `public-key.pem`) it checks that the records are
consecutive, linked, unedited, and that AEGIS's Ed25519 signature over the last record is valid.
The impact script exports the run's evidence, verifies it, then rewrites one refusal as an approval
in a copy and confirms the verifier reports the edited record. The CI test also deletes a record and
confirms that fails.

## Reading the results honestly

These are measurements of the real AEGIS engines on synthetic cases against a simulated system, in
one run on one machine. They show what AEGIS lets through and records; they are not results from a
customer's systems or staff. "Without AEGIS" assumes the system has no checks of its own; many real
systems have some. Live results come from pilots (`docs/PILOTS.md`), reported with the same measures.
