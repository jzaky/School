/**
 * Before and after: what the same agent requests do to a system with and without AEGIS
 * (docs/IMPACT.md). Every case of the sector validation lab is sent twice to a simulated downstream
 * system that applies its effect (money paid, records released, a safety system changed):
 *
 * - Without AEGIS: the request goes straight to the system, which does what it is asked.
 * - With AEGIS: the request goes through the real gateway. The system acts only after it verifies and
 *   consumes AEGIS's one-time permission for exactly those parameters, then reports the result back.
 *
 * The system also tries two things an attacker would: acting with no permission, and reusing a
 * permission. Everything is measured from what the system did and what the evidence ledger holds.
 * Synthetic organization and data; the AEGIS engines are the real ones.
 */
import { rawPrisma, withTenant } from "@aegis/db";
import { verifyChain, writeCheckpoint } from "../evidence/ledger.js";
import { consumeGrant } from "../gateway/grants.js";
import { authorizeAndExecute, recordAgentExecution, requestHashOf } from "../gateway/gateway.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { validation } from "../lib/errors.js";
import { SECTOR_PACKS, type LabCase, type SectorPack } from "./sector-lab.js";

export type ImpactClass = "harmful" | "needs_review" | "legitimate";
export type ImpactUnit = "AED" | "USD" | "records" | "actions";

export interface ImpactEffect {
  unit: ImpactUnit;
  value: number;
}

/** What the lab expects AEGIS to do with a case says what kind of action it is. */
export function classOf(c: LabCase): ImpactClass {
  if (c.expect === "denied" || c.expect === "quarantined") return "harmful";
  if (c.expect === "pending_approval" || c.expect === "awaiting_information") return "needs_review";
  return "legitimate";
}

/** The size of what the action would do if executed, read from its own parameters. */
export function effectOf(c: LabCase): ImpactEffect {
  const p = c.params;
  if (typeof p.amount === "number") return { unit: p.currency === "USD" ? "USD" : "AED", value: p.amount };
  for (const k of ["recordCount", "maxResults"]) if (typeof p[k] === "number") return { unit: "records", value: p[k] as number };
  return { unit: "actions", value: 1 };
}

interface Applied {
  caseId: string;
  via: "direct" | "aegis";
  effect: ImpactEffect;
  fields: number | null;
}

/** A downstream system that applies whatever reaches it, and records it. */
class SimulatedSystem {
  readonly applied: Applied[] = [];
  apply(c: LabCase, via: Applied["via"], params: Record<string, unknown>) {
    const fields = Array.isArray(params.fields) ? params.fields.length : null;
    this.applied.push({ caseId: c.id, via, effect: effectOf(c), fields });
  }
}

export interface ImpactCase {
  sector: string;
  caseId: string;
  title: string;
  class: ImpactClass;
  /** The policy narrows this action rather than allowing or refusing it outright. */
  narrowed: boolean;
  effect: ImpactEffect;
  without: { executed: boolean; fields: number | null };
  with: { executed: boolean; fields: number | null; outcome: string; decisionMs: number; requestId: string };
}

export interface ImpactTotals {
  cases: number;
  harmful: { cases: number; executedWithout: number; executedWith: number; valueWithout: Record<string, number>; valueWith: Record<string, number> };
  needsReview: { cases: number; executedWithout: number; executedWith: number; heldForPerson: number };
  legitimate: { cases: number; executedWithout: number; executedWith: number };
  attacks: { cases: number; succeededWithout: number; succeededWith: number };
  fieldsReleased: { without: number; with: number };
  bypass: { attempts: number; refused: number };
  replay: { attempts: number; refused: number };
  evidence: { recordsWithout: number; recordsWith: number; ledgerValid: boolean; checkpointThroughSeq: string | null };
  decisionMs: { p50: number; p95: number };
}

export interface ImpactRun {
  notice: string;
  startedAt: string;
  finishedAt: string;
  orgId: string;
  evidenceRange: { fromSeq: string; toSeq: string };
  cases: ImpactCase[];
  totals: ImpactTotals;
}

