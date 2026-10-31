import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerPrisma } from "@aegis/db";
import { as, attacker, changed, fill, fingerprint, send, setupWorld, sweepRoutes, teardownWorld, victim, type Hit } from "./attack-harness.js";
import { applyIssues, idPicker, issuesOf, type IdFor } from "./body-synthesis.js";

/**
 * Validation phase 2: write routes attacked with bodies they accept. The first sweep's generic bodies stopped at
 * input validation on 1,458 of 3,769 requests; here each body is built from the route's own validation errors
 * (body-synthesis.ts) until the route answers something other than 400, so the attack reaches lookups and
 * permission checks. Passing shows resistance to these attacks, not to every attack.
 */
beforeAll(setupWorld, 300_000);
afterAll(teardownWorld);

// Signing out would end the attacking session; it has its own tests.
const SELF_ENDING = ["/v1/auth/logout"];
const writeRoutes = () => sweepRoutes().filter((r) => r.method !== "GET" && !SELF_ENDING.includes(r.url));

/** The segment before a path parameter names its table: /v1/policies/:id takes a policy id. */
function paramIdFor(url: string, idFor: IdFor) {
  return (param: string) => {
    if (param === "key" || param === "integrationKey") return "victim-crm";
    if (param === "seq") return "1";
    const segs = url.split("/");
    const before = segs[segs.indexOf(`:${param}`) - 1] ?? "";
    return idFor(param === "id" ? before.replace(/s$/, "") : param);
  };
}

async function attack(method: string, url: string, headers: Record<string, string>, idFor: IdFor): Promise<{ hit: Hit; rounds: number; body: Record<string, unknown> }> {
  const body: Record<string, unknown> = {};
  let hit = await send({ method, url, headers, payload: body });
  let rounds = 1;
  while (hit.status === 400 && rounds < 12) {
    if (!applyIssues(body, issuesOf(hit.body), idFor)) break;
    hit = await send({ method, url, headers, payload: body });
    rounds++;
  }
  return { hit, rounds, body };
}

describe("cross-tenant with accepted bodies", () => {
  it("every write route, the attacker's owner, every id-shaped field and parameter naming a victim object: nothing changes, nothing leaks", async () => {
    const victimIds = idPicker(victim.byTable, victim.byTable.get("agents")![0]!);
    const before = await fingerprint(victim.orgId);
    const results: { route: string; status: number; rounds: number }[] = [];
    const leaks: string[] = [];
    for (const r of writeRoutes()) {
      const url = fill(r.url, paramIdFor(r.url, victimIds));
      const { hit, rounds } = await attack(r.method, url, as.owner(), victimIds);
      results.push({ route: `${r.method} ${r.url}`, status: hit.status, rounds });
      if (hit.leaked.length) leaks.push(`${r.method} ${r.url} -> ${hit.leaked.join(",")}`);
    }
    const after = await fingerprint(victim.orgId);
    const stillInvalid = results.filter((x) => x.status === 400);
    const byStatus: Record<number, number> = {};
    for (const x of results) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    console.log(`deep cross-tenant: ${results.length} write routes, statuses ${JSON.stringify(byStatus)}, still 400: ${stillInvalid.map((x) => x.route).join("; ")}`);
    expect(changed(before, after)).toEqual([]);
    expect(leaks).toEqual([]);
    expect(results.filter((x) => x.status >= 500).map((x) => `${x.status} ${x.route}`)).toEqual([]);
  }, 900_000);
});

/**
 * What each low-privilege principal may write, and why. Anything else that answers 2xx, writes another table or
 * records another kind of evidence fails the test.
 */
const ALLOWED: Record<"viewer" | "agent" | "integration", { routes: string[]; tables: string[]; evidence: string[] }> = {
  viewer: {
    // Verifying the evidence chain records that it ran; inspection and injection checks are dry runs (security:read);
    // any member may ask for a piece of software to be assessed (org:read).
    routes: ["POST /v1/assurance/evidence/verify", "POST /v1/shield/inspect", "POST /v1/shield/injection-check", "POST /v1/software"],
    tables: ["evidence_events", "software_items", "software_findings", "software_components"],
    evidence: ["evidence.verified", "software.requested", "software.assessed"],
  },
  agent: {
    // An agent submits actions (here refused) and reports the definitions of the tools it holds (pin or hold only).
    routes: ["POST /v1/gateway/actions", "POST /v1/tool-definitions/report"],
    tables: ["evidence_events", "action_requests", "authorization_decisions"],
    evidence: ["gateway.request_received", "gateway.decision.deny", "tool.definition_pinned"],
  },
  integration: {
    // A system of record reports agents it sees, its tools' definitions and payment documents; a failed grant check
    // and a bad webhook signature are recorded.
    routes: ["POST /v1/identity/discovery/agents", "POST /v1/tool-definitions/report", "POST /v1/payment-documents/register"],
    tables: ["evidence_events", "discovered_agents", "security_events", "payment_documents"],
    evidence: ["discovery.agent_unregistered", "security_event.created", "payment_document.registered", "gateway.grant_rejected_downstream", "webhook.rejected", "tool.definition_pinned"],
  },
};

describe("privilege with accepted bodies", () => {
  it("a viewer, an agent key and an integration key, with the attacker organization's own ids, write nothing outside their allow-list", async () => {
    const ownIds = idPicker(attacker.byTable, attacker.byTable.get("agents")![0]!);
    const report: Record<string, string[]> = {};
    for (const who of ["viewer", "agent", "integration"] as const) {
      const before = await fingerprint(attacker.orgId);
      const seq0 = (await ownerPrisma().evidenceEvent.aggregate({ where: { orgId: attacker.orgId }, _max: { seq: true } }))._max.seq ?? -1n;
      const out: string[] = [];
      for (const r of writeRoutes()) {
        const url = fill(r.url, paramIdFor(r.url, ownIds));
        const { hit } = await attack(r.method, url, as[who](), ownIds);
        if ((hit.status < 300 && !ALLOWED[who].routes.includes(`${r.method} ${r.url}`)) || hit.status >= 500) out.push(`${hit.status} ${r.method} ${r.url}`);
      }
      const after = await fingerprint(attacker.orgId);
      const types = (await ownerPrisma().evidenceEvent.findMany({ where: { orgId: attacker.orgId, seq: { gt: seq0 } }, select: { type: true } })).map((e) => e.type);
      report[who] = [
        ...out,
        ...changed(before, after).filter((t) => !ALLOWED[who].tables.includes(t)).map((t) => `changed ${t}`),
        ...[...new Set(types)].filter((t) => !ALLOWED[who].evidence.includes(t)).map((t) => `evidence ${t}`),
      ];
    }
    expect(report).toEqual({ viewer: [], agent: [], integration: [] });
  }, 900_000);
});
