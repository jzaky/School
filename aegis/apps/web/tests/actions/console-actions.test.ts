import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerPrisma } from "@aegis/db";
import { CATEGORY_KEYS, createSession, SECTOR_TEMPLATES, SESSION_COOKIE } from "@aegis/core";
import { attacker, changed, domain, fingerprint, PASSWORD, setupWorld, teardownWorld, UUID_RE, victim } from "../../../api/tests/attack-harness";
import { applyIssues, idPicker, type IdFor, type Issue } from "../../../api/tests/body-synthesis";
import { request } from "./stubs/request";

/**
 * Every console server action (src/server/actions), called directly with a real session against a real database,
 * in the two-organization world of the API attack suites. Only the Next.js request plumbing is stubbed
 * (vitest.config.ts). Validation errors are captured to build accepted arguments, as in the API's deep sweep.
 * Passing shows resistance to these attacks, not to every attack.
 */

// Zod failures normally become a message for the form; here they are kept so arguments can be built from them.
vi.mock("../../src/server/actions/util", async (orig) => {
  const real = await orig<typeof import("../../src/server/actions/util")>();
  return {
    ...real,
    act: async <T,>(fn: () => Promise<T>) => {
      try {
        return { ok: true, data: await fn() };
      } catch (e) {
        if (Array.isArray((e as { issues?: unknown }).issues)) return { ok: false, error: "validation", issues: (e as { issues: Issue[] }).issues.map((i) => ({ ...i, path: (i.path as unknown[]).map(String) })) };
        if (real.isNextRedirect(e)) throw e;
        const r = await real.act(async () => {
          throw e;
        });
        // The console's own handling decides: its generic message is what a server error looks like to the user.
        return { ...r, unexpected: !r.ok && r.error.startsWith("Something went wrong") };
      }
    },
  };
});

type Action = { name: string; file: string; fn: (...args: unknown[]) => Promise<unknown>; params: string[] };
const ACTIONS_DIR = fileURLToPath(new URL("../../src/server/actions/", import.meta.url));
const modules: Record<string, () => Promise<unknown>> = Object.fromEntries(
  readdirSync(ACTIONS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [join(ACTIONS_DIR, f), () => import(join(ACTIONS_DIR, f))]),
);
const actions: Action[] = [];

// Actions that end or replace the session doing the attacking, or build a whole demonstration organization; each
// has its own coverage (auth and account tests, the sales demonstration suite).
const SKIP = new Set(["logoutAction", "signOutEverywhereAction", "setupSalesDemoAction", "openSalesDemoAction", "runSalesScenarioAction", "loginAction", "mfaAction"]);

function paramsOf(fn: (...a: unknown[]) => unknown): string[] {
  const src = fn.toString();
  const m = /^[^(]*\(([^)]*)\)/.exec(src);
  return (m?.[1] ?? "")
    .split(",")
    .map((p) => p.replace(/=.*$/, "").trim())
    .filter(Boolean);
}

function initialArg(name: string, idFor: IdFor): unknown {
  if (/formdata/i.test(name)) {
    const f = new FormData();
    f.set("id", idFor("id"));
    f.set("file", new Blob(["attack"], { type: "application/pdf" }), "attack.pdf");
    return f;
  }
  if (/orgid$/i.test(name)) return victimOrgForArgs;
  if (/id$|^id$/i.test(name)) return idFor(name);
  if (/^(key|slug|code|locale|period)$/i.test(name)) return "attack-key";
  if (/reason|note|comment|text|why/i.test(name)) return "attack reason text";
  if (/enabled|on$|approve/i.test(name)) return true;
  return {};
}
let victimOrgForArgs = "";

/**
 * Arguments written by hand for the actions whose input the synthesizer cannot build (positional strings with formats,
 * unions, cross-field rules, CSV, JSON documents). Every id names an object of the organization under attack, so
 * the action's lookups and permission checks run. `pick` returns an id from that organization's table.
 */
