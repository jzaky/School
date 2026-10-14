/**
 * Microsoft Entra ID connector (docs/ENTRA_CONNECTOR.md) against a local stand-in for the Microsoft identity
 * platform and Microsoft Graph that follows their documented request and response shapes. It proves AEGIS's
 * own behaviour (token handling, paging, windows, retries, errors, data minimisation), not Microsoft's.
 * All records are synthetic.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { disconnectAll, withTenant, type TenantDb } from "@aegis/db";
import { env } from "../src/env.js";
import { makeTestTenant, addUserWithRole, type TestTenant } from "./helpers.js";
import { clearEntraTokens, connectEntra, disconnectEntra, entraStatus, explainGraphError, setEntraTransport, syncEntra, testEntraConnection } from "../src/secure/entra.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "66666666-7777-8888-9999-000000000000";
let server: Server;
let base = "";
let t: TestTenant;
let ownerEmail = "";
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);

// Stand-in state.
let tokenIssued = 0;
const tokenExpiresIn = 3599;
let validToken = "";
let throttleNext = 0;
let signInMode: "ok" | "nonpremium" | "forbidden" = "ok";
const graphCalls: string[] = [];
let signIns: Record<string, unknown>[] = [];
let audits: Record<string, unknown>[] = [];
const PAGE = 2; // the stand-in pages every 2 records to exercise nextLink

function filterRange(url: URL, field: string, items: Record<string, unknown>[]) {
  const f = url.searchParams.get("$filter") ?? "";
  const ge = /ge (\S+)/.exec(f)?.[1];
  const lt = /lt (\S+)/.exec(f)?.[1];
  return items.filter((i) => (!ge || String(i[field]) >= ge) && (!lt || String(i[field]) < lt));
}

beforeAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = true;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const send = (status: number, obj: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(obj));
      };
      if (url.pathname === `/login/${TENANT}/oauth2/v2.0/token`) {
        const p = new URLSearchParams(body);
        if (p.get("client_secret") !== "correct-secret-value") return send(401, { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." });
        if (p.get("grant_type") !== "client_credentials" || !p.get("scope")?.endsWith("/.default")) return send(400, { error: "invalid_request" });
        tokenIssued++;
        validToken = `tok-${tokenIssued}`;
        return send(200, { token_type: "Bearer", expires_in: tokenExpiresIn, access_token: validToken });
      }
      if (req.headers.authorization !== `Bearer ${validToken}`) return send(401, { error: { code: "InvalidAuthenticationToken", message: "Access token has expired." } });
      graphCalls.push(url.pathname + url.search);
      if (throttleNext > 0) {
        throttleNext--;
        return send(429, { error: { code: "TooManyRequests" } }, { "retry-after": "2" });
      }
      const page = Number(url.searchParams.get("skip") ?? "0");
      const pageOf = (items: Record<string, unknown>[]) => {
        const slice = items.slice(page, page + PAGE);
        const next = page + PAGE < items.length ? `${base}/graph${url.pathname.replace("/graph", "")}?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), skip: String(page + PAGE) })}` : undefined;
        return { value: slice, ...(next ? { "@odata.nextLink": next } : {}) };
      };
      if (url.pathname === "/graph/auditLogs/signIns") {
        if (signInMode === "nonpremium") return send(403, { error: { code: "Authentication_RequestFromNonPremiumTenantOrB2CTenant", message: "Neither tenant is B2C or tenant doesn't have premium license" } });
        if (signInMode === "forbidden") return send(403, { error: { code: "Authorization_RequestDenied", message: "Insufficient privileges to complete the operation." } });
        return send(200, pageOf(filterRange(url, "createdDateTime", signIns)));
      }
      if (url.pathname === "/graph/auditLogs/directoryAudits") return send(200, pageOf(filterRange(url, "activityDateTime", audits)));
      return send(404, { error: { code: "NotFound" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  setEntraTransport(null, async () => undefined); // real HTTP to the stand-in, no real waiting on back-off
  t = await makeTestTenant("entra");
  ownerEmail = (await run((db) => db.membership.findFirstOrThrow({ where: { userId: t.ownerUserId }, select: { user: { select: { email: true } } } }))).user.email;
}, 60_000);

afterAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = false;
  setEntraTransport(null);
  await new Promise<void>((r) => server.close(() => r()));
  await t.cleanup();
  await disconnectAll();
});

beforeEach(() => {
  graphCalls.length = 0;
  throttleNext = 0;
  signInMode = "ok";
});

const NOW = new Date("2026-10-14T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const connect = (secret = "correct-secret-value") => run((db) => connectEntra(db, t.ownerCtx, { tenantId: TENANT, clientId: CLIENT, clientSecret: secret, backfillDays: 1, authorityUrl: `${base}/login`, graphUrl: `${base}/graph` }));

describe("Microsoft Entra ID connector", () => {
  it("a wrong client secret gives a plain explanation and nothing is stored from Microsoft", async () => {
    await connect("wrong-secret-value");
    clearEntraTokens();
    const r = await testEntraConnection(run, t.ownerCtx);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/client secret: it is wrong or has expired/);
  });

  it("the test reads one record from each feed with a token from the client credentials flow", async () => {
    await connect();
    clearEntraTokens();
    const r = await testEntraConnection(run, t.ownerCtx);
    expect(r).toMatchObject({ ok: true, signIns: true, consents: true });
    const status = await run((db) => entraStatus(db, t.ownerCtx));
    expect(status).toMatchObject({ active: true, secret: "stored", tenantId: TENANT });
    expect(JSON.stringify(status)).not.toContain("correct-secret-value");
  });

  it("sync pages through every record, keeps only AI matches, links members, and moves the cursor", async () => {
    signIns = [
      { createdDateTime: minutesAgo(600), userPrincipalName: ownerEmail, appDisplayName: "ChatGPT Enterprise", status: { errorCode: 0 }, deviceDetail: { deviceId: "d1" } },
      { createdDateTime: minutesAgo(500), userPrincipalName: "guest@example.com", appDisplayName: "Claude", status: { errorCode: 0 } },
      { createdDateTime: minutesAgo(400), userPrincipalName: ownerEmail, appDisplayName: "Claude", status: { errorCode: 50126 } },
      { createdDateTime: minutesAgo(300), userPrincipalName: ownerEmail, appDisplayName: "Office 365 Exchange Online", status: { errorCode: 0 } },
      { createdDateTime: minutesAgo(200), userPrincipalName: ownerEmail, appDisplayName: "Cursor", status: { errorCode: 0 } },
      { createdDateTime: minutesAgo(5), userPrincipalName: ownerEmail, appDisplayName: "Perplexity", status: { errorCode: 0 } },
    ];
    audits = [{ activityDateTime: minutesAgo(100), activityDisplayName: "Consent to application", result: "success", initiatedBy: { user: { userPrincipalName: ownerEmail } }, targetResources: [{ type: "ServicePrincipal", displayName: "DeepSeek" }] }];
    const r = await syncEntra(run, t.ownerCtx, { now: NOW });
    expect(r.errors).toEqual([]);
    // Five sign-ins and one consent are older than the 15-minute lag; the newest sign-in waits for the next run.
    expect(r.signIns).toBe(5);
    expect(r.consents).toBe(1);
    expect(r.matched).toBe(4); // ChatGPT, Claude (guest), Cursor, DeepSeek consent; the failed sign-in and Exchange are not AI use
    expect(graphCalls.some((c) => c.includes("skip=2"))).toBe(true);
    const signals = await run((db) => db.discoverySignal.findMany({ where: { source: { in: ["entra", "entra_consent"] } } }));
    expect(signals.map((s) => s.appKey).sort()).toEqual(["chatgpt", "claude", "cursor", "deepseek"]);
    expect(signals.find((s) => s.appKey === "claude")!.userId).toBeNull();
    expect(JSON.stringify(signals)).not.toContain("guest@example.com");
    expect(JSON.stringify(signals)).not.toContain("Exchange");
    expect(signals.find((s) => s.appKey === "deepseek")).toMatchObject({ source: "entra_consent", confidence: "confirmed" });
    const status = await run((db) => entraStatus(db, t.ownerCtx));
    expect(status!.cursorSignIns).toBe(new Date(NOW.getTime() - 15 * 60_000).toISOString());
    expect(status!.lastError).toBeNull();
  });

  it("the next run is incremental and re-running is harmless", async () => {
    const later = new Date(NOW.getTime() + 30 * 60_000);
    const r = await syncEntra(run, t.ownerCtx, { now: later });
    expect(r.signIns).toBe(1); // only the Perplexity sign-in, now past the lag
    expect(r.matched).toBe(1);
    const again = await syncEntra(run, t.ownerCtx, { now: later });
    expect(again.signIns).toBe(0);
    expect(await run((db) => db.discoverySignal.count({ where: { source: "entra" } }))).toBe(4);
  });

  it("throttling is retried after Retry-After, and an expired token is refreshed once", async () => {
    throttleNext = 2;
    validToken = "rotated-by-microsoft"; // the cached token no longer works: the connector must get a new one
    const r = await syncEntra(run, t.ownerCtx, { now: new Date(NOW.getTime() + 60 * 60_000) });
    expect(r.errors).toEqual([]);
    expect(throttleNext).toBe(0);
  });

  it("a tenant whose sign-in logs are not available still syncs consents, and says why", async () => {
    signInMode = "nonpremium";
    const r = await syncEntra(run, t.ownerCtx, { now: new Date(NOW.getTime() + 120 * 60_000) });
    expect(r.errors.join(" ")).toMatch(/premium Entra ID licence/);
    const status = await run((db) => entraStatus(db, t.ownerCtx));
    expect(status!.lastError).toMatch(/premium/);
    expect(status!.cursorConsents! > status!.cursorSignIns!).toBe(true);
  });

  it("missing permissions are explained, and a viewer cannot connect", async () => {
    expect(explainGraphError(403, JSON.stringify({ error: { code: "Authorization_RequestDenied" } }))).toMatch(/AuditLog.Read.All and Directory.Read.All/);
    const viewer = await addUserWithRole(t, "viewer", "ev");
    await expect(run((db) => connectEntra(db, viewer.ctx, { tenantId: TENANT, clientId: CLIENT, clientSecret: "x".repeat(10) }))).rejects.toThrow();
  });

  it("disconnecting revokes the secret and stops syncing", async () => {
    await run((db) => disconnectEntra(db, t.ownerCtx, "Pilot finished"));
    await expect(syncEntra(run, t.ownerCtx)).rejects.toThrow(/Active Microsoft Entra ID connection/);
  });
});
