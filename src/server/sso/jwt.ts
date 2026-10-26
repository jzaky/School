// ID token checks for OpenID Connect sign-in: signature against the provider's published keys (RS, PS and ES
// families only; "none" and shared-secret algorithms are refused), then issuer, audience, expiry, issue time
// and nonce. Built on node:crypto so there is no extra dependency. Errors carry a code, never token content.
// No "server-only" marker: unit tests import it directly.
import { createPublicKey, verify as cryptoVerify, constants, type JsonWebKey, type KeyObject } from "node:crypto";

export class JwtError extends Error {
  constructor(public code: "MALFORMED" | "ALG" | "KEY" | "SIGNATURE" | "ISSUER" | "AUDIENCE" | "EXPIRED" | "NOT_YET_VALID" | "NONCE" | "AZP") {
    super(`jwt:${code}`);
  }
}

export type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string; kty?: string };
export type Jwks = { keys: Jwk[] };
export type JwtHeader = { alg?: string; kid?: string; typ?: string };
export type JwtClaims = Record<string, unknown> & { iss?: string; sub?: string; aud?: string | string[]; exp?: number; iat?: number; nbf?: number; nonce?: string; azp?: string };

type AlgSpec = { hash: "sha256" | "sha384" | "sha512"; kty: "RSA" | "EC"; pss?: boolean };
const ALGS: Record<string, AlgSpec> = {
  RS256: { hash: "sha256", kty: "RSA" },
  RS384: { hash: "sha384", kty: "RSA" },
  RS512: { hash: "sha512", kty: "RSA" },
  PS256: { hash: "sha256", kty: "RSA", pss: true },
  PS384: { hash: "sha384", kty: "RSA", pss: true },
  PS512: { hash: "sha512", kty: "RSA", pss: true },
  ES256: { hash: "sha256", kty: "EC" },
  ES384: { hash: "sha384", kty: "EC" },
  ES512: { hash: "sha512", kty: "EC" },
};
export const SUPPORTED_ALGS = Object.keys(ALGS);

function b64json<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    throw new JwtError("MALFORMED");
  }
}

export function decodeJwt(token: string): { header: JwtHeader; claims: JwtClaims; signingInput: string; signature: Buffer } {
  if (typeof token !== "string" || token.length > 16_384) throw new JwtError("MALFORMED");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new JwtError("MALFORMED");
  const header = b64json<JwtHeader>(parts[0]);
  const claims = b64json<JwtClaims>(parts[1]);
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object") throw new JwtError("MALFORMED");
  return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") };
}

function pickKey(jwks: Jwks, header: JwtHeader, spec: AlgSpec): KeyObject {
  const usable = (jwks.keys ?? []).filter((k) => k && k.kty === spec.kty && (!k.use || k.use === "sig") && (!k.alg || k.alg === header.alg));
  const candidates = header.kid ? usable.filter((k) => k.kid === header.kid) : usable;
  if (candidates.length !== 1) throw new JwtError("KEY");
  try {
    return createPublicKey({ key: candidates[0] as JsonWebKey, format: "jwk" });
  } catch {
    throw new JwtError("KEY");
  }
}

/** Verifies the signature with one of the published keys. Returns the claims (not yet validated). */
export function verifyJwtSignature(token: string, jwks: Jwks, allowed: string[] = SUPPORTED_ALGS): { header: JwtHeader; claims: JwtClaims } {
  const { header, claims, signingInput, signature } = decodeJwt(token);
  const alg = header.alg ?? "";
  const spec = ALGS[alg];
  if (!spec || !allowed.includes(alg)) throw new JwtError("ALG");
  const key = pickKey(jwks, header, spec);
  const ok = cryptoVerify(
    spec.hash,
    Buffer.from(signingInput),
    spec.kty === "EC" ? { key, dsaEncoding: "ieee-p1363" } : spec.pss ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST } : key,
    signature,
  );
  if (!ok) throw new JwtError("SIGNATURE");
  return { header, claims };
}

export type ClaimChecks = { issuer: string; audience: string; nonce?: string | null; now?: Date; skewSec?: number };

/** OpenID Connect Core 3.1.3.7 checks on an ID token's claims. */
export function validateIdTokenClaims(claims: JwtClaims, checks: ClaimChecks) {
  const now = Math.floor((checks.now ?? new Date()).getTime() / 1000);
  const skew = checks.skewSec ?? 120;
  if (claims.iss !== checks.issuer) throw new JwtError("ISSUER");
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!aud.includes(checks.audience)) throw new JwtError("AUDIENCE");
  if (aud.length > 1 && claims.azp !== checks.audience) throw new JwtError("AZP");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new JwtError("EXPIRED");
  if (typeof claims.iat === "number" && claims.iat - skew > now) throw new JwtError("NOT_YET_VALID");
  if (typeof claims.nbf === "number" && claims.nbf - skew > now) throw new JwtError("NOT_YET_VALID");
  if (checks.nonce !== undefined && checks.nonce !== null) {
    if (typeof claims.nonce !== "string" || claims.nonce !== checks.nonce) throw new JwtError("NONCE");
  }
  if (typeof claims.sub !== "string" || !claims.sub) throw new JwtError("MALFORMED");
}
