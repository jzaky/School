# Sector validation lab

A repeatable test of AEGIS against the kinds of AI agent actions that matter in the sectors the UAE
prioritises. It is the step between unit tests and a real pilot: the real AEGIS engines, realistic
scenarios, synthetic data.

- Code: `packages/core/src/validation/sector-lab.ts`
- Runs in CI: `packages/core/tests/sector-lab.test.ts` (every case must decide as expected)
- Report: `pnpm --filter @aegis/core sector-lab [repeats]` writes
  `docs/validation/results/SECTOR_LAB_RESULTS.md`

## What it runs

One synthetic organization holds an agent, its tools and an illustrative policy for each sector. Each
case is sent through the real gateway: identity and permission checks, policy evaluation, Shield
injection detection (set to quarantine), approvals and the evidence ledger. Nothing downstream is
called; an allowed action ends with a one-time permission. Routine cases are repeated to measure
decision time, and the evidence ledger is verified at the end.

| Sector | The serious problem | What the cases cover |
|---|---|---|
| Government finance and procurement | Forged bank-details letters divert public money; an agent can be told to pay without review | Routine payment, above authority, changed bank account then rejected by a person, hidden instruction to the AI, unregistered vendor |
| Healthcare | Agents pull more patient data than a task needs, or send it out | Treatment read, claim read narrowed to needed fields, no-purpose read, bulk export, export to an outside address |
| Defence logistics and procurement | Uncleared suppliers, export-controlled items, classified documents to the wrong place | Routine order, controlled item, uncleared supplier, classified document out, hidden instruction in a requisition |
| Energy and utilities | Agents tuning plant settings outside the safe range or touching safety systems | Routine tune, larger change, outside the envelope, protection relay, switching without a permit |
| Banking and payments | Sanctioned parties, new beneficiaries, amounts beyond mandate | Routine, above mandate, new beneficiary, sanctions match |
| Aviation and transport | AI certifying airworthiness; passenger data to the wrong party | Border authority report, maintenance sign-off held for certifying staff, open defect, passenger data to a marketing partner |
| Telecommunications | SIM-swap fraud and bulk subscriber data | Verified swap, unverified swap, high-value line, bulk export out |
| Education | Changes to published grades; minors' data outside the school | Draft grade, published grade, record to an outside site |
| Public safety and policing | Record searches with no case, bulk searches, case files leaving the force | Case search, no-case search, bulk search, file to a personal email, hidden instruction in a statement |
| Government services | Fee waivers and permits beyond policy; citizens' data leaving government | Routine permit, permit with open violations, large waiver, data to a private company |
| Ports, customs and logistics | Releasing flagged or controlled cargo; rewriting manifests | Routine release, flagged container, controlled goods, manifest changed after arrival |

The policies are illustrative starting points written for the lab, not sector regulations.

## How to read the results

The report states, for each case, what was expected, what AEGIS decided and what that shows, plus
decision times for routine actions and the ledger verification. These are measurements of the AEGIS
engines on synthetic scenarios. They are **not** results from a customer, a live system or a pilot, and
must not be presented as such. The decision times describe one run on one machine.

## From the lab to real-world results

Real results need a real entity. The plan for each pilot:

1. **Scope.** One agent, one or two tools, one team, in one entity. Agree what counts as success
   before starting (for example: no action executed without a valid permission; share of actions
   decided without a person; approver decision time; attacks caught in the entity's own red-team test).
2. **Shadow mode first.** AEGIS records what it would have decided for two to four weeks without
   blocking anything (policy replay, `docs/POLICY_LANGUAGE.md`). The entity sees the decisions on its
   own traffic before anything changes.
3. **Enforce.** Turn on enforcement for the agreed tools. Approvers work from the console.
4. **Measure from the ledger.** Every figure comes from the evidence ledger, not from manual counts.
5. **Publish with permission.** Results are shared only in the form the entity approves.

Install inside the entity: `docs/OFFLINE_INSTALL.md`. Each sector here is also an installable pilot kit with watch-only mode: `docs/PILOTS.md`.
