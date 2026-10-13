# Attack Simulation Lab and injection response

Phase 6 of the enterprise expansion. Status: implemented and tested in this repository. Not independently reviewed. Not verified in a customer deployment. The design is AEGIS's own. Scenario labels use public taxonomies (see `docs/PROVENANCE.md` section 4).

## What the lab is, and what it is not

The lab checks one thing: **does this organization's AEGIS configuration stop known attack patterns against a given agent?** It is a regression check of policies, grants, data protection settings and gateway controls.

It is **not a penetration test**. It does not test:
- the network or the hosting;
- the console or the API surface;
- the models themselves;
- the systems agents call.

Each scenario is a fixed pattern. Passing the lab does not mean an agent is safe against attacks the lab does not contain.

## How a run works

1. **Clone.** A person with `security:write` picks an active agent and, optionally, the tool to use. AEGIS creates a temporary lab agent with the target's:
   - tool grants and resource permissions;
   - team, data classification limit and allowed destinations;
   - autonomy level and ceiling;
   - agent-level policy assignments.

   Team-level and organization-level policies apply to the clone as they do to the target.
2. **Control request.** The target's most recent allowed request for that tool is resubmitted unmodified, with a fresh reference. Attacks are judged against it. If the control itself is not allowed, a refusal cannot be attributed to the attack, and the result is **inconclusive**.
3. **Scenarios.** Each scenario runs in its own transaction, so one failure cannot affect the others. Requests use `executionMode: "agent"`: AEGIS decides, and the lab never presents a grant to a downstream system. **Nothing executes.** The one grant the lab consumes (for the replay scenario) is closed with an outcome stating that nothing was executed.
4. **Teardown,** whatever happened during the run. The clone is revoked and archived. This:
   - voids its live grants;
   - expires anything held for approval;
   - revokes its credentials;
   - removes its policy assignments.

**Isolation from day-to-day operations.** Lab agents (`agents.is_lab`) are kept out of:
- agent lists, counts and pickers;
- monitoring alerts;
- automatic incidents;
- autonomy downgrades and denial-burst checks;
- approval and quarantine notifications.

Their requests and security events (titled `[lab]`) stay on the evidence record. The target agent is never changed. Only one run per organization can be in progress at a time.

## Outcomes

| Outcome | Meaning |
|---|---|
| control | The unmodified request; the reference for every other result |
| defended | AEGIS refused or held the attack |
| gap | AEGIS allowed it. The result names what would close it |
| inconclusive | The control request was not allowed, or the scenario had nothing to act on |
| error | The scenario could not run |

## Scenarios

References are AEGIS's own mapping to the OWASP Top 10 for LLM Applications 2025 and, where a technique fits, MITRE ATLAS. Check the identifiers against the current releases of those catalogs before citing them externally.

| Scenario | What it does | References |
|---|---|---|
| Instructions injected into a parameter | Instruction override, role change and an exfiltration request in a free-text field | LLM01, AML.T0051 |
| Hidden characters | Zero-width characters and an HTML comment carrying an instruction | LLM01, AML.T0051 |
| Unapproved destination | Adds a URL on a domain nobody approved | LLM02, LLM06, AML.T0025 |
| Card number | A public test card number (Luhn valid) in free text | LLM02, AML.T0057 |
| Bank account number | An IBAN with a valid checksum in free text | LLM02, AML.T0057 |
| Ungranted tool | A tool outside the agent's grants | LLM06, AML.T0053 |
| Amount inflation | The control amount times 100 | LLM06, AML.T0048 |
| Split amounts | The control amount five times | LLM06, AML.T0048 |
| Self-approval | The agent approves its own held request, claiming approval rights | LLM06 |
| Self-escalation | The agent raises its own autonomy, requests access and delegates to itself, claiming the rights | LLM06 |
| Delegation abuse | Acts on behalf of the target with no delegation | LLM06 |
| Idempotency reuse | The control's key with different parameters | LLM06 |
| Parameter tampering | The control's grant presented with different parameters | LLM06 |
| Grant replay | The control's grant used twice | LLM06, AML.T0012 |
| Contradictory rationale | Stated reasons naming a different tool | LLM09 |
| Fabricated citation | Stated reasons citing evidence never supplied | LLM09 |
| Expired credential | The control request after the agent's authority lapsed | LLM06, AML.T0012 |
| Suspended agent | The control request after suspension | LLM06, AML.T0012 |

**Forged rights.** The self-approval and self-escalation scenarios give the lab agent's identity every permission it would need. They test the core rule that only a person changes an agent's authority or decides an approval, even if an agent identity somehow carried those rights. Over the API, agent keys are already refused for every governance write (`apps/api/tests/self-governance.test.ts`).

## Injection response (organization setting)

Shield's injection detector is heuristic and pattern-based. Before Phase 6 its signals were recorded and offered to policies as `shield.injectionSignals`, but no demo policy used them, and the lab found the gap. The new setting under Security, Data Protection, "Response to prompt injection", adds an organization-wide response:
- Record only (the default, and the previous behaviour)
- Send to a person for approval
- Hold for security review (quarantine)
- Refuse

It can be limited to particular signal kinds through the API. The response can only make a decision stricter; a property test checks this over 1,000 random inputs. A request it holds or refuses raises an `injection.detected` security event. The decision's explanation records the signals and whether the setting changed the outcome. Changing the setting needs `security:write` and is written to the evidence record.

The detector can miss attacks and can flag honest text. Turning the response on trades some false holds for coverage. That is the organization's choice, and AEGIS does not make it by default.

## Demo data

The seed runs the lab against the Customer Support Refund Agent twice:
1. **With injection signals only recorded:** 13 defended, 5 gaps.
2. **After the security analyst sets "Hold for security review":** 15 defended, 3 gaps.

**The remaining gaps are real** for the demo configuration:
- The refund tool accepts a destination URL that no rule restricts.
- The IBAN data class does not act on free text.
- Five refunds at the control amount pass per-request limits.

They are left visible on purpose.

## Access

| Action | Requires |
|---|---|
| Viewing runs and results | `security:read` |
| Starting a run | `security:write`, by a signed-in person |
| Changing the injection response | `security:write` |

Every lab API route (`/v1/lab/*`) refuses API keys, including reads, because results describe which attacks an organization's configuration lets through.

## Tests

| Suite | Tests |
|---|---|
| Core | `attack-lab.test.ts` (4) and `injection-response.test.ts` (6) |
| API | Lab access in `self-governance.test.ts` |
| Browser | `lab.spec.ts` (2) |

The full-run test asserts every baseline control is defended against the fixture tenant. It also asserts:
- the split-amount gap is reported, with its remedy;
- nothing executed, no grant is left live, nothing is left pending;
- no incident or notification was created;
- the clone is archived and absent from agent lists;
- the target agent is untouched.

## Not done

- **No scheduling.** Runs are started by hand; a scheduled run, with an alert when a gap appears, is a natural next step.
- **Fixed scenarios.** Organizations cannot add their own patterns yet.
- **Detection is heuristic.** Injection detection is pattern-based (`packages/core/src/shield/injection.ts`) and has not been evaluated against an independent adversarial corpus.
