/**
 * Pilot kits (docs/PILOTS.md). Each kit is one sector's agent, tools and starting policies, taken from the
 * sector validation lab, installed into a real organization so a pilot starts from a tested configuration.
 * Agents start in watch-only mode by default: AEGIS records what it would decide without holding or
 * refusing anything until the entity switches enforcement on. The pilot report is built only from the
 * organization's own records.
 */
import type { TenantDb } from "@aegis/db";
import { z } from "zod";
import { createAgent, setAgentTool, transitionAgent, upsertTool } from "../agents/registry.js";
import { appendEvidence, verifyChain } from "../evidence/ledger.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../policy/service.js";
import { SECTOR_PACKS, type SectorPack } from "../validation/sector-lab.js";
import { readWatchOnly, setWatchOnly } from "./watch-only.js";

/** Frameworks every kit's evidence maps to, plus sector extras (keys of the shared framework catalogs). */
const BASE_FRAMEWORKS = ["uae-ia", "desc-isr", "iso-42001", "nist-ai-rmf-1.0"];
const SECTOR_FRAMEWORKS: Record<string, string[]> = {
  healthcare: ["uae-pdpl"],
  banking: ["pci-dss-4"],
  telecom: ["uae-pdpl"],
  education: ["uae-pdpl"],
  "public-safety": ["uae-pdpl"],
  "government-services": ["uae-pdpl"],
};

/** What every pilot measures, from the ledger. Entities agree targets for each before the pilot starts. */
export const PILOT_MEASURES = [
  "Actions executed without a valid AEGIS permission: must be zero",
  "Share of actions decided without a person (routine work keeps its speed)",
  "Actions AEGIS would have held, narrowed or refused while in watch-only mode",
  "Time from an approval request to a person's decision",
  "Attacks aimed at the agents caught (hidden instructions, data leaving, bypass attempts)",
  "Evidence ledger verified end to end",
] as const;

export interface PilotKit {
  key: string;
  name: string;
  problem: string;
  agents: { slug: string; name: string; purpose: string }[];
  tools: string[];
  policies: string[];
  frameworks: string[];
  /** The scenarios the kit is proven against in the sector lab. */
  scenarios: { title: string; shows: string; expect: string }[];
}

function kitOf(p: SectorPack): PilotKit {
  return {
    key: p.key,
    name: p.name,
    problem: p.problem,
    agents: p.agents.map(({ slug, name, purpose }) => ({ slug, name, purpose })),
    tools: p.tools.map((t) => t.key),
    policies: p.policies.map((x) => x.key),
    frameworks: [...BASE_FRAMEWORKS, ...(SECTOR_FRAMEWORKS[p.key] ?? [])],
    scenarios: p.cases.map((c) => ({ title: c.title, shows: c.shows, expect: c.expect })),
  };
}

export const PILOT_KITS: PilotKit[] = SECTOR_PACKS.map(kitOf);

export function getPilotKit(key: string): PilotKit {
  const kit = PILOT_KITS.find((k) => k.key === key);
  if (!kit) throw notFound("Pilot kit");
  return kit;
}

export const installKitSchema = z.object({ watchOnly: z.boolean().default(true) });

export interface KitInstallResult {
  kit: string;
  agents: { slug: string; id: string; created: boolean; watchOnly: boolean }[];
  tools: string[];
  policies: { key: string; created: boolean }[];
}

/**
 * Installs a kit into the caller's organization. Safe to repeat: existing tools are updated in place,
 * existing agents and policies with the same key are left as they are. Policies are written by AEGIS
 * (a system author) and activated by the person installing, so four-eyes activation holds.
 */
