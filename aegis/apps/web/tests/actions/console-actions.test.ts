import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerPrisma } from "@aegis/db";
import { createSession, SESSION_COOKIE } from "@aegis/core";
import { attacker, changed, domain, fingerprint, setupWorld, teardownWorld, UUID_RE, victim } from "../../../api/tests/attack-harness";
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
  const args = a.params.map((p) => initialArg(p, idFor));
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
  it("finds the console's server actions", () => {
    expect(actions.length).toBeGreaterThan(190);
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
    const before = await fingerprint(victim.orgId);
    const out: Outcome[] = [];
    for (const a of actions) {
      signIn(ownerToken);
      out.push(await attack(a, victimIds));
    }
    console.log(`console cross-tenant: ${out.length} actions, ok ${out.filter((o) => o.ok).length}, still invalid ${out.filter((o) => o.invalid).length} (${out.filter((o) => o.invalid).map((o) => o.name).join(", ")})`);
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
    ]);
    const ALLOWED_TABLES = new Set(["api_keys", "evidence_events", "support_requests"]);
    const ALLOWED_EVIDENCE = new Set(["api_key.issued", "evidence.verified", "evidence.exported", "support.requested"]);
    const ownIds = idPicker(attacker.byTable, attacker.byTable.get("agents")![0]!);
    victimOrgForArgs = attacker.orgId;
    const before = await fingerprint(attacker.orgId);
    const seq0 = (await ownerPrisma().evidenceEvent.aggregate({ where: { orgId: attacker.orgId }, _max: { seq: true } }))._max.seq ?? -1n;
    const bad: string[] = [];
    for (const a of actions) {
      signIn(viewerToken);
      const o = await attack(a, ownIds);
      if ((o.ok && !ALLOWED_ACTIONS.has(a.name)) || o.unexpected) bad.push(`${a.file} ${a.name}${o.unexpected ? " (server error)" : ""}`);
    }
    const types = [...new Set((await ownerPrisma().evidenceEvent.findMany({ where: { orgId: attacker.orgId, seq: { gt: seq0 } }, select: { type: true } })).map((e) => e.type))];
    // platform_events is the platform's own sales log, not the organization's data; the pricing enquiry writes it.
    bad.push(...changed(before, await fingerprint(attacker.orgId)).filter((t) => !ALLOWED_TABLES.has(t) && t !== "platform_events").map((t) => `changed ${t}`));
    bad.push(...types.filter((t) => !ALLOWED_EVIDENCE.has(t)).map((t) => `evidence ${t}`));
    expect(bad).toEqual([]);
  });
});
