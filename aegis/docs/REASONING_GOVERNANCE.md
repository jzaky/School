# Reasoning governance and the Decision Inspector

Phase 5 of the enterprise expansion. Status: implemented and tested in this repository. Not independently reviewed. Not verified in a customer deployment. The design is AEGIS's own. The decision record follows the structure of W3C PROV-DM (entities, activities, agents), as listed in `docs/PROVENANCE.md` section 4.

## What it governs, and what it does not

AEGIS governs **observable decision artifacts**:
- The request an agent sends.
- The rationale it chooses to submit with it.
- Everything AEGIS computes about the request.

**AEGIS has no access to any model's internal reasoning and makes no claim about it.** A rationale is the agent's own statement. AEGIS checks that statement against the request, against the evidence the agent supplied, and against the policies that actually applied.

## The rationale an agent may send

In the request `context`, optional:

```
"rationale": {
  "summary": "Refund for a damaged item",
  "action": { "tool": "issue-refund", "action": "execute" },
  "steps": [{ "statement": "Order total confirmed", "cites": ["ord-50012"] }],
  "assumptions": [{ "field": "amount", "value": 120 }],
  "policyBasis": ["refund-authority"],
  "alternatives": ["Offer store credit"]
}
```

A citation names an evidence item by its `ref` or `field`, from `context.evidence` (see `docs/UNCERTAINTY_ENGINE.md`).

## Checks

| Check | Kind | Effect |
|---|---|---|
| The rationale is well formed | Integrity | Always goes to a person |
| The stated action is the requested tool and action | Integrity | Always goes to a person |
| Every citation points at evidence the agent supplied | Integrity | Always goes to a person |
| No assumption contradicts the request or its evidence | Integrity | Always goes to a person |
| The policies the agent relies on applied (fail if not) and decided something (warning if none of their rules matched) | Measured | Fails escalate only under the tool's requirements |
| A rationale was submitted (unknown if not) | Requirement | Under the tool's requirements |
| Every step cites evidence | Requirement | Under the tool's requirements |
| Similar requests were decided alike: same tool, amount within 10%, same policy versions, last 30 days | Heuristic | Never changes a decision |

**Monotonic.** Escalation can only make an allowed or restricted action stricter, and a property test checks this over 1,000 random inputs.

**Per-tool requirements.** Tool requirements (`tools.reasoning_policy`, set under Assurance, Uncertainty) can require a rationale and citations. When they are not met, the tool's choice applies:
- Send to a person.
- Ask the agent for its rationale. The agent resubmits under the same idempotency key.
- Refuse.

**Order in the gateway:** policies, then data protection, then uncertainty, then stated reasons, then autonomy level. The assessment is recorded in each decision's explanation under `reasoning`.

## Decision Inspector

The inspector is in the console at `/gateway/:id/inspect`, linked from every request, and in the API at `/v1/decisions/:id`.

**What it does:**
- **Stages.** Reconstructs each stage from what AEGIS recorded, with its status and the recorded detail: received, baseline checks, data protection, policy evaluation, uncertainty, stated reasons, autonomy level, outcome, approval and execution.
- **Counterfactuals.** Derived only from the numeric comparisons the policies recorded, for example "If params.amount were 500 or more (it was 120), rule refund-authority/auto-below-500 (allow) would no longer match." Nothing else is inferred.
- **Recheck.** Re-evaluates the request's recorded input against the policies active now. It reports whether the decision would be the same, and changes nothing.
- **Decision record.** Exports a self-contained JSON document (`aegis-decision-record/1`) with:
  - Entities: the request and each decision.
  - Activities: the stages.
  - Agents: the AI agent and the gateway.
  - Relations, and the ledger entries for the request.

  The export carries the SHA-256 of its canonical form, is itself written to the evidence record, and states that no model-internal reasoning is included.

## Access

| Action | Requires |
|---|---|
| Inspecting | `gateway:read` |
| Rechecking | `policies:read` |
| Changing requirements | `agents:write`, by a person |

API keys, including agents' own, cannot inspect, export or change requirements (`apps/api/tests/self-governance.test.ts`).

## Tests

| Suite | Tests |
|---|---|
| Core | `reasoning.test.ts`, 12 tests |
| API | Inspector access and the requirements route, in `self-governance.test.ts` |
| Browser | `inspector.spec.ts`, 2 tests |

The core tests cover every check, the property test, counterfactual wording, gateway escalation, requirements and resubmission, inspector stages, recheck, record hashing and the precedent heuristic.

## Demo data

Seeded refunds carry a rationale that cites the evidence item for the order. The refund tool's rationale requirements are filled in but left off.

## Not done

- Rationales are checked structurally, not semantically. AEGIS does not judge whether a summary is persuasive, or whether a statement's prose matches its citation.
- Counterfactuals cover single numeric comparisons only, not combinations of conditions.