export async function installPilotKit(db: TenantDb, ctx: OrgContext, key: string, raw: z.input<typeof installKitSchema> = {}): Promise<KitInstallResult> {
  assertPermission(ctx, "agents:write");
  assertPermission(ctx, "policies:activate");
  if (ctx.actor.type !== "user") throw validation("A person installs pilot kits");
  const { watchOnly } = installKitSchema.parse(raw);
  const pack = SECTOR_PACKS.find((p) => p.key === key);
  if (!pack) throw notFound("Pilot kit");
  const system = makeContext(ctx.orgId, { type: "system", id: null, label: `pilot-kit:${key}` });

  const toolIds: Record<string, string> = {};
  for (const t of pack.tools) {
    const row = await upsertTool(db, ctx, { ...t, description: `${t.description}. From the ${pack.name} pilot kit.`, integrationId: null, parameterSchema: {}, destinationRules: { allowedDomains: [], allowedResourceKeys: [] } });
    toolIds[t.key] = row.id;
  }

  const agents: KitInstallResult["agents"] = [];
  const agentIds: Record<string, string> = {};
  for (const a of pack.agents) {
    const existing = await db.agent.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug: a.slug } } });
    let id: string;
    if (existing) id = existing.id;
    else {
      const row = await createAgent(db, ctx, { slug: a.slug, name: a.name, description: `${a.purpose}. Installed from the ${pack.name} pilot kit; connect your own agent to it.`, environment: "production", purpose: a.purpose, dataClassificationLimit: "restricted", riskTier: "high", metadata: { pilotKit: pack.key } });
      await transitionAgent(db, ctx, row.id, "registered", `pilot kit ${pack.key}`);
      await transitionAgent(db, ctx, row.id, "active", `pilot kit ${pack.key}`);
      id = row.id;
    }
    for (const k of a.tools) await setAgentTool(db, ctx, id, toolIds[k]!, true);
    agentIds[a.slug] = id;
    if (watchOnly && !existing) await setWatchOnly(db, ctx, id, { enabled: true, reason: `Pilot watch period (${pack.name} kit)` });
    const meta = (await db.agent.findUniqueOrThrow({ where: { id }, select: { metadata: true } })).metadata;
    agents.push({ slug: a.slug, id, created: !existing, watchOnly: !!readWatchOnly(meta) });
  }

  const policies: KitInstallResult["policies"] = [];
  for (const p of pack.policies) {
    const existing = await db.policy.findFirst({ where: { orgId: ctx.orgId, key: p.key } });
    if (existing) {
      policies.push({ key: p.key, created: false });
      continue;
    }
    const { policy, version } = await createPolicy(db, system, { key: p.key, name: p.name, description: `Starting policy from the ${pack.name} pilot kit. Review the thresholds with the entity before enforcing.`, category: "authorization", document: p.document, changeNote: `Installed from the ${pack.name} pilot kit` });
    await submitForReview(db, system, version.id);
    await activateVersion(db, ctx, version.id);
    await assignPolicy(db, ctx, policy.id, { targetType: "agent", targetId: agentIds[p.agent]!, priority: 100 });
    policies.push({ key: p.key, created: true });
  }

  await appendEvidence(db, ctx, { type: "pilot.kit_installed", subjectType: "organization", subjectId: ctx.orgId, payload: { kit: pack.key, watchOnly, agents: agents.map((a) => a.slug), policies: policies.map((p) => p.key) } });
  return { kit: pack.key, agents, tools: Object.keys(toolIds), policies };
}

export const pilotReportSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  agentIds: z.array(z.string().uuid()).max(100).optional(),
});

export interface PilotReport {
  window: { from: string; to: string };
  agents: { id: string; slug: string; watchOnly: boolean }[];
  actions: { total: number; byStatus: Record<string, number> };
  decisions: { total: number; byResult: Record<string, number>; decidedWithoutPerson: number };
  watchOnly: { passed: number; wouldHave: Record<string, number> };
  approvals: { total: number; byStatus: Record<string, number>; medianMinutesToDecision: number | null };
  security: { total: number; byType: Record<string, number> };
  executedWithoutPermission: number;
  ledger: { valid: boolean; checked: number; reason: string | null };
  notice: string;
}

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

