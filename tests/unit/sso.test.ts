// Sign-in building blocks that need no database or network: ID token checks, sealed flow cookies, the return
// address allowlist, domain and scope cleaning, provider readiness, the trust rules for addresses, and the
// Google and Microsoft profile mapping.
import { describe, expect, it } from "vitest";
import { createHmac, createSign, generateKeyPairSync, sign as cryptoSign, constants } from "node:crypto";
import { JwtError, validateIdTokenClaims, verifyJwtSignature, type Jwks } from "@/server/sso/jwt";
import { sameString, seal, unseal } from "@/server/sso/seal";
import { safeReturnTo } from "@/server/sso/web";
import { cleanDomainList, defaultPolicy, visibleMethods } from "@/server/sso/policy";
import { cleanScopes, missingEnv } from "@/server/sso/providers";
import { emailTrust } from "@/server/sso/link";
import { oauthIdentity } from "@/server/sso/auth-bridge";
import { sessionRevoked } from "@/server/sso/session-revocation";
import type { NormalizedIdentity } from "@/server/sso/flow";

const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwks: Jwks = {
  keys: [
    { ...(rsa.publicKey.export({ format: "jwk" }) as object), kid: "r1", use: "sig" },
    { ...(ec.publicKey.export({ format: "jwk" }) as object), kid: "e1", use: "sig" },
  ],
};
const now = Math.floor(Date.now() / 1000);
const claims = { iss: "https://idp.test", aud: "client", sub: "s1", iat: now, exp: now + 300, nonce: "n1" };

function token(alg: string, kid: string, body: object = claims) {
  const input = `${b64u(JSON.stringify({ alg, kid }))}.${b64u(JSON.stringify(body))}`;
  let sig: Buffer;
  if (alg === "RS256") sig = createSign("sha256").update(input).sign(rsa.privateKey);
  else if (alg === "PS256") sig = cryptoSign("sha256", Buffer.from(input), { key: rsa.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST });
  else if (alg === "ES256") sig = cryptoSign("sha256", Buffer.from(input), { key: ec.privateKey, dsaEncoding: "ieee-p1363" });
  else if (alg === "HS256") sig = createHmac("sha256", "secret").update(input).digest();
  else sig = Buffer.alloc(0);
  return `${input}.${b64u(sig)}`;
}

describe("ID tokens", () => {
  it("verifies RS256, PS256 and ES256 signatures with the published keys", () => {
    expect(verifyJwtSignature(token("RS256", "r1"), jwks).claims.sub).toBe("s1");
    expect(verifyJwtSignature(token("PS256", "r1"), jwks).claims.sub).toBe("s1");
    expect(verifyJwtSignature(token("ES256", "e1"), jwks).claims.sub).toBe("s1");
  });

  it("refuses none, shared-secret algorithms, unknown keys and changed payloads", () => {
    expect(() => verifyJwtSignature(token("none", "r1"), jwks)).toThrow(JwtError);
    expect(() => verifyJwtSignature(token("HS256", "r1"), jwks)).toThrow(/ALG/);
    expect(() => verifyJwtSignature(token("RS256", "nope"), jwks)).toThrow(/KEY/);
    const [h, , s] = token("RS256", "r1").split(".");
    expect(() => verifyJwtSignature(`${h}.${b64u(JSON.stringify({ ...claims, sub: "admin" }))}.${s}`, jwks)).toThrow(/SIGNATURE/);
    expect(() => verifyJwtSignature("a.b", jwks)).toThrow(/MALFORMED/);
  });

  it("checks issuer, audience, expiry, issue time, nonce and authorized party", () => {
    const ok = { issuer: "https://idp.test", audience: "client", nonce: "n1" };
    expect(() => validateIdTokenClaims(claims, ok)).not.toThrow();
    expect(() => validateIdTokenClaims(claims, { ...ok, issuer: "https://other.test" })).toThrow(/ISSUER/);
    expect(() => validateIdTokenClaims(claims, { ...ok, audience: "other" })).toThrow(/AUDIENCE/);
    expect(() => validateIdTokenClaims({ ...claims, exp: now - 600 }, ok)).toThrow(/EXPIRED/);
    expect(() => validateIdTokenClaims({ ...claims, iat: now + 3600 }, ok)).toThrow(/NOT_YET_VALID/);
    expect(() => validateIdTokenClaims(claims, { ...ok, nonce: "other" })).toThrow(/NONCE/);
    expect(() => validateIdTokenClaims({ ...claims, aud: ["client", "x"] }, ok)).toThrow(/AZP/);
    expect(() => validateIdTokenClaims({ ...claims, aud: ["client", "x"], azp: "client" }, ok)).not.toThrow();
  });
});

describe("sealed flow state", () => {
  it("opens only unchanged, unexpired values sealed for the same purpose", () => {
    const v = seal("sso-flow", { s: "state" }, 60_000);
    expect(unseal("sso-flow", v)).toEqual({ s: "state" });
    expect(unseal("other", v)).toBeNull();
    expect(unseal("sso-flow", v, Date.now() + 120_000)).toBeNull();
    const parts = v.split(".");
    expect(unseal("sso-flow", `${parts[0]}.${parts[1]}.${b64u("tampered")}`)).toBeNull();
    expect(sameString("abc", "abc")).toBe(true);
    expect(sameString("abc", "abd")).toBe(false);
    expect(sameString("abc", null)).toBe(false);
  });
});

