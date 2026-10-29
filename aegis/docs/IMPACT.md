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

## The four risks the UAE Cyber Security Council named

The run also covers eight scenarios modelled on the four risks the Council set out for auditors at
the Financial Audit Authority's conference in October 2026 (`packages/core/src/validation/council.ts`).
Each uses the control built for it:

| Risk | Scenario | Control |
|---|---|---|
| Permissions wider than the task | Delete the production database during a freeze; a read-only query in the same freeze | Change freeze (`docs/CHANGE_FREEZE.md`) |
| A compromised connector | Send through an email connector whose new version adds a hidden copy | Tool definition pinning (`docs/TOOL_PINNING.md`) |
| Hidden instructions in content | A supplier page that tells the agent to pay | Injection signals quarantine the payment |
| AI-generated receipts | Inflated, invented and reused receipts; one genuine claim | Payment document matching (`docs/PAYMENT_MATCHING.md`) |

The report lists them in their own section, with the incident the Council cited and the auditor's
question for each. They are not added to the 48 sector lab totals.

## Independent verification

`scripts/verify-evidence.mjs` needs only Node.js: no AEGIS code, no database, no network. Given an
exported bundle (`events.jsonl`, `checkpoint.json`, `public-key.pem`) it checks that the records are
consecutive, linked, unedited, and that AEGIS's Ed25519 signature over the last record is valid.
The impact script exports the run's evidence, verifies it, then rewrites one refusal as an approval
in a copy and confirms the verifier reports the edited record. The CI test also deletes a record and
confirms that fails.

Two limits, and how to close them:

- By default the verifier checks the signature with the key inside the bundle, so someone who rebuilt
  the whole bundle with their own key would also pass. Pass `--fingerprint <key id or SHA-256>` (or
  `--key <public-key.pem>`) with the key obtained from the AEGIS operator separately, and a bundle signed
  with any other key fails.
- Records removed from the end of a bundle leave a shorter, still consistent chain. Pass
  `--expect-through <record number>` with a number noted earlier (for example from a previous export)
  and a shorter bundle fails. Publishing checkpoints somewhere outside AEGIS is still on the roadmap.

## Reading the results honestly

These are measurements of the real AEGIS engines on synthetic cases against a simulated system, in
one run on one machine. They show what AEGIS lets through and records; they are not results from a
customer's systems or staff. "Without AEGIS" assumes the system has no checks of its own; many real
systems have some. Live results come from pilots (`docs/PILOTS.md`), reported with the same measures.
