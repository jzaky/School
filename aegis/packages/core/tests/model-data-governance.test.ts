import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeGatewayFixture, type GatewayFixture } from "./gateway-fixture.js";
import { addUserWithRole } from "./helpers.js";
import { changeModelStage, decideModelApproval, escalateForModel, getModel, linkAgentModel, listModels, MODEL_ENFORCEMENT, modelGateCheck, recordEvaluation, registerModel, requestModelApproval, updateModelGovernance } from "../src/governance/models.js";
import { completeDeletion, datasetAccessAudit, decideDeletion, listDatasets, registerDataset, requestDeletion } from "../src/governance/data.js";
import { addRegulatoryAction, assessRegulatoryChange, createRegulatoryChange, getRegulatoryChange, listRegulatoryChanges, markRegulatoryImplemented, suggestImpact } from "../src/governance/regulatory.js";
import { transition } from "../src/audit/remediation.js";
import type { OrgContext } from "../src/lib/context.js";

const RANK: Record<string, number> = { allow: 0, restrict: 1, require_approval: 2, request_more_information: 3, quarantine: 4, deny: 5, error: 5 };

describe("model gate (pure)", () => {
  it("enforces unregistered, unapproved and retired models; deprecated and overdue review only inform", () => {
    const now = new Date();
    expect(modelGateCheck(null, now)).toMatchObject({ status: "unregistered", enforce: true });
    expect(modelGateCheck({ key: "m", stage: "evaluating", reviewDueAt: null }, now)).toMatchObject({ status: "not_approved", enforce: true });
    expect(modelGateCheck({ key: "m", stage: "retired", reviewDueAt: null }, now)).toMatchObject({ status: "retired", enforce: true });
    expect(modelGateCheck({ key: "m", stage: "deprecated", reviewDueAt: null }, now)).toMatchObject({ status: "deprecated", enforce: false });
    expect(modelGateCheck({ key: "m", stage: "approved", reviewDueAt: new Date(now.getTime() - 1000) }, now)).toMatchObject({ status: "review_overdue", enforce: false });
    expect(modelGateCheck({ key: "m", stage: "approved", reviewDueAt: null }, now)).toMatchObject({ status: "ok", enforce: false });
  });

  it("never loosens a decision", () => {
    fc.assert(
      fc.property(fc.constantFrom("allow", "restrict", "require_approval", "request_more_information", "quarantine", "deny", "error"), fc.constantFrom(...MODEL_ENFORCEMENT), fc.boolean(), (outcome, enforcement, enforce) => {
        expect(RANK[escalateForModel(outcome, { enforce }, { enforcement }).outcome]).toBeGreaterThanOrEqual(RANK[outcome]!);
      }),
      { numRuns: 1000 },
    );
  });
});

let f: GatewayFixture;
let security: { userId: string; ctx: OrgContext };
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(f.orgId, fn);

beforeAll(async () => {
  f = await makeGatewayFixture();
  security = await addUserWithRole(f, "security_analyst", "sec");
}, 120_000);

afterAll(async () => {
  await f.cleanup();
  await disconnectAll();
});

