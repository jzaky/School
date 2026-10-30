"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import {
  addRegulatoryAction,
  assessmentSchema,
  assessRegulatoryChange,
  changeModelStage,
  completeDeletion,
  createRegulatoryChange,
  datasetInputSchema,
  decideDeletion,
  decideModelApproval,
  deletionCompletionSchema,
  deletionDecisionSchema,
  deletionRequestSchema,
  evaluationInputSchema,
  linkAgentModel,
  markRegulatoryImplemented,
  modelDecisionSchema,
  modelGovernanceSettingSchema,
  modelInputSchema,
  modelStageSchema,
  recordEvaluation,
  registerDataset,
  registerModel,
  regulatoryActionSchema,
  regulatoryChangeSchema,
  requestDeletion,
  requestModelApproval,
  updateModelGovernance,
} from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

async function inTenant<T>(fn: (db: Parameters<Parameters<typeof withTenant>[1]>[0], ctx: Awaited<ReturnType<typeof getConsoleContext>>["ctx"]) => Promise<T>) {
  const c = await getConsoleContext();
  return withTenant(c.ctx.orgId, (db) => fn(db, c.ctx));
}

export async function registerModelAction(input: unknown) {
  return act(async () => {
    const data = modelInputSchema.parse(input);
    const out = await inTenant((db, ctx) => registerModel(db, ctx, data));
    revalidatePath("/governance/models");
    return { id: out.model.id, agentsLinked: out.agentsLinked };
  });
}

export async function recordEvaluationAction(modelId: string, input: unknown) {
  return act(async () => {
    const data = evaluationInputSchema.parse(input);
    await inTenant((db, ctx) => recordEvaluation(db, ctx, uuid.parse(modelId), data));
    revalidatePath(`/governance/models/${modelId}`);
  });
}

export async function requestModelApprovalAction(modelId: string, note: string) {
  return act(async () => {
    await inTenant((db, ctx) => requestModelApproval(db, ctx, uuid.parse(modelId), z.string().max(2000).parse(note)));
    revalidatePath(`/governance/models/${modelId}`);
  });
}

export async function decideModelAction(modelId: string, input: unknown) {
  return act(async () => {
    const data = modelDecisionSchema.parse(input);
    await inTenant((db, ctx) => decideModelApproval(db, ctx, uuid.parse(modelId), data));
    revalidatePath(`/governance/models/${modelId}`);
  });
}

export async function changeModelStageAction(modelId: string, input: unknown) {
  return act(async () => {
    const data = modelStageSchema.parse(input);
    const out = await inTenant((db, ctx) => changeModelStage(db, ctx, uuid.parse(modelId), data));
    revalidatePath(`/governance/models/${modelId}`);
    return { agentsAffected: out.agentsAffected.length };
  });
}

export async function linkAgentModelAction(agentId: string, modelId: string | null) {
  return act(async () => {
    await inTenant((db, ctx) => linkAgentModel(db, ctx, uuid.parse(agentId), modelId ? uuid.parse(modelId) : null));
    revalidatePath("/governance/models");
  });
}

export async function updateModelEnforcementAction(input: unknown) {
  return act(async () => {
    const data = modelGovernanceSettingSchema.parse(input);
    await inTenant((db, ctx) => updateModelGovernance(db, ctx, data));
    revalidatePath("/governance/models");
  });
}

export async function registerDatasetAction(input: unknown) {
  return act(async () => {
    const data = datasetInputSchema.parse(input);
    const ds = await inTenant((db, ctx) => registerDataset(db, ctx, data));
    revalidatePath("/governance/data");
    return { id: ds.id };
  });
}

export async function requestDeletionAction(input: unknown) {
  return act(async () => {
    const data = deletionRequestSchema.parse(input);
    await inTenant((db, ctx) => requestDeletion(db, ctx, data));
    revalidatePath(`/governance/data/${data.datasetId}`);
  });
}

export async function decideDeletionAction(id: string, datasetId: string, input: unknown) {
  return act(async () => {
    const data = deletionDecisionSchema.parse(input);
    await inTenant((db, ctx) => decideDeletion(db, ctx, uuid.parse(id), data));
    revalidatePath(`/governance/data/${datasetId}`);
  });
}

export async function completeDeletionAction(id: string, datasetId: string, input: unknown) {
  return act(async () => {
    const data = deletionCompletionSchema.parse(input);
    await inTenant((db, ctx) => completeDeletion(db, ctx, uuid.parse(id), data));
    revalidatePath(`/governance/data/${datasetId}`);
  });
}

export async function createRegulatoryChangeAction(input: unknown) {
  return act(async () => {
    const data = regulatoryChangeSchema.parse(input);
    const c = await inTenant((db, ctx) => createRegulatoryChange(db, ctx, data));
    revalidatePath("/governance/regulatory");
    return { id: c.id };
  });
}

export async function assessRegulatoryChangeAction(id: string, input: unknown) {
  return act(async () => {
    const data = assessmentSchema.parse(input);
    await inTenant((db, ctx) => assessRegulatoryChange(db, ctx, uuid.parse(id), data));
    revalidatePath(`/governance/regulatory/${id}`);
  });
}

export async function addRegulatoryActionAction(id: string, input: unknown) {
  return act(async () => {
    const data = regulatoryActionSchema.parse(input);
    await inTenant((db, ctx) => addRegulatoryAction(db, ctx, uuid.parse(id), data));
    revalidatePath(`/governance/regulatory/${id}`);
  });
}

export async function markRegulatoryImplementedAction(id: string, note: string) {
  return act(async () => {
    await inTenant((db, ctx) => markRegulatoryImplemented(db, ctx, uuid.parse(id), z.string().max(2000).parse(note)));
    revalidatePath(`/governance/regulatory/${id}`);
  });
}
