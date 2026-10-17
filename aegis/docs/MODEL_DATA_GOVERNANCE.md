# Model governance, data governance and regulatory change

Phase 7 of the enterprise expansion. Status: implemented and tested in this repository. Not independently reviewed. Not verified in a customer deployment. The design is AEGIS's own. The record structures draw on public practice listed in `docs/PROVENANCE.md` section 4.

## Model registry and lifecycle

Every AI model the organization's agents run on is a record with:
- provider and the provider's model id;
- version, risk tier, intended use and known limitations;
- the data categories it may receive;
- a declared hosting region (AEGIS does not verify it);
- an owner.

Agents link to their model. Registering a model links every agent that reports the same provider and model id, and agents can also be linked by hand.

**Stages:** proposed, evaluating, approved, deprecated, retired.

| Step | Who | Conditions |
|---|---|---|
| Record an evaluation | A person with `agents:write` | Kind (accuracy, safety, bias, security, privacy, other), result (pass, conditional, fail), what was done. Append-only. |
| Send for approval (proposed to evaluating) | A person with `agents:write` | At least one evaluation, and the latest evaluation of each kind has not failed |
| Approve or reject | A person with `policies:activate` who did not send it | The same evaluation conditions, checked again. Approval sets a review date (default 12 months). |
| Deprecate | `policies:activate` | Only an approved model |
| Retire | `policies:activate` | Any stage; final |

Every stage change is stored append-only and written to the evidence record. A model past its review date is flagged "review overdue".

### Enforcement in the gateway

**Setting:** an organization setting (Models page, `policies:activate`) decides what the gateway does when an agent's model is:
- unregistered (the agent is not linked);
- not approved (proposed or evaluating);
- retired.

**Options:**
- Record only (default)
- Send to a person for approval
- Refuse

**Deprecated models and overdue reviews** never change a decision. They add a risk indicator (`model:deprecated`, `model:review_overdue`).

**Order:** the check runs after the stated-reasons and injection stages and before the autonomy level. It can only make a decision stricter; a property test checks this over 1,000 random inputs. Every decision records the model check under `model` in its explanation.

## Data inventory

**What a dataset records:**
- owner and classification;
- data categories;
- declared storage location and region;
- retention period and lawful basis;
- optionally, the gateway resource that fronts it.

**Findings** flag the gaps:
- no owner;
- no retention period;
- personal data without a lawful basis;
- no region;
- not tied to a resource.

**Access auditing** uses facts AEGIS holds:
- which agents hold permissions on the dataset's resource, flagging any whose clearance is below the dataset's classification;
- which requests reached that resource in the last 30 days, and how they were decided.

Access that does not pass through AEGIS is not visible to it. The page says so.

### Deletion requests

A deletion request names a dataset and a data subject reference. The reference is never stored:
- AEGIS keeps an HMAC-SHA-256 of it, keyed from the master key and scoped to the organization, to detect duplicates;
- it also keeps the last four characters, so people can tell requests apart;
- the evidence record holds the hash, not the reference.

**Workflow:**
1. A person with `security:write` requests the deletion.
2. A different person with `security:write` approves or rejects it.
3. Once approved, someone records the completion with the reference of the deletion in the customer's own system.

**AEGIS records the decision and the attestation; it does not delete data in customer systems and does not verify the deletion.** Requests have a due date (30 days by default) and show as overdue after it.

AEGIS's own evidence record is append-only by design, and deletion requests do not change it.

## Regulatory change register

People record a regulatory or standards change:
- title, source, reference and jurisdiction;
- an optional framework from the catalog;
- publication and effective dates, and a summary.

**AEGIS does not monitor regulators or interpret law.**

**Impact assessment.** A person ticks the controls, policies, agents, models and datasets the change affects, adds notes, and sets the outcome: still assessing, action required, or not applicable. Unticked items on the page are suggestions from a lexical match:
- the linked framework's controls and the organization's policies, by shared terms;
- models, datasets and agents named in the change or matching its data categories;
- high-risk models and agents when the change mentions AI.

**Actions.** Each action becomes a remediation task through the existing remediation workflow, due on the change's effective date unless set. A change can be marked implemented only when every linked task is resolved.

**Flags:**
- changes effective within 90 days;
- changes already in force but still open.

## Access

| Area | Read | Write | Decide |
|---|---|---|---|
| Models | `agents:read` | `agents:write` | `policies:activate`, a different person from the requester |
| Model enforcement | `agents:read` | `policies:activate` | |
| Datasets and deletion requests | `security:read` | `security:write` | `security:write`, a different person from the requester |
| Regulatory changes | `audit:read` | `audit:write` | |

**API:** `/v1/governance/*`. Every write needs a signed-in person; API keys, including agents' own, are refused (`apps/api/tests/self-governance.test.ts`).

## Demo data

**Models:** six models covering every stage, and every live demo agent is linked to one:
- Claude Sonnet 5.5 and Claude Opus 5.5 are approved; Opus's review is overdue;
- GPT-5 is waiting for approval;
- Gemini 3 Pro is proposed, with a failing bias evaluation;
- Claude Haiku 5.5 is deprecated;
- Claude Sonnet 4.5 is retired.

**Datasets:** five, two with visible gaps:
- marketing contacts have no retention period, lawful basis or region;
- analytics extracts are declared outside the UAE.

**Deletion requests:** one completed and one waiting for a second person.

**Regulatory changes:** three.
- **Supervisory guidance on AI in customer decisions (illustrative):** invented for the demo. Action required, with two tasks.
- **EU AI Act, obligations for providers of general-purpose AI models:** cites the real regulation; these obligations apply from 2 August 2025. Implemented, one task resolved.
- **Group data retention standard, revision 3 (illustrative):** invented for the demo. New.

## Tests

| Suite | Tests |
|---|---|
| Core | `model-data-governance.test.ts` (9): the gate, the property test, the lifecycle, separation of duties, append-only evaluations, gateway enforcement on and off, dataset findings and access audit, hashed deletion requests and the two-person rule, the regulatory register end to end |
| API | Person-only writes in `self-governance.test.ts` |
| Browser | `governance-registry.spec.ts` (4) |

## Not done

- Model and dataset records are entered by people. There is no import from model hubs, data catalogs or cloud inventories yet; integrations are Phase 8.
- Regions are declared, not verified; residency options are Phase 11.
- Impact suggestions are lexical, not semantic.
- There are no scheduled reminders for review dates, due deletions or effective dates; the pages flag them.