describe("model registry and lifecycle", () => {
  let modelId = "";

  it("registers a model and links the agents that report it", async () => {
    await run((db) => db.agent.update({ where: { id: f.agentId }, data: { modelProvider: "anthropic", modelId: "claude-sonnet-5-5" } }));
    const { model, agentsLinked } = await run((db) => registerModel(db, f.engineer.ctx, { key: "support-llm", name: "Support LLM", provider: "Anthropic", providerModelId: "claude-sonnet-5-5", riskTier: "high", dataCategories: ["personal", "financial"] }));
    modelId = model.id;
    expect(model.stage).toBe("proposed");
    expect(agentsLinked).toBe(1);
    await expect(run((db) => registerModel(db, f.viewer.ctx, { key: "x-model", name: "X", provider: "p", providerModelId: "x" }))).rejects.toThrow(/Missing permission agents:write/);
  });

  it("cannot go for approval without evaluations, nor be approved while the latest of a kind failed", async () => {
    await expect(run((db) => requestModelApproval(db, f.engineer.ctx, modelId, "ready"))).rejects.toThrow(/No evaluation/);
    await run((db) => recordEvaluation(db, f.engineer.ctx, modelId, { kind: "safety", result: "fail", summary: "Red-team prompts produced unsafe refund advice" }));
    await expect(run((db) => requestModelApproval(db, f.engineer.ctx, modelId, "ready"))).rejects.toThrow(/latest safety evaluation failed/);
    await run((db) => recordEvaluation(db, f.engineer.ctx, modelId, { kind: "safety", result: "pass", summary: "Re-run after prompt changes: no unsafe advice in 200 cases", metrics: { cases: 200, unsafe: 0 } }));
    await run((db) => recordEvaluation(db, f.engineer.ctx, modelId, { kind: "accuracy", result: "conditional", summary: "Refund eligibility correct in 94% of 500 labelled tickets" }));
    const sent = await run((db) => requestModelApproval(db, f.engineer.ctx, modelId, "Evaluations attached"));
    expect(sent.stage).toBe("evaluating");
  });

  it("is approved by a second person with policies:activate, never by the requester", async () => {
    await expect(run((db) => decideModelApproval(db, f.engineer.ctx, modelId, { approve: true, note: "Looks fine to me" }))).rejects.toThrow(/policies:activate/);
    const self = { ...f.ownerCtx };
    await run((db) => db.aiModel.update({ where: { id: modelId }, data: { approvalRequestedBy: f.ownerCtx.actor.id } }));
    await expect(run((db) => decideModelApproval(db, self, modelId, { approve: true, note: "Looks fine to me" }))).rejects.toThrow(/asked for approval cannot approve/);
    await run((db) => db.aiModel.update({ where: { id: modelId }, data: { approvalRequestedBy: f.engineer.userId } }));
    const approved = await run((db) => decideModelApproval(db, f.ownerCtx, modelId, { approve: true, note: "Approved for support refunds", reviewInDays: 180 }));
    expect(approved.stage).toBe("approved");
    expect(approved.reviewDueAt).not.toBeNull();
    const detail = await run((db) => getModel(db, f.ownerCtx, modelId));
    expect(detail.stageChanges.map((s) => s.toStage)).toEqual(["approved", "evaluating"]);
    expect(detail.agents.map((a) => a.id)).toEqual([f.agentId]);
    await expect(run((db) => db.modelEvaluation.updateMany({ where: { modelId }, data: { result: "pass" } }))).rejects.toThrow(/append-only/);
  });

  it("the gateway enforces the registry only when the organization switches it on", async () => {
    expect((await f.call({ amount: 50 })).decision).toBe("allow");
    await run((db) => changeModelStage(db, f.ownerCtx, modelId, { to: "retired", reason: "Replaced by a newer model" }));
    // Off by default: a retired model is recorded but does not change the decision.
    const off = await f.call({ amount: 50 });
    expect(off.decision).toBe("allow");
    const d = await run((db) => db.authorizationDecision.findFirstOrThrow({ where: { actionRequestId: off.requestId } }));
    expect((d.explanation as { model: { status: string; escalated: boolean } }).model).toMatchObject({ status: "retired", escalated: false });
    await expect(run((db) => updateModelGovernance(db, f.engineer.ctx, { enforcement: "deny" }))).rejects.toThrow(/policies:activate/);
    await run((db) => updateModelGovernance(db, f.ownerCtx, { enforcement: "require_approval" }));
    const held = await f.call({ amount: 50 });
    expect(held.decision).toBe("require_approval");
    expect(held.reasons.join(" ")).toMatch(/Model governance: Model support-llm is retired/);
    // Unlinked agents count as unregistered models.
    await run((db) => linkAgentModel(db, f.ownerCtx, f.agentId, null));
    await run((db) => updateModelGovernance(db, f.ownerCtx, { enforcement: "deny" }));
    const refused = await f.call({ amount: 50 });
    expect(refused.decision).toBe("deny");
    expect(refused.reasons.join(" ")).toMatch(/not in the model registry/);
    await run((db) => updateModelGovernance(db, f.ownerCtx, { enforcement: "off" }));
    const list = await run((db) => listModels(db, f.ownerCtx));
    expect(list.unlinkedAgents.map((a) => a.id)).toContain(f.agentId);
  });
});