type Pick = (table: string) => string;
const HAND_ARGS: Record<string, (pick: Pick) => unknown[]> = {
  confirmMfaAction: () => ["123456"],
  disableMfaAction: () => ["123456"],
  requestAccessAction: (pick) => [{ agentId: pick("agents"), toolId: pick("tools"), actions: [], reason: "access needed for the attack test", durationHours: 1 }],
  resolveDiscoveredAgentAction: (pick) => [pick("discovered_agents"), { action: "link", agentId: pick("agents") }],
  transitionAgentAction: (pick) => [pick("agents"), "suspended", "attack test reason"],
  provideApprovalInfoAction: (pick) => [pick("approval_requests"), "attack information"],
  getEvidenceEventAction: () => ["1"],
  downloadReportAction: () => [7],
  createRuleAction: () => [{ key: "AT-901", name: "Attack rule", severity: "low", definition: { type: "repeated_denials", threshold: 5, windowMinutes: 60 } }],
  deleteDocumentAction: (pick) => [pick("documents"), true],
  previewControlsCsvAction: () => ["ref,title,description\nAT-1,Attack control,Attack"],
  importControlsAction: (pick) => [pick("frameworks"), "ref,title,description\nAT-1,Attack control,Attack"],
  createDestinationAction: () => [{ kind: "webhook", url: "https://hooks.attack.example/x", name: "Attack destination", categories: [CATEGORY_KEYS[0]] }],
  createFreezeAction: (pick) => [{ title: "Attack freeze", reason: "attack test reason", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), effect: "deny", minRiskLevel: "low", agentIds: [pick("agents")] }],
  setIntegrationStatusAction: (pick) => [pick("integrations"), "disabled", "attack test reason"],
  setLocaleAction: () => ["ar"],
  markNotificationsReadAction: (pick) => [[pick("notifications")]],
  setMemberStatusAction: (pick) => [pick("memberships"), "suspended"],
  setTeamMembersAction: (pick) => [pick("teams"), [pick("memberships")], null],
  createPolicyAction: () => [{ key: "atk-console-policy", name: "Attack policy", description: "", category: "authorization", changeNote: "attack test", document: JSON.stringify({ version: 1, appliesTo: { tools: [], actions: [], environments: [] }, rules: [{ id: "allow-all", description: "", effect: "allow", when: { attr: "action", op: "exists" }, reason: "allow", riskIndicators: [] }], tests: [] }) }],
  previewSectorTemplateAction: () => [SECTOR_TEMPLATES[0]!.id, {}],
  createFromSectorTemplateAction: () => [SECTOR_TEMPLATES[0]!.id, {}, { key: "atk-sector-policy", name: "Attack sector policy" }],
  globalSearchAction: () => ["Agent"],
};
const pickFrom = (byTable: Map<string, string[]>, fallback: string): Pick => (table) => byTable.get(table)?.[0] ?? fallback;
let currentPick: Pick = () => "";

interface Outcome {
  name: string;
  ok: boolean;
  redirect: string | null;
  unexpected: boolean;
  leaked: string[];
  rounds: number;
  /** Still failing input validation after synthesis: the attack did not reach the action's checks. */
  invalid: boolean;
}

async function attack(a: Action, idFor: IdFor): Promise<Outcome> {
  const args = HAND_ARGS[a.name] ? HAND_ARGS[a.name]!(currentPick) : a.params.map((p) => initialArg(p, idFor));
  const objectArg = args.findIndex((x) => x && typeof x === "object" && !Array.isArray(x));
  let rounds = 0;
  for (;;) {
    rounds++;
    let r: unknown;
    try {
      r = await a.fn(...args);
    } catch (e) {
      const d = (e as { digest?: string }).digest;
      if (d?.startsWith("NEXT_REDIRECT")) return { name: a.name, ok: false, redirect: d.split(";")[2] ?? "?", unexpected: false, leaked: [], rounds, invalid: false };
      return { name: a.name, ok: false, redirect: null, unexpected: true, leaked: [], rounds, invalid: false };
    }
    const res = (r ?? {}) as { ok?: boolean; issues?: Issue[]; unexpected?: boolean };
    if (res.issues && objectArg >= 0 && rounds < 12 && applyIssues(args[objectArg] as Record<string, unknown>, res.issues, idFor)) continue;
    const sent = new Set(JSON.stringify(args).match(UUID_RE) ?? []);
    const leaked = [...new Set(JSON.stringify(r ?? null).match(UUID_RE) ?? [])].filter((id) => victim.ids.has(id) && !sent.has(id));
    return { name: a.name, ok: res.ok !== false, redirect: null, unexpected: !!res.unexpected, leaked, rounds, invalid: !!res.issues };
  }
}

const cookieFor = async (userId: string) => (await createSession(userId, { activeOrgId: attacker.orgId, mfaPassed: true })).token;
let ownerToken = "";
let viewerToken = "";

