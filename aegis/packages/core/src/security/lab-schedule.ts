import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { createSecurityEvent } from "../shield/security-events.js";
import { systemContextFor, type TenantRunner } from "../gateway/gateway.js";
import { runLab } from "./lab.js";

/**
 * Continuous attack simulation: a person with security:write chooses agents and an interval, and the worker runs
 * the Attack Simulation Lab against each of them when it falls due (job lab.scheduled). A scenario that was
 * defended in the agent's previous completed run and is a gap now is a regression: it raises a high-severity
 * security event. Runs stay decision-only, exactly as when a person starts them.
 */
export const labScheduleSchema = z.object({
  enabled: z.boolean(),
  agentIds: z.array(z.string().uuid()).max(10).default([]),
  everyHours: z.union([z.literal(24), z.literal(168)]).default(168),
});
export type LabSchedule = z.infer<typeof labScheduleSchema> & { setBy: { id: string; label: string | null }; setAt: string };

export function readLabSchedule(settings: unknown): LabSchedule | null {
  const raw = (settings as { labSchedule?: unknown } | null)?.labSchedule;
  const p = labScheduleSchema.extend({ setBy: z.object({ id: z.string(), label: z.string().nullable() }), setAt: z.string() }).safeParse(raw);
  return p.success ? p.data : null;
}

export async function setLabSchedule(db: TenantDb, ctx: OrgContext, raw: unknown): Promise<LabSchedule> {
  assertPermission(ctx, "security:write");
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Only a person can schedule the Attack Simulation Lab");
  const input = labScheduleSchema.parse(raw);
  if (input.enabled && input.agentIds.length === 0) throw validation("Choose at least one agent to test on a schedule");
  if (input.agentIds.length) {
    const found = await db.agent.count({ where: { orgId: ctx.orgId, id: { in: input.agentIds }, isLab: false } });
    if (found !== input.agentIds.length) throw validation("Every scheduled agent must be a registered agent of this organization");
  }
  const schedule: LabSchedule = { ...input, setBy: { id: ctx.actor.id, label: ctx.actor.label ?? null }, setAt: (ctx.now ?? new Date()).toISOString() };
  await db.$queryRawUnsafe(`SELECT 1 FROM organizations WHERE id = $1::uuid FOR UPDATE`, ctx.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...((org.settings ?? {}) as Record<string, unknown>), labSchedule: schedule } as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "lab.schedule_set", subjectType: "organization", subjectId: ctx.orgId, payload: { enabled: input.enabled, agentIds: input.agentIds, everyHours: input.everyHours } });
  return schedule;
}

type Outcomes = Record<string, string>;
async function outcomesOf(db: TenantDb, runId: string): Promise<Outcomes> {
  const rows = await db.attackSimulationResult.findMany({ where: { runId }, select: { scenarioKey: true, outcome: true } });
  return Object.fromEntries(rows.map((r) => [r.scenarioKey, r.outcome]));
}

/** Scenarios defended in the previous run that are gaps in this one. */
export function labRegressions(previous: Outcomes, current: Outcomes): string[] {
  return Object.keys(current).filter((k) => current[k] === "gap" && previous[k] === "defended").sort();
}

export interface ScheduledLabResult {
  agentId: string;
  runId: string | null;
  status: "ran" | "not_due" | "skipped";
  reason?: string;
  regressions: string[];
}

/** Runs every scheduled agent that is due. Idempotent within an interval: an agent with a recent scheduled run is not due. */
export async function runScheduledLabs(run: TenantRunner, orgId: string, now = new Date()): Promise<ScheduledLabResult[]> {
  const settings = await run(async (db) => (await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } })).settings);
  const schedule = readLabSchedule(settings);
  if (!schedule?.enabled) return [];
  const ctx = { ...systemContextFor(orgId), now };
  const out: ScheduledLabResult[] = [];
  for (const agentId of schedule.agentIds) {
    const since = new Date(now.getTime() - schedule.everyHours * 3_600_000);
    const recent = await run((db) => db.attackSimulationRun.findFirst({ where: { orgId, targetAgentId: agentId, startedAt: { gte: since }, summary: { path: ["scheduled"], equals: true } }, select: { id: true } }));
    if (recent) {
      out.push({ agentId, runId: recent.id, status: "not_due", regressions: [] });
      continue;
    }
    const previous = await run((db) => db.attackSimulationRun.findFirst({ where: { orgId, targetAgentId: agentId, status: "completed" }, orderBy: { startedAt: "desc" }, select: { id: true } }));
    let result: Awaited<ReturnType<typeof runLab>>;
    try {
      result = await runLab(run, ctx, { targetAgentId: agentId, customScenarioIds: "applicable" }, { scheduled: true });
    } catch (e) {
      // A target that is not active, holds no tools or is busy is skipped and tried again next interval.
      out.push({ agentId, runId: null, status: "skipped", reason: e instanceof Error ? e.message.slice(0, 300) : "skipped", regressions: [] });
      continue;
    }
    let regressions: string[] = [];
    if (previous && result.status === "completed") {
      const [before, after] = await Promise.all([run((db) => outcomesOf(db, previous.id)), run((db) => outcomesOf(db, result.runId))]);
      regressions = labRegressions(before, after);
      if (regressions.length) {
        await run((db) => createSecurityEvent(db, ctx, { type: "lab.regression", severity: "high", title: `Scheduled attack simulation: ${regressions.length} control(s) no longer hold`, agentId, detail: { runId: result.runId, previousRunId: previous.id, scenarios: regressions } }));
      }
    }
    out.push({ agentId, runId: result.runId, status: "ran", regressions });
  }
  return out;
}