describe("datasets, access audit and deletion requests", () => {
  let datasetId = "";

  it("registers a dataset tied to a gateway resource and audits agent access from real permissions and requests", async () => {
    const resource = await run((db) => db.resource.findFirstOrThrow({ where: { key: "support-tickets" } }));
    await expect(run((db) => registerDataset(db, f.engineer.ctx, { key: "tickets", name: "Tickets" }))).rejects.toThrow(/security:write/);
    const ds = await run((db) => registerDataset(db, f.ownerCtx, { key: "support-tickets-data", name: "Support tickets", classification: "confidential", categories: ["personal", "financial"], resourceId: resource.id, region: "UAE (declared)" }));
    datasetId = ds.id;
    const list = await run((db) => listDatasets(db, f.ownerCtx));
    const row = list.find((d) => d.id === ds.id)!;
    expect(row.findings).toEqual(["No owner", "No retention period", "Personal data without a recorded lawful basis"]);
    expect(row.agentsWithAccess).toBe(1);
    expect(row.requests30d).toBeGreaterThan(0);
    const audit = await run((db) => datasetAccessAudit(db, f.ownerCtx, ds.id));
    expect(audit.access.map((a) => a.agent.id)).toEqual([f.agentId]);
    expect(audit.requests.length).toBeGreaterThan(0);
  });

  it("deletion requests store only a keyed hash, need a second person, and record the customer's completion reference", async () => {
    const subject = "CUST-778812";
    const req = await run((db) => requestDeletion(db, f.ownerCtx, { datasetId, subjectRef: subject, reason: "Customer exercised the right to erasure" }));
    expect(req.subjectRefHash).toMatch(/^[0-9a-f]{64}$/);
    expect(req.subjectHint).toBe("8812");
    const raw = await run((db) => db.dataDeletionRequest.findUniqueOrThrow({ where: { id: req.id } }));
    expect(JSON.stringify(raw)).not.toContain(subject);
    const ledger = await run((db) => db.evidenceEvent.findMany({ where: { subjectId: req.id } }));
    expect(JSON.stringify(ledger.map((e) => e.payload))).not.toContain(subject);
    await expect(run((db) => requestDeletion(db, security.ctx, { datasetId, subjectRef: " cust-778812 ", reason: "Duplicate of the same request" }))).rejects.toThrow(/already exists/);
    await expect(run((db) => decideDeletion(db, f.ownerCtx, req.id, { approve: true, note: "Looks fine to me" }))).rejects.toThrow(/requested the deletion cannot decide/);
    await expect(run((db) => completeDeletion(db, security.ctx, req.id, { reference: "JOB-1" }))).rejects.toThrow(/Only an approved/);
    await run((db) => decideDeletion(db, security.ctx, req.id, { approve: true, note: "Verified the customer's identity" }));
    const done = await run((db) => completeDeletion(db, security.ctx, req.id, { reference: "CRM-ERASE-4411" }));
    expect(done).toMatchObject({ status: "completed", completionReference: "CRM-ERASE-4411" });
  });
});

describe("regulatory change register", () => {
  it("records a change, suggests impact lexically, assesses it, tracks actions and closes only when they are resolved", async () => {
    const framework = await run((db) => db.framework.findFirst({ where: { controls: { some: {} } }, include: { controls: { take: 1 } } }));
    const c = await run((db) => createRegulatoryChange(db, f.ownerCtx, { title: "Guidance on automated refund decisions and personal data", source: "Illustrative regulator", jurisdiction: "UAE", frameworkId: framework?.id ?? null, effectiveAt: new Date(Date.now() + 45 * 86_400_000), summary: "Automated decisions using personal data need human review and records of the decision." }));
    expect(c.status).toBe("new");
    const suggestion = await run((db) => suggestImpact(db, f.ownerCtx, c.id));
    expect(suggestion.basis).toBe("lexical");
    const datasets = await run((db) => db.dataset.findMany({ select: { id: true } }));
    expect(suggestion.datasets.map((d) => d.id).sort()).toEqual(datasets.map((d) => d.id).sort());
    await expect(run((db) => assessRegulatoryChange(db, f.ownerCtx, c.id, { status: "action_required", impact: { controls: [], policies: [], agents: ["00000000-0000-7000-8000-000000000000"], models: [], datasets: [], notes: "" }, note: "Bad id" }))).rejects.toThrow(/Unknown agent/);
    await run((db) => assessRegulatoryChange(db, f.ownerCtx, c.id, { status: "action_required", impact: { controls: framework?.controls[0] ? [framework.controls[0].id] : [], policies: [f.refundPolicyId], agents: [f.agentId], models: [], datasets: datasets.map((d) => d.id), notes: "Refund agent decides alone below AED 500" }, note: "Applies to autonomous refunds" }));
    const task = await run((db) => addRegulatoryAction(db, f.ownerCtx, c.id, { title: "Lower the autonomous refund limit for flagged customers" }));
    expect(task.dueAt?.toISOString()).toBe(c.effectiveAt?.toISOString());
    await expect(run((db) => markRegulatoryImplemented(db, f.ownerCtx, c.id, "Done"))).rejects.toThrow(/not resolved/);
    for (const s of ["in_progress", "review", "resolved"] as const) await run((db) => transition(db, f.ownerCtx, task.id, s, "progress"));
    const closed = await run((db) => markRegulatoryImplemented(db, f.ownerCtx, c.id, "Policy updated and approved"));
    expect(closed.status).toBe("implemented");
    const detail = await run((db) => getRegulatoryChange(db, f.ownerCtx, c.id));
    expect(detail.impact.agents.map((a) => a.id)).toEqual([f.agentId]);
    expect(detail.tasks[0]?.status).toBe("resolved");
    const list = await run((db) => listRegulatoryChanges(db, f.ownerCtx));
    expect(list.find((x) => x.id === c.id)).toMatchObject({ tasksTotal: 1, tasksResolved: 1, effectiveSoon: false });
    await expect(run((db) => listRegulatoryChanges(db, { ...f.viewer.ctx, actor: { ...f.viewer.ctx.actor, permissions: ["org:read"] } }))).rejects.toThrow(/audit:read/);
  });
});