/** The pilot's figures, from the organization's own records only. */
export async function pilotReport(db: TenantDb, ctx: OrgContext, raw: z.input<typeof pilotReportSchema>): Promise<PilotReport> {
  assertPermission(ctx, "reports:read");
  const { from, to, agentIds } = pilotReportSchema.parse(raw);
  if (to <= from) throw validation("The report window must end after it starts");
  const agentFilter = agentIds?.length ? { agentId: { in: agentIds } } : {};
  const agents = await db.agent.findMany({ where: { orgId: ctx.orgId, isLab: false, ...(agentIds?.length ? { id: { in: agentIds } } : {}) }, select: { id: true, slug: true, metadata: true } });
  const requests = await db.actionRequest.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: from, lt: to }, agent: { isLab: false }, ...agentFilter }, select: { id: true, status: true, riskIndicators: true } });
  const requestIds = requests.map((r) => r.id);
  const decisions = requestIds.length ? await db.authorizationDecision.findMany({ where: { orgId: ctx.orgId, actionRequestId: { in: requestIds } }, select: { result: true, actionRequestId: true } }) : [];
  const approvals = requestIds.length ? await db.approvalRequest.findMany({ where: { orgId: ctx.orgId, actionRequestId: { in: requestIds } }, select: { status: true, createdAt: true, decidedAt: true } }) : [];
  const events = await db.securityEvent.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: from, lt: to }, ...(agentIds?.length ? { agentId: { in: agentIds } } : {}) }, select: { type: true, title: true } });
  // Executions are only possible through a consumed grant; a receipt with no consumed grant would be a breach.
  const receipts = requestIds.length ? await db.executionReceipt.findMany({ where: { orgId: ctx.orgId, actionRequestId: { in: requestIds } }, select: { actionRequestId: true } }) : [];
  const granted = new Set(requestIds.length ? (await db.executionGrant.findMany({ where: { orgId: ctx.orgId, actionRequestId: { in: requestIds }, consumedAt: { not: null } }, select: { actionRequestId: true } })).map((g) => g.actionRequestId) : []);
  const wouldHave = requests.flatMap((r) => ((r.riskIndicators as string[]) ?? []).filter((i) => i.startsWith("watch_only:")).map((i) => i.slice("watch_only:".length)));
  const minutes = approvals.filter((a) => a.decidedAt).map((a) => (a.decidedAt!.getTime() - a.createdAt.getTime()) / 60_000).sort((a, b) => a - b);
  const ledger = await verifyChain(db, ctx.orgId);
  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    agents: agents.map((a) => ({ id: a.id, slug: a.slug, watchOnly: !!readWatchOnly(a.metadata) })),
    actions: { total: requests.length, byStatus: tally(requests.map((r) => r.status)) },
    decisions: { total: decisions.length, byResult: tally(decisions.map((d) => d.result)), decidedWithoutPerson: decisions.filter((d) => d.result === "allow" || d.result === "restrict").length },
    watchOnly: { passed: wouldHave.length, wouldHave: tally(wouldHave) },
    approvals: { total: approvals.length, byStatus: tally(approvals.map((a) => a.status)), medianMinutesToDecision: minutes.length ? Math.round(minutes[Math.floor((minutes.length - 1) / 2)]! * 10) / 10 : null },
    security: { total: events.filter((e) => !e.title.startsWith("[lab]")).length, byType: tally(events.filter((e) => !e.title.startsWith("[lab]")).map((e) => e.type)) },
    executedWithoutPermission: receipts.filter((r) => !granted.has(r.actionRequestId)).length,
    ledger: { valid: ledger.valid, checked: ledger.checked, reason: ledger.reason },
    notice: "Figures come from this organization's AEGIS records for the window shown. Watch-only actions proceeded; their counts show what AEGIS would have done.",
  };
}
