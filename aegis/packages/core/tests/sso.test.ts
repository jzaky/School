import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUserWithRole, makeTestTenant, withTenant, type TestTenant } from "./helpers.js";
import { beginSsoLogin, getSsoConnection, upsertSsoConnection } from "../src/identity/oidc.js";
import { rawPrisma } from "@aegis/db";

let t: TestTenant;
beforeAll(async () => {
  t = await makeTestTenant("sso");
});
afterAll(async () => {
  await t.cleanup();
});

describe("sso connections", () => {
  it("stores the client secret encrypted and never returns it", async () => {
    const row = await withTenant(t.orgId, (db) => upsertSsoConnection(db, t.ownerCtx, { issuer: "https://idp.example.com/", clientId: "aegis-console", clientSecret: "top-secret", emailDomains: ["Example.com"], enabled: false }));
    expect(row.issuer).toBe("https://idp.example.com");
    expect(row.emailDomains).toEqual(["example.com"]);
    expect(JSON.stringify(row)).not.toContain("top-secret");
    const raw = await withTenant(t.orgId, (db) => db.ssoConnection.findUniqueOrThrow({ where: { orgId: t.orgId } }));
    expect(raw.clientSecretEnc.startsWith("v2.")).toBe(true);
    expect(raw.clientSecretEnc).not.toContain("top-secret");
    const read = await withTenant(t.orgId, (db) => getSsoConnection(db, t.ownerCtx));
    expect(read?.hasSecret).toBe(true);
  });
  it("only org admins can change it", async () => {
    const eng = await addUserWithRole(t, "engineer");
    await expect(withTenant(t.orgId, (db) => upsertSsoConnection(db, eng.ctx, { issuer: "https://x.example", clientId: "c", clientSecret: "s", emailDomains: ["x.example"], enabled: true }))).rejects.toThrow(/org:admin/);
  });
  it("refuses to start a login while the connection is disabled or the org is unknown", async () => {
    const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: t.orgId } });
    await expect(beginSsoLogin(org.slug, "http://localhost:3000/sso/callback")).rejects.toThrow(/not enabled/);
    await expect(beginSsoLogin("no-such-org-" + Date.now(), "http://localhost:3000/sso/callback")).rejects.toThrow(/not found/);
  });
});