export const IMPACT_NOTICE = "Synthetic organization, agents and records sent to a simulated downstream system. The decisions are made by the real AEGIS engines and the evidence is the real ledger. Not a customer, live-system or pilot result.";

const ATTACK_IDS = new Set(["gov-hidden-instruction", "def-injection", "ps-injection"]);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! * 10) / 10;
};
const addTo = (m: Record<string, number>, e: ImpactEffect) => {
  m[e.unit] = (m[e.unit] ?? 0) + e.value;
};

/** Runs every case without and with AEGIS in the sector lab organization (see setupSectorLab). */
export async function runImpact(orgId: string, opts: { packs?: SectorPack[] } = {}): Promise<ImpactRun> {
  const org = await rawPrisma().organization.findUnique({ where: { id: orgId } });
  if (!org || (org.settings as { sectorLab?: boolean } | null)?.sectorLab !== true) throw validation("The impact run uses the sector lab organization");
  const packs = opts.packs ?? SECTOR_PACKS;
  const agentIds = await withTenant(orgId, async (db) => Object.fromEntries((await db.agent.findMany({ where: { orgId }, select: { slug: true, id: true } })).map((a) => [a.slug, a.id])));
  const startedAt = new Date().toISOString();
  const firstSeq = await withTenant(orgId, async (db) => ((await db.evidenceEvent.findFirst({ where: { orgId }, orderBy: { seq: "desc" }, select: { seq: true } }))?.seq ?? 0n) + 1n);
  const correlationId = `impact-${Date.now().toString(36)}`;
  const system = new SimulatedSystem();
  const cases: ImpactCase[] = [];
  const grantsUsed: { token: string; requestId: string; agentCtx: OrgContext }[] = [];
  let seq = 0;

  for (const pack of packs) {
    for (const c of pack.cases) {
      // Without AEGIS: straight to the system.
      system.apply(c, "direct", c.params);
      // With AEGIS: through the gateway; the system acts only on a verified, single-use permission.
      const agentCtx = makeContext(orgId, { type: "agent", id: agentIds[c.agent]!, label: c.agent }, { requestId: correlationId });
      const t0 = performance.now();
      const g = await authorizeAndExecute(withTenant, agentCtx, { tool: c.tool, action: "execute", params: c.params, context: c.context ?? {}, justification: c.justification ?? "", idempotencyKey: `${correlationId}-${++seq}`, principal: { type: "system" }, executionMode: "agent" });
      const decisionMs = performance.now() - t0;
      let executed = false;
      let fields: number | null = null;
      if (g.grant) {
        const token = g.grant.token;
        executed = await withTenant(orgId, async (db) => {
          const req = await db.actionRequest.findUniqueOrThrow({ where: { id: g.requestId }, select: { toolKey: true, action: true, params: true } });
          const params = req.params as Record<string, unknown>;
          const check = await consumeGrant(db, token, requestHashOf(req.toolKey, req.action, params));
          if (!check.ok) return false;
          system.apply(c, "aegis", params);
          fields = Array.isArray(params.fields) ? params.fields.length : null;
          await recordAgentExecution(db, agentCtx, g.requestId, { grant: token, outcome: "succeeded", reference: `SIM-${g.requestId.slice(0, 8)}` });
          return true;
        });
        grantsUsed.push({ token, requestId: g.requestId, agentCtx });
      }
      cases.push({
        sector: pack.key,
        caseId: c.id,
        title: c.title,
        class: classOf(c),
        narrowed: c.expect === "restricted",
        effect: effectOf(c),
        without: { executed: true, fields: Array.isArray(c.params.fields) ? (c.params.fields as unknown[]).length : null },
        with: { executed, fields, outcome: g.status, decisionMs: Math.round(decisionMs * 10) / 10, requestId: g.requestId },
      });
    }
  }

  // What an attacker at the downstream system would try: act with no permission, and reuse one.
  const harmful = cases.filter((c) => c.class === "harmful");
  let bypassRefused = 0;
  await withTenant(orgId, async (db) => {
    for (const h of harmful) {
      const forged = `forged.${Buffer.from(h.with.requestId).toString("base64url")}.sig`;
      const check = await consumeGrant(db, forged, "0".repeat(64));
      if (!check.ok) bypassRefused++;
    }
  });
  let replayRefused = 0;
  await withTenant(orgId, async (db) => {
    for (const u of grantsUsed) {
      const req = await db.actionRequest.findUniqueOrThrow({ where: { id: u.requestId }, select: { toolKey: true, action: true, params: true } });
      const check = await consumeGrant(db, u.token, requestHashOf(req.toolKey, req.action, req.params as Record<string, unknown>));
      if (!check.ok) replayRefused++;
    }
  });

  const checkpoint = await withTenant(orgId, (db) => writeCheckpoint(db, orgId));
  const { lastSeq, verified, evidenceCount } = await withTenant(orgId, async (db) => {
    const last = await db.evidenceEvent.findFirst({ where: { orgId }, orderBy: { seq: "desc" }, select: { seq: true } });
    return { lastSeq: last?.seq ?? 0n, verified: await verifyChain(db, orgId), evidenceCount: await db.evidenceEvent.count({ where: { orgId, seq: { gte: firstSeq } } }) };
  });

  const totals: ImpactTotals = {
    cases: cases.length,
    harmful: { cases: harmful.length, executedWithout: harmful.length, executedWith: harmful.filter((c) => c.with.executed).length, valueWithout: {}, valueWith: {} },
    needsReview: { cases: 0, executedWithout: 0, executedWith: 0, heldForPerson: 0 },
    legitimate: { cases: 0, executedWithout: 0, executedWith: 0 },
    attacks: { cases: 0, succeededWithout: 0, succeededWith: 0 },
    fieldsReleased: { without: 0, with: 0 },
    bypass: { attempts: harmful.length, refused: bypassRefused },
    replay: { attempts: grantsUsed.length, refused: replayRefused },
    evidence: { recordsWithout: 0, recordsWith: evidenceCount, ledgerValid: verified.valid, checkpointThroughSeq: checkpoint ? String((checkpoint as { throughSeq: bigint }).throughSeq) : null },
    decisionMs: { p50: pct(cases.map((c) => c.with.decisionMs), 50), p95: pct(cases.map((c) => c.with.decisionMs), 95) },
  };
  for (const c of harmful) {
    addTo(totals.harmful.valueWithout, c.effect);
    if (c.with.executed) addTo(totals.harmful.valueWith, c.effect);
  }
  for (const c of cases) {
    if (c.class === "needs_review") {
      totals.needsReview.cases++;
      totals.needsReview.executedWithout++;
      if (c.with.executed) totals.needsReview.executedWith++;
      if (c.with.outcome === "pending_approval" || c.with.outcome === "awaiting_information") totals.needsReview.heldForPerson++;
    }
    if (c.class === "legitimate") {
      totals.legitimate.cases++;
      totals.legitimate.executedWithout++;
      if (c.with.executed) totals.legitimate.executedWith++;
    }
    if (ATTACK_IDS.has(c.caseId)) {
      totals.attacks.cases++;
      totals.attacks.succeededWithout++;
      if (c.with.executed) totals.attacks.succeededWith++;
    }
    // Narrowing: the fields an agent asked for against the fields the system released.
    if (c.narrowed && c.without.fields !== null) totals.fieldsReleased.without += c.without.fields;
    if (c.narrowed && c.with.fields !== null) totals.fieldsReleased.with += c.with.fields;
  }
  return { notice: IMPACT_NOTICE, startedAt, finishedAt: new Date().toISOString(), orgId, evidenceRange: { fromSeq: firstSeq.toString(), toSeq: lastSeq.toString() }, cases, totals };
}
