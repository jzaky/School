# Uncertainty governance

Phase 4 of the enterprise expansion. Status: implemented and tested in this repository. Not independently reviewed. Not verified in a customer deployment. The design is AEGIS's own. Its public foundations are listed in `docs/PROVENANCE.md` section 4:
- JCGM 100:2008, for statistical versus non-statistical evaluation.
- ISO/IEC 25012, for data quality dimensions.
- Guo et al. 2017, for calibration.

## What it does and does not claim

**AEGIS does not produce its own confidence score.** For each request it checks what it can check about the facts behind it, and every indicator says what it rests on:

| Basis | Meaning |
|---|---|
| Measured | A fact AEGIS checked: a field is present, two values differ, a timestamp is old, a source is not on the list |
| Heuristic | A signal that suggests risk but proves nothing: rules matched with different effects, a new agent version, a recent policy change |
| Self-reported | A figure the agent supplied about itself, not checked against outcomes |
| Calibrated | The agent's figure mapped to the accuracy observed over at least 50 labelled outcomes for that agent |

The overall level for a request is set by its indicators:

| Level | When |
|---|---|
| High | Any indicator failed |
| Unknown | Otherwise, anything needed to judge the action was missing |
| Elevated | Otherwise, any warning |
| Low | Otherwise |

**Unknown is never treated as safe.** When a tool's requirements are on, it escalates exactly like high.

## What agents send

All optional, in the request `context`:

```
"evidence": [{ "field": "amount", "value": 420, "source": "orders-db", "observedAt": "2026-10-14T09:58:00Z" }],
"confidence": 0.86,
"missing": ["customerTenure"]
```

The TypeScript SDK types these fields as `UncertaintyContext`.

## Checks

| Check | Basis | Always on? |
|---|---|---|
| Evidence is well formed | Measured | Yes |
| Evidence agrees with the request, and sources agree with each other (contradictions) | Measured | Yes |
| The agent reports nothing it could not determine | Self-reported | Yes |
| Required fields are present (`params.x`, `context.x`) | Measured | When the tool's requirements are on |
| Named values are backed by evidence (otherwise unknown) | Measured | When on |
| Evidence is recent (stale is a warning, future-dated is a failure, undated is unknown) | Measured | When on, with a maximum age |
| Evidence comes from a trusted source | Measured | When on, with a source list |
| Confidence meets the tool's minimum. Calibrated accuracy is used when available; below minimum is a warning if self-reported and a failure if calibrated. A missing figure is unknown. | Self-reported or calibrated | When on, with a minimum |
| One clear rule decided | Heuristic | Yes |
| The agent's version and the policies are settled (24 hours) | Heuristic | Yes |

## What it does to decisions

Like autonomy levels, uncertainty can only make an allowed or restricted action stricter. A property test checks this over 1,000 random inputs.
- **Contradictions** always send the action to a person.
- **Gaps the agent reports** ask the agent for those fields, whether or not the tool has requirements.
- **High or unknown under requirements** follows the tool's choice:
  - Send to a person (the default).
  - Ask the agent for the missing fields. The agent resubmits under the same idempotency key and AEGIS decides again.
  - Refuse.
- **Elevated** never changes a decision.

Policies can also refer to the assessment directly: `uncertainty.level`, `uncertainty.missing`, `uncertainty.contradictions`, `uncertainty.confidence` and `uncertainty.confidenceBasis`.

**Order in the gateway:** policies, then data protection, then uncertainty, then autonomy level.

**What is recorded with each decision:**
- The full assessment, in `explanation.uncertainty`.
- The level, in `authorization_decisions.uncertainty_level`.
- What the policies alone decided, in `explanation.policyResult`. Policy replay compares with this.

## Calibration

**Ground truth comes from outcome labels:**
- **Approvers.** Approving a request that carried a confidence counts as "right", rejecting as "wrong".
- **People with `monitoring:write`.** Through the request page or `POST /v1/uncertainty/labels`.
- **Customer systems.** Through an integration key holding the `outcomes:report` scope.

An agent's key can never hold that scope, so no agent grades its own work. When a request has several labels, a system or reviewer label wins over an approver's.

**Computation.** The worker recomputes calibration every hour over the last 90 days, per agent and tool and per agent overall. It produces:
- 10 equal-width bins.
- Expected calibration error.
- The Brier score.
- Accuracy and sample size.

A bin's accuracy is used for a single request only when the bin holds at least 5 outcomes and the profile at least 50.

## Where it is

| Layer | Location |
|---|---|
| Assessment and escalation | `packages/core/src/uncertainty/assess.ts` (pure) |
| Calibration | `packages/core/src/uncertainty/calibration.ts` (pure) |
| Service | `packages/core/src/uncertainty/service.ts` (tool requirements, labels, profiles, overview) |
| Gateway | `packages/core/src/gateway/gateway.ts` |
| Policy replay | Uses the recorded uncertainty and the pure policy result |
| Database | Migration `20261014120000_uncertainty`: `tools.uncertainty_policy`, `authorization_decisions.uncertainty_level`, `outcome_labels`, `calibration_profiles` |
| API | `/v1/uncertainty/overview`, `/agents/:id/calibration`, `/labels`, `/tools/:id/policy`, `/calibration/recompute` |
| Console | Assurance, Uncertainty: levels, concerns, calibration tables, tool requirements. An Uncertainty panel on each request with outcome labelling. |

## Tests

| Suite | Tests |
|---|---|
| Core | `uncertainty.test.ts`, 16 tests |
| API | Labels by scope, and agents refused, in `self-governance.test.ts` |
| Browser | `uncertainty.spec.ts`, 3 tests |

The core tests cover every check, the property test, exact ECE and Brier values on a worked example, the gateway paths, policy references, approver and reviewer labels, and calibration thresholds.

## Demo data

The seeded refund history carries synthetic evidence and confidence. About 95% of executed refunds have a synthetic reviewer label, and the seed makes the agent slightly overconfident. The refund tool's requirements are filled in but left off, so the demo scenarios behave as their policies describe.

## Not done

- No calibration method beyond binning, such as isotonic regression or temperature scaling.
- Labels are binary: right or wrong.
- No automatic re-check of evidence against the source system. AEGIS compares what the agent reports. Fetching the source itself needs a connector per source.
