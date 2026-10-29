# Pilots

How an entity runs a live AEGIS pilot, in any of the sectors below, from a tested starting point.

- Console: **Pilots** (`/pilots`)
- API: `/v1/pilots` (kits, install, watch-only, report); people only, never agent keys
- Code: `packages/core/src/pilots/` and `packages/core/src/validation/sector-lab.ts`

## Sector kits

Each kit is one agent, its tools and a starting policy, proven case by case in the sector validation
lab (`docs/SECTOR_LAB.md`). Installing a kit creates them in the entity's own organization; the entity
then connects its real agent to the kit's agent (or maps the kit's tools onto its own agent).

| Kit | What it guards against |
|---|---|
| Government finance and procurement | Forged bank-details letters, payments above authority, hidden instructions to the AI |
| Healthcare | Reading or exporting more patient data than a task needs |
| Defence logistics and procurement | Uncleared suppliers, export-controlled items, classified documents going out |
| Energy and utilities | Changes outside the safe operating range, safety systems, switching without a permit |
| Banking and payments | Sanctions matches, new beneficiaries, amounts beyond mandate |
| Aviation and transport | AI certifying airworthiness, passenger data to the wrong party |
| Telecommunications | SIM-swap fraud, bulk subscriber data leaving |
| Education | Changes to published grades, minors' data outside the school |
| Public safety and policing | Record searches without a case, bulk searches, case files leaving the force |
| Government services | Fee waivers and permits beyond policy, citizens' data leaving government systems |
| Ports, customs and logistics | Releasing flagged or controlled cargo, rewriting manifests after arrival |

Policies are starting points. Thresholds, approver roles and allowed destinations are reviewed with
the entity before enforcement. Evidence maps to the UAE Information Assurance Regulation, Dubai ISR,
ISO/IEC 42001 and the NIST AI RMF, plus the UAE PDPL or PCI DSS where relevant.

## Watch-only mode

Kits install their agents in **watch-only mode**. AEGIS decides every action exactly as it would when
enforcing and records the decision, but a policy outcome other than allow does not stop the action:
it proceeds, and the record says what AEGIS would have done (`watch_only:<outcome>` on the request,
`gateway.watch_only_passed` in the evidence ledger, `watchOnly.wouldHave` in the API response).

Never relaxed in watch-only mode:
- unknown agents, tools the agent was not granted, resource and classification limits;
- a paused gateway, an exceeded concurrency limit, a tampered policy;
- data protection blocks and evaluation errors;
- an agent an operator set to autonomy level 0 (observe only).

Security events are still raised for what AEGIS would have stopped, so reviewers see attacks during
the watch period; automatic autonomy downgrades are not applied.

Turning watch-only on relaxes enforcement, so it needs `policies:activate` and a recorded reason.
Turning it off needs `agents:control`. Both are in the evidence ledger. Ordinary agent edits cannot
set it.

## Pilot report

`/pilots` and `GET /v1/pilots/report?from=&to=` give, for a window, from the organization's own records:
actions and their outcomes, actions decided without a person, what watch-only actions would have been,
approvals and the median time to a decision, security events, executions without a valid AEGIS
permission (must be zero) and the result of verifying the evidence ledger.

## Running a pilot

1. **Install AEGIS** in the entity's environment (`docs/OFFLINE_INSTALL.md`) or a UAE-hosted tenant.
2. **Install the sector kit** and agree the success measures shown on the Pilots page.
3. **Watch period (2 to 3 weeks).** The entity's agent runs through AEGIS in watch-only mode. Review
   the report weekly; adjust thresholds with the entity.
4. **Enforce.** Switch the agent to enforcing. Approvers decide held actions in the console.
5. **Report.** Export the pilot report for the window. Results are shared only in the form the entity
   approves.

## Status

The kits, watch-only mode and the report are tested in `packages/core/tests/pilots.test.ts`,
`apps/api/tests/pilots-api.test.ts` and `apps/web/tests/e2e/pilots.spec.ts`. No entity has run a pilot
yet; nothing here is a customer result.
