import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { disconnectAll, ownerPrisma, withTenant } from "@aegis/db";
import { makeTestTenant, type TestTenant } from "./helpers.js";
import { decryptSecret, encryptSecret, envelopeKeyId } from "../src/lib/crypto.js";
import { currentDataKey, initKeyring, resetKeyringForTests, type KeyProvider } from "../src/lib/keyring.js";
import { reencryptStoredSecrets } from "../src/lib/secret-rotation.js";
import { azureKeyVaultProvider } from "../src/lib/key-providers/azure-keyvault.js";
import { awsKmsProvider } from "../src/lib/key-providers/aws-kms.js";
import { beginMfaEnrolment, confirmMfaEnrolment } from "../src/identity/auth.js";
import { totpCode } from "../src/identity/totp.js";
import { createIntegration, readCredentialForExecution, storeCredential, webhookSecretFor } from "../src/integrations/service.js";
import { upsertSsoConnection } from "../src/identity/oidc.js";
import { sealDestinationSecret } from "../src/integrations/destinations.js";
import { KMSClient } from "@aws-sdk/client-kms";

const saved = { ...process.env };
function setKeys(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetKeyringForTests();
}
afterEach(() => {
  for (const k of ["AEGIS_MASTER_KEY", "AEGIS_MASTER_KEY_ID", "AEGIS_PREVIOUS_MASTER_KEYS", "AEGIS_KEY_PROVIDER", "AEGIS_AZURE_KEY_URL", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_AUTHORITY_HOST", "AEGIS_KMS_KEY_ID"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetKeyringForTests();
});

/** The pre-key-id format, written exactly as the previous version of encryptSecret did. */
function legacyEnvelope(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

describe("data keys (env provider)", () => {
  it("writes v2 envelopes naming the key, and still opens v1 envelopes", () => {
    const key = randomBytes(32);
    setKeys({ AEGIS_MASTER_KEY: key.toString("base64"), AEGIS_MASTER_KEY_ID: "k7" });
    const env = encryptSecret("s3cret", "row:1");
    expect(env.startsWith("v2.k7.")).toBe(true);
    expect(envelopeKeyId(env)).toBe("k7");
    expect(decryptSecret(env, "row:1")).toBe("s3cret");
    expect(() => decryptSecret(env, "row:2")).toThrow();
    expect(decryptSecret(legacyEnvelope(key, "old", "row:9"), "row:9")).toBe("old");
  });

  it("rotates: new writes use the new key, old envelopes open with the previous key, unknown ids are refused", () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    setKeys({ AEGIS_MASTER_KEY: oldKey.toString("base64"), AEGIS_MASTER_KEY_ID: "k1", AEGIS_PREVIOUS_MASTER_KEYS: undefined });
    const before = encryptSecret("a", "x");
    const legacy = legacyEnvelope(oldKey, "b", "y");
    setKeys({ AEGIS_MASTER_KEY: newKey.toString("base64"), AEGIS_MASTER_KEY_ID: "k2", AEGIS_PREVIOUS_MASTER_KEYS: `k1:${oldKey.toString("base64")}` });
    expect(decryptSecret(before, "x")).toBe("a");
    expect(decryptSecret(legacy, "y")).toBe("b");
    expect(envelopeKeyId(encryptSecret("c", "z"))).toBe("k2");
    // Without the previous key the old envelope cannot be read, and the error says which key is missing.
    setKeys({ AEGIS_PREVIOUS_MASTER_KEYS: undefined });
    expect(() => decryptSecret(before, "x")).toThrow(/k1/);
  });

  it("refuses a malformed configuration", () => {
    setKeys({ AEGIS_MASTER_KEY: randomBytes(16).toString("base64") + "AAAAAAAAAAAAAAAAAAAAAA==", AEGIS_MASTER_KEY_ID: "k1" });
    expect(() => encryptSecret("x")).toThrow(/32-byte/);
    setKeys({ AEGIS_MASTER_KEY: randomBytes(32).toString("base64"), AEGIS_MASTER_KEY_ID: "bad id!" });
    expect(() => encryptSecret("x")).toThrow(/AEGIS_MASTER_KEY_ID/);
  });
});

describe("data keys (vault providers)", () => {
  it("requires initKeyring with a vault, then works from memory", async () => {
    const dataKey = randomBytes(32);
    const calls: string[] = [];
    const fake: KeyProvider = {
      name: "aws-kms",
      async unwrap(w) {
        calls.push("unwrap");
        expect(w.toString()).toBe("wrapped:k1");
        return dataKey;
      },
      async wrap() {
        throw new Error("unused");
      },
    };
    setKeys({ AEGIS_KEY_PROVIDER: "aws-kms", AEGIS_MASTER_KEY: Buffer.from("wrapped:k1").toString("base64").padEnd(40, "="), AEGIS_MASTER_KEY_ID: "k1" });
    process.env.AEGIS_MASTER_KEY = Buffer.from("wrapped:k1").toString("base64") + "=".repeat(24);
    resetKeyringForTests(fake);
    expect(() => encryptSecret("x")).toThrow(/initKeyring/);
    // The base64 padding above is ignored by the decoder, so the vault sees exactly the wrapped bytes.
    await initKeyring();
    expect(calls).toEqual(["unwrap"]);
    expect(currentDataKey().key.equals(dataKey)).toBe(true);
    expect(decryptSecret(encryptSecret("y", "z"), "z")).toBe("y");
  });

  it("Azure Key Vault: signs in, wraps and unwraps over the documented REST calls", async () => {
    // A stand-in for login.microsoftonline.com and a vault: it checks the requests AEGIS sends.
    const seen: { path: string; auth?: string; body: string }[] = [];
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", auth: req.headers.authorization, body });
        res.setHeader("content-type", "application/json");
        if (req.url?.startsWith("/tenant-1/oauth2/v2.0/token")) return res.end(JSON.stringify({ access_token: "tok-123" }));
        const parsed = JSON.parse(body) as { alg: string; value: string };
        // "Wrap" by reversing the bytes: enough to prove the value round-trips through the vault.
        const v = Buffer.from(parsed.value, "base64url").reverse().toString("base64url");
        return res.end(JSON.stringify({ kid: "x", value: v }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      setKeys({ AZURE_AUTHORITY_HOST: `http://127.0.0.1:${port}`, AZURE_TENANT_ID: "tenant-1", AZURE_CLIENT_ID: "client-1", AZURE_CLIENT_SECRET: "secret-1", AEGIS_AZURE_KEY_URL: `http://127.0.0.1:${port}/keys/aegis-data/abc123` });
      const p = azureKeyVaultProvider();
      const dataKey = randomBytes(32);
      const wrapped = await p.wrap(dataKey);
      expect(wrapped.equals(dataKey)).toBe(false);
      expect((await p.unwrap(wrapped)).equals(dataKey)).toBe(true);
      const token = seen.find((s) => s.path.includes("/oauth2/"))!;
      expect(new URLSearchParams(token.body).get("scope")).toBe("https://vault.azure.net/.default");
      expect(new URLSearchParams(token.body).get("grant_type")).toBe("client_credentials");
      const wrap = seen.find((s) => s.path.startsWith("/keys/aegis-data/abc123/wrapkey?api-version=7.4"))!;
      expect(wrap.auth).toBe("Bearer tok-123");
      expect(JSON.parse(wrap.body).alg).toBe("RSA-OAEP-256");
      expect(seen.some((s) => s.path.startsWith("/keys/aegis-data/abc123/unwrapkey?api-version=7.4"))).toBe(true);
      // A plain-http vault URL is refused unless it is this machine (the stand-in).
      setKeys({ AEGIS_AZURE_KEY_URL: "http://vault.example.com/keys/a/b" });
      await expect(azureKeyVaultProvider().wrap(dataKey)).rejects.toThrow(/https/);
    } finally {
      server.close();
    }
  });

  it("AWS KMS: sends Decrypt and Encrypt with AEGIS's encryption context", async () => {
    // A stand-in for the KMS JSON API (X-Amz-Target TrentService.*), reached through the SDK's endpoint option.
    const seen: { target: string; body: Record<string, unknown>; signed: boolean }[] = [];
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const target = String(req.headers["x-amz-target"]);
        const parsed = JSON.parse(body) as Record<string, string>;
        seen.push({ target, body: parsed, signed: /^AWS4-HMAC-SHA256 /.test(String(req.headers.authorization)) });
        res.setHeader("content-type", "application/x-amz-json-1.1");
        if (target === "TrentService.Encrypt") return res.end(JSON.stringify({ CiphertextBlob: Buffer.from("W" + parsed.Plaintext).toString("base64"), KeyId: "arn:test" }));
        const blob = Buffer.from(parsed.CiphertextBlob!, "base64").toString();
        return res.end(JSON.stringify({ Plaintext: blob.slice(1), KeyId: "arn:test" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      setKeys({ AEGIS_KMS_KEY_ID: "arn:aws:kms:me-central-1:111122223333:key/test" });
      const client = new KMSClient({ endpoint: `http://127.0.0.1:${port}`, region: "me-central-1", credentials: { accessKeyId: "AKIDTEST", secretAccessKey: "test-secret" } });
      const p = awsKmsProvider(client);
      const dataKey = randomBytes(32);
      const wrapped = await p.wrap(dataKey);
      expect((await p.unwrap(wrapped)).equals(dataKey)).toBe(true);
      expect(seen.map((s) => s.target)).toEqual(["TrentService.Encrypt", "TrentService.Decrypt"]);
      expect(seen.every((s) => s.signed)).toBe(true);
      expect(seen.every((s) => (s.body.EncryptionContext as Record<string, string>).purpose === "aegis-data-key")).toBe(true);
      expect(seen[0]!.body.KeyId).toBe("arn:aws:kms:me-central-1:111122223333:key/test");
    } finally {
      server.close();
    }
  });
});

describe("re-encrypting stored secrets after a rotation", () => {
  let t: TestTenant;
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  beforeAll(async () => {
    setKeys({ AEGIS_MASTER_KEY: oldKey.toString("base64"), AEGIS_MASTER_KEY_ID: "old1", AEGIS_PREVIOUS_MASTER_KEYS: undefined });
    t = await makeTestTenant("keyring");
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await disconnectAll();
  });

  it("moves every secret column to the new key and every reader still works", async () => {
    // Write one secret of each kind through the code that normally writes it.
    const mfa = await beginMfaEnrolment(t.ownerUserId);
    const key = `rot-${Date.now().toString(36)}`;
    const { integration, webhookSecret } = await withTenant(t.orgId, (db) => createIntegration(db, t.ownerCtx, { key, name: "Rotation test", type: "crm", description: "" }));
    await withTenant(t.orgId, (db) => storeCredential(db, t.ownerCtx, integration.id, "api_key", "cred-value-1"));
    await withTenant(t.orgId, (db) => upsertSsoConnection(db, t.ownerCtx, { protocol: "oidc", issuer: "https://idp.rotation.example", clientId: "c1", clientSecret: "sso-secret-1", emailDomains: ["rotation.example"], enabled: false }));
    await withTenant(t.orgId, (db) => db.eventDestination.create({ data: { orgId: t.orgId, enabled: false, cursorSeq: 0n, createdBy: t.ownerUserId, kind: "splunk_hec", name: "Rotation", categories: ["security"], config: { url: "https://splunk.rotation.example:8088" }, secretEnvelope: sealDestinationSecret(t.orgId, "splunk_hec", "hec-token-1") } }));

    // Rotate: a new current key, the old one kept as previous; then re-encrypt.
    setKeys({ AEGIS_MASTER_KEY: newKey.toString("base64"), AEGIS_MASTER_KEY_ID: "new1", AEGIS_PREVIOUS_MASTER_KEYS: `old1:${oldKey.toString("base64")}` });
    const dry = await reencryptStoredSecrets(ownerPrisma(), { dryRun: true });
    expect(dry.tables.reduce((n, x) => n + x.rewritten, 0)).toBeGreaterThanOrEqual(5);
    const report = await reencryptStoredSecrets(ownerPrisma());
    expect(report.keyId).toBe("new1");
    for (const table of ["users", "sso_connections", "integrations", "credentials", "event_destinations"]) {
      expect(report.tables.find((x) => x.table === table)!.rewritten).toBeGreaterThan(0);
    }
    // Rows of other tenants in this shared test database were written under the development key, which
    // is not configured here: they are reported as failed and left untouched, never half-written.
    const myCred = await withTenant(t.orgId, (db) => db.credential.findFirstOrThrow({ where: { integrationId: integration.id } }));
    expect(report.tables.find((x) => x.table === "credentials")!.failedIds).not.toContain(myCred.id);

    // Drop the old key entirely: everything must still read, through the normal readers.
    setKeys({ AEGIS_PREVIOUS_MASTER_KEYS: undefined });
    await confirmMfaEnrolment(t.ownerUserId, totpCode(mfa.secret));
    expect(await withTenant(t.orgId, (db) => webhookSecretFor(db, t.ownerCtx, integration.id))).toBe(webhookSecret);
    expect(await withTenant(t.orgId, (db) => readCredentialForExecution(db, integration.id, "api_key"))).toBe("cred-value-1");
    const sso = await withTenant(t.orgId, (db) => db.ssoConnection.findUniqueOrThrow({ where: { orgId: t.orgId } }));
    expect(envelopeKeyId(sso.clientSecretEnc)).toBe("new1");
    expect(decryptSecret(sso.clientSecretEnc, `sso:${t.orgId}`)).toBe("sso-secret-1");
    const dest = await withTenant(t.orgId, (db) => db.eventDestination.findFirstOrThrow({ where: { name: "Rotation" } }));
    expect(decryptSecret(dest.secretEnvelope, `event-destination:${t.orgId}:splunk_hec`)).toBe("hec-token-1");

    // A second run has nothing left to do.
    setKeys({ AEGIS_PREVIOUS_MASTER_KEYS: `old1:${oldKey.toString("base64")}` });
    const again = await reencryptStoredSecrets(ownerPrisma());
    const mine = await ownerPrisma().$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM credentials WHERE org_id = $1::uuid AND secret_enc NOT LIKE 'v2.new1.%'`, t.orgId);
    expect(Number(mine[0]!.n)).toBe(0);
    expect(again.keyId).toBe("new1");
  }, 60_000);
});