describe("where people land after signing in", () => {
  it("allows product pages and join links only", () => {
    expect(safeReturnTo("/en/admin/rostering", "en")).toBe("/en/admin/rostering");
    expect(safeReturnTo("/ar/join/waiting", "ar")).toBe("/ar/join/waiting");
    for (const bad of ["https://evil.test", "//evil.test", "/en//evil.test", "/en/\\evil", "/en/%2F%2Fevil.test", "/fr/home", "javascript:alert(1)", ""]) {
      expect(safeReturnTo(bad, "en"), bad).toBe("/en/home");
    }
  });
});

describe("settings helpers", () => {
  it("cleans email domains and reports the first invalid one", () => {
    expect(cleanDomainList(["@AlDurrah.ae", " students.aldurrah.ae", "aldurrah.ae"])).toEqual({ domains: ["aldurrah.ae", "students.aldurrah.ae"], invalid: null });
    expect(cleanDomainList(["not a domain"]).invalid).toBe("not a domain");
  });

  it("always asks for openid and drops unsafe scope text", () => {
    expect(cleanScopes("email profile")).toBe("openid email profile");
    expect(cleanScopes('openid "quoted" email')).toBe("openid email");
  });

  it("shows only options that are switched on and configured", () => {
    const env = { AUTH_GOOGLE_ID: "x", AUTH_GOOGLE_SECRET: "y", CLASSLINK_CLIENT_ID: "a" } as NodeJS.ProcessEnv;
    const p = { ...defaultPolicy("org", { googleSignIn: true, microsoftSignIn: true }), methods: ["password", "google", "microsoft", "classlink", "oidc"] as never };
    expect(visibleMethods(p, env)).toEqual(["password", "google"]);
    expect(missingEnv("classlink", env)).toEqual(["CLASSLINK_CLIENT_SECRET"]);
    expect(missingEnv("uaepass", env)).toEqual(["UAEPASS_CLIENT_ID", "UAEPASS_CLIENT_SECRET"]);
  });
});

describe("which addresses count as verified", () => {
  const base: NormalizedIdentity = { provider: "classlink", subject: "s", email: "a@school.test", emailVerified: false, name: null, givenName: null, familyName: null, tenant: "1907", externalId: null, role: null, emiratesId: null, assurance: null };
  const policy = { ...defaultPolicy("org", { googleSignIn: true, microsoftSignIn: true }), classlinkTenantId: "1907", microsoftTenantId: "11111111-1111-1111-1111-111111111111" };

  it("trusts ClassLink addresses only from the school's own tenant", () => {
    expect(emailTrust(base, policy)).toEqual({ tenantOk: true, verified: true, directory: true });
    expect(emailTrust({ ...base, tenant: "9999" }, policy).tenantOk).toBe(false);
    expect(emailTrust(base, { ...policy, classlinkTenantId: null }).tenantOk).toBe(false);
  });

  it("does not trust a Microsoft email claim from another organisation", () => {
    const ms = { ...base, provider: "microsoft" as const, tenant: null };
    expect(emailTrust(ms, policy, { msTenant: "22222222-2222-2222-2222-222222222222" }).verified).toBe(false);
    expect(emailTrust(ms, policy, { msTenant: "11111111-1111-1111-1111-111111111111" }).verified).toBe(true);
    expect(emailTrust(ms, policy, { msTenant: "9188040d-6c67-4c5b-b112-36a304b66dad" }).verified).toBe(true);
    expect(emailTrust(ms, policy, { msTenant: "x", msVerifiedDomain: true }).verified).toBe(true);
  });

  it("maps Google and Microsoft profiles", () => {
    expect(oauthIdentity("google", "g1", { email: "A@Gmail.com" }, { email_verified: true })?.identity).toMatchObject({ provider: "google", email: "a@gmail.com", emailVerified: true });
    expect(oauthIdentity("google", "g1", { email: "a@gmail.com" }, { email_verified: false })?.identity.emailVerified).toBe(false);
    const ms = oauthIdentity("microsoft-entra-id", "m1", { email: "a@org.test" }, { tid: "33333333-3333-3333-3333-333333333333", xms_edov: "1" }, { AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/common/v2.0" } as NodeJS.ProcessEnv);
    expect(ms).toMatchObject({ msTenant: "33333333-3333-3333-3333-333333333333", msVerifiedDomain: true });
    const single = oauthIdentity("microsoft-entra-id", "m1", { email: "a@org.test" }, { tid: "44444444-4444-4444-4444-444444444444" }, { AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/44444444-4444-4444-4444-444444444444/v2.0" } as NodeJS.ProcessEnv);
    expect(single?.msVerifiedDomain).toBe(true);
    expect(oauthIdentity("github", "x", {}, {})).toBeNull();
  });
});

describe("sessions after a password reset", () => {
  it("ends sessions that started before the reset", () => {
    const reset = new Date("2026-10-26T10:00:00Z");
    expect(sessionRevoked(reset, reset.getTime() - 1)).toBe(true);
    expect(sessionRevoked(reset, undefined)).toBe(true);
    expect(sessionRevoked(reset, reset.getTime() + 1)).toBe(false);
    expect(sessionRevoked(null, 0)).toBe(false);
  });
});