beforeAll(async () => {
  await setupWorld();
  victimOrgForArgs = victim.orgId;
  for (const [file, load] of Object.entries(modules)) {
    const mod = (await load()) as Record<string, unknown>;
    if (file.endsWith("/util.ts")) continue; // shared helpers, not actions
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== "function" || SKIP.has(name)) continue;
      actions.push({ name, file: file.split("/").pop()!, fn: fn as Action["fn"], params: paramsOf(fn as Action["fn"]) });
    }
  }
  const owner = await ownerPrisma().user.findFirstOrThrow({ where: { email: `attacker@${domain}` } });
  const viewer = await ownerPrisma().user.findFirstOrThrow({ where: { email: `viewer@${domain}` } });
  ownerToken = await cookieFor(owner.id);
  viewerToken = await cookieFor(viewer.id);
}, 300_000);
afterAll(teardownWorld);

const signIn = (token: string | null) => {
  request.cookies.clear();
  request.headers.clear();
  if (token) request.cookies.set(SESSION_COOKIE, token);
};

describe("console server actions", () => {
  it("every console server action is attacked: in the sweeps below, or (the seven in SKIP) in their own tests", async () => {
    expect(actions.length).toBeGreaterThan(190);
    const all: string[] = [];
    for (const [file, load] of Object.entries(modules)) {
      if (file.endsWith("/util.ts")) continue;
      for (const [name, fn] of Object.entries((await load()) as Record<string, unknown>)) if (typeof fn === "function") all.push(name);
    }
    expect(all.length).toBe(actions.length + SKIP.size);
    for (const name of SKIP) expect(all, name).toContain(name);
    console.log(`console actions: ${all.length} in all, ${actions.length} swept, ${SKIP.size} in their own tests`);
  });

  it("signed out, no action runs: each redirects to sign-in, and nothing changes", async () => {
    // Public by design: the marketing contact form, the language switch and the support form on the public site.
    const PUBLIC = new Set(["submitMarketingForm", "setLocaleAction", "createSupportRequestAction"]);
    const before = { a: await fingerprint(attacker.orgId), v: await fingerprint(victim.orgId) };
    const ran: string[] = [];
    for (const a of actions) {
      signIn(null);
      const o = await attack(a, idPicker(attacker.byTable, attacker.byTable.get("agents")![0]!));
      if (!PUBLIC.has(a.name) && (o.ok || o.unexpected || (o.redirect !== "/login" && o.redirect !== null))) ran.push(`${a.file} ${a.name} ${o.redirect ?? (o.ok ? "ok" : "error")}`);
    }
    expect(ran).toEqual([]);
    expect(changed(before.a, await fingerprint(attacker.orgId))).toEqual([]);
    expect(changed(before.v, await fingerprint(victim.orgId))).toEqual([]);
  });

  it("the attacker's owner, naming the victim's objects in every argument: the victim is unchanged and nothing leaks", async () => {
    const victimIds = idPicker(victim.byTable, victim.byTable.get("agents")![0]!);
    currentPick = pickFrom(victim.byTable, victim.byTable.get("agents")![0]!);
    const before = await fingerprint(victim.orgId);
    const out: Outcome[] = [];
    for (const a of actions) {
      signIn(ownerToken);
      out.push(await attack(a, victimIds));
    }
    // Every action must reach its lookups and permission checks: none may stop at input validation.
    expect(out.filter((o) => o.invalid).map((o) => o.name)).toEqual([]);
    // No reference in the attacker's organization may now point at a victim object. References are the uuid-typed
    // columns; free-text fields and the attacker's own evidence may hold whatever the attacker typed.
    const cols = await ownerPrisma().$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.columns o ON o.table_name = c.table_name AND o.table_schema = c.table_schema AND o.column_name = 'org_id'
        WHERE c.table_schema = 'public' AND c.data_type = 'uuid' AND c.column_name NOT IN ('id', 'org_id')`,
    );
    const refs: string[] = [];
    for (const { table_name, column_name } of cols) {
      const rows = await ownerPrisma().$queryRawUnsafe<{ v: string }[]>(`SELECT "${column_name}"::text AS v FROM "${table_name}" WHERE org_id = $1::uuid AND "${column_name}" IS NOT NULL`, attacker.orgId);
      for (const r of rows) if (victim.ids.has(r.v)) refs.push(`${table_name}.${column_name} -> ${r.v}`);
    }
    expect(refs).toEqual([]);
    expect(changed(before, await fingerprint(victim.orgId))).toEqual([]);
    expect(out.filter((o) => o.leaked.length).map((o) => `${o.name} -> ${o.leaked.join(",")}`)).toEqual([]);
    expect(out.filter((o) => o.unexpected).map((o) => o.name)).toEqual([]);
  });

  it("a viewer, with the organization's own ids, writes nothing outside the allow-list", async () => {
    // What a viewer may do, and why. Anything else that succeeds, writes another table or records another kind of
    // evidence fails the test.
    const ALLOWED_ACTIONS = new Set([
      // Their own account: start two-factor enrolment.
      "beginMfaAction",
      // Reads and dry runs (agents:read, evidence:read, security:read): nothing is written but the record of an export or check.
      "exportAgentsCsvAction", "previewAiDecisionAction", "verifyChainAction", "exportEvidenceAction", "simulateAutonomyAction", "activityFeedAction", "listNotificationsAction",
      "previewRefundTemplateAction", "previewScoreBandTemplateAction", "previewTradingTemplateAction", "testSampleAction", "injectionSignalsAction", "evaluateToolSecurityAction",
      // Any member: a personal AI gateway key (ai:chat only, expiring), a support request, an enterprise pricing enquiry.
      "issuePersonalAiKeyAction", "createSupportRequestAction", "requestEnterprisePricingAction",
      // Their own preferences and inbox, and reads (evidence:read, reports:read, audit:read): the language, marking
      // their own notifications read, one evidence event, the governance report (recorded), a CSV preview, a template
      // preview, search.
      "setLocaleAction", "markNotificationsReadAction", "getEvidenceEventAction", "downloadReportAction", "previewControlsCsvAction", "previewSectorTemplateAction", "globalSearchAction",
    ]);
    const ALLOWED_TABLES = new Set(["api_keys", "evidence_events", "support_requests", "notifications"]);
    const ALLOWED_EVIDENCE = new Set(["api_key.issued", "evidence.verified", "evidence.exported", "support.requested", "report.generated"]);
    const ownIds = idPicker(attacker.byTable, attacker.byTable.get("agents")![0]!);
    victimOrgForArgs = attacker.orgId;
    currentPick = pickFrom(attacker.byTable, attacker.byTable.get("agents")![0]!);
    const before = await fingerprint(attacker.orgId);
    const seq0 = (await ownerPrisma().evidenceEvent.aggregate({ where: { orgId: attacker.orgId }, _max: { seq: true } }))._max.seq ?? -1n;
    const bad: string[] = [];
    for (const a of actions) {
      signIn(viewerToken);
      const o = await attack(a, ownIds);
      if ((o.ok && !ALLOWED_ACTIONS.has(a.name)) || o.unexpected || o.invalid) bad.push(`${a.file} ${a.name}${o.unexpected ? " (server error)" : o.invalid ? " (did not get past validation)" : ""}`);
    }
    const types = [...new Set((await ownerPrisma().evidenceEvent.findMany({ where: { orgId: attacker.orgId, seq: { gt: seq0 } }, select: { type: true } })).map((e) => e.type))];
    // platform_events is the platform's own sales log, not the organization's data; the pricing enquiry writes it.
    bad.push(...changed(before, await fingerprint(attacker.orgId)).filter((t) => !ALLOWED_TABLES.has(t) && t !== "platform_events").map((t) => `changed ${t}`));
    bad.push(...types.filter((t) => !ALLOWED_EVIDENCE.has(t)).map((t) => `evidence ${t}`));
    expect(bad).toEqual([]);
  });

  it("API keys are not console credentials: an agent or integration key, as a header or as the cookie, opens no action", async () => {
    const keys = [attacker.agentKeys[0]!, attacker.integrationKeys[0]!];
    const ran: string[] = [];
    for (const key of keys) {
      for (const a of actions) {
        request.cookies.clear();
        request.headers.clear();
        request.headers.set("authorization", `Bearer ${key}`);
        if (a.name.length % 2) request.cookies.set(SESSION_COOKIE, key);
        const o = await attack(a, idPicker(attacker.byTable, attacker.byTable.get("agents")![0]!));
        const PUBLIC = new Set(["submitMarketingForm", "setLocaleAction", "createSupportRequestAction"]);
        if (!PUBLIC.has(a.name) && (o.ok || o.unexpected || o.redirect !== "/login")) ran.push(`${a.name} ${o.redirect ?? (o.ok ? "ok" : "error")}`);
      }
    }
    expect(ran).toEqual([]);
  });
});

describe("session, sign-in and demonstration actions", () => {
  const mod = async <T,>(file: string) => (await import(join(ACTIONS_DIR, file))) as T;
  type Auth = typeof import("../../src/server/actions/auth");
  type Account = typeof import("../../src/server/actions/account");
  type Commercial = typeof import("../../src/server/actions/commercial");
  const redirectOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return ((e as { digest?: string }).digest ?? "").split(";")[2] ?? "?";
    }
  };
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("sign-in: the victim's email with a wrong password fails and opens no session; the next page is always a path on this site", async () => {
    const { loginAction } = await mod<Auth>("auth.ts");
    signIn(null);
    const before = await ownerPrisma().session.count({ where: { userId: victim.ownerId } });
    expect(await loginAction({}, form({ email: `victim@${domain}`, password: "not-the-password-1A" }))).toMatchObject({ error: expect.any(String) });
    expect(await ownerPrisma().session.count({ where: { userId: victim.ownerId } })).toBe(before);
    // An open redirect after sign-in would hand a phishing page the user's trust in the real sign-in page.
    for (const next of ["//evil.example/x", "/\\evil.example/x", "/\\/evil.example", "https://evil.example", "/\tevil.example", "/\r\nSet-Cookie:x", "javascript:alert(1)"]) {
      signIn(null);
      const to = await redirectOf(loginAction({}, form({ email: `attacker@${domain}`, password: PASSWORD, next })));
      expect(to, next).toBe("/overview");
    }
    // A percent-encoded line break stays encoded: a path on this site, with no header in it.
    signIn(null);
    const encoded = await redirectOf(loginAction({}, form({ email: `attacker@${domain}`, password: PASSWORD, next: "/%0d%0aSet-Cookie:x" })));
    expect(encoded).toMatch(/^\/(?![/\\])/);
    expect(encoded).not.toMatch(/[\r\n]/);
    signIn(null);
    expect(await redirectOf(loginAction({}, form({ email: `attacker@${domain}`, password: PASSWORD, next: "/agents?tab=all" })))).toBe("/agents?tab=all");
  });

  it("two-factor step without a session goes to sign-in", async () => {
    const { mfaAction } = await mod<Auth>("auth.ts");
    signIn(null);
    expect(await redirectOf(mfaAction({}, form({ code: "123456" })))).toBe("/login");
  });

  it("signing out, and signing out everywhere, end only the user's own sessions", async () => {
    const { logoutAction } = await mod<Auth>("auth.ts");
    const { signOutEverywhereAction } = await mod<Account>("account.ts");
    const viewer = await ownerPrisma().user.findFirstOrThrow({ where: { email: `viewer@${domain}` } });
    const victimLive = () => ownerPrisma().session.count({ where: { userId: victim.ownerId, revokedAt: null } });
    await createSession(victim.ownerId, { activeOrgId: victim.orgId, mfaPassed: true });
    const v0 = await victimLive();
    const live = () => ownerPrisma().session.count({ where: { userId: viewer.id, revokedAt: null } });
    const a = await cookieFor(viewer.id);
    await cookieFor(viewer.id);
    // "Sign out everywhere" keeps the session that asked and ends every other one of the same user.
    signIn(a);
    expect(await signOutEverywhereAction()).toMatchObject({ ok: true });
    expect(await live()).toBe(1);
    expect(await redirectOf(logoutAction())).toBe("/login");
    expect(await live()).toBe(0);
    // A signed-out cookie opens nothing.
    expect(await redirectOf(signOutEverywhereAction())).toBe("/login");
    expect(await victimLive()).toBe(v0);
    viewerToken = await cookieFor(viewer.id);
  });

  it("sales demonstrations: refused outside a demonstration organization, and never touch another organization", async () => {
    const { setupSalesDemoAction, openSalesDemoAction, runSalesScenarioAction } = await mod<Commercial>("commercial.ts");
    const before = await fingerprint(victim.orgId);
    const orgs0 = await ownerPrisma().organization.count();
    signIn(viewerToken);
    expect(await setupSalesDemoAction()).toMatchObject({ ok: false });
    expect(await openSalesDemoAction()).toMatchObject({ ok: false });
    signIn(ownerToken);
    expect(await runSalesScenarioAction("finance")).toMatchObject({ ok: false });
    expect(await ownerPrisma().organization.count()).toBe(orgs0);
    expect(changed(before, await fingerprint(victim.orgId))).toEqual([]);
  });
});
