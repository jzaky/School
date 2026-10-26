// The authorization code flow for ClassLink, Clever, UAE PASS and school OpenID Connect providers.
//
// beginSso: a random state, nonce and PKCE verifier (S256) are sealed into a short-lived HttpOnly cookie
// (src/server/sso/seal.ts) and the browser is sent to the provider with the state, the nonce and the code
// challenge. The redirect URI is built from the configured site address, never from request headers.
// completeSso: the cookie must open, belong to this provider, be under ten minutes old and carry the same state
// (constant-time comparison); the code is exchanged on the back channel with the PKCE verifier; an ID token must
// verify against the provider's keys and carry our nonce, issuer, audience and a valid expiry; user info must name
// the same subject. Any failure is a FlowError with a code. Nothing here logs tokens or personal data.
// No "server-only" marker: the integration tests drive it against a local mock provider.
import { createHash } from "node:crypto";
import { HttpError, basicAuth, form, httpJson } from "./http";
import { JwtError, validateIdTokenClaims, verifyJwtSignature, type Jwks, type JwtClaims } from "./jwt";
import type { FlowProvider, ProviderConfig } from "./providers";
import { randomToken, sameString, seal, unseal } from "./seal";

export const FLOW_COOKIE = "sso_flow";
export const FLOW_TTL_MS = 10 * 60_000;
const SEAL_PURPOSE = "sso-flow";

export class FlowError extends Error {
  constructor(public code: FlowErrorCode) {
    super(`sso:${code}`);
  }
}
export type FlowErrorCode =
  | "STATE_MISSING"
  | "STATE_MISMATCH"
  | "PROVIDER_MISMATCH"
  | "PROVIDER_DENIED"
  | "CODE_MISSING"
  | "TOKEN_EXCHANGE"
  | "ID_TOKEN_MISSING"
  | "ID_TOKEN_INVALID"
  | "NONCE_MISMATCH"
  | "USERINFO"
  | "SUBJECT_MISMATCH"
  | "NO_SUBJECT";

export type FlowState = {
  /** provider */
  p: FlowProvider;
  /** school the person started from, if any */
  o: string | null;
  /** state */
  s: string;
  /** nonce */
  n: string | null;
  /** PKCE verifier */
  v: string | null;
  /** where to go after sign-in (already checked against the allowlist) */
  r: string;
  /** locale */
  l: "en" | "ar";
  /** redirect URI used */
  u: string;
};

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export type BeginOptions = { orgId: string | null; locale: "en" | "ar"; returnTo: string; redirectUri: string; loginHint?: string | null; extraParams?: Record<string, string>; now?: number };

export function beginSso(cfg: ProviderConfig, opts: BeginOptions): { url: string; cookie: string; state: FlowState } {
  const state: FlowState = {
    p: cfg.id,
    o: opts.orgId,
    s: randomToken(24),
    n: cfg.nonce ? randomToken(24) : null,
    v: cfg.pkce ? randomToken(48) : null,
    r: opts.returnTo,
    l: opts.locale,
    u: opts.redirectUri,
  };
  const url = new URL(cfg.authorizationEndpoint);
  const params: Record<string, string | undefined> = {
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    scope: cfg.scopes || undefined,
    state: state.s,
    nonce: state.n ?? undefined,
    code_challenge: state.v ? pkceChallenge(state.v) : undefined,
    code_challenge_method: state.v ? "S256" : undefined,
    login_hint: opts.loginHint ?? undefined,
    ...cfg.authParams,
    ...(opts.extraParams ?? {}),
  };
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return { url: url.toString(), cookie: seal(SEAL_PURPOSE, state, FLOW_TTL_MS, opts.now), state };
}

/** Reads the flow cookie without completing (used to restart IdP-initiated logins). */
export function readFlow(cookie: string | null | undefined, now?: number): FlowState | null {
  return unseal<FlowState>(SEAL_PURPOSE, cookie, now);
}

export type TokenSet = { access_token?: string; id_token?: string; token_type?: string; expires_in?: number; scope?: string };

export type NormalizedIdentity = {
  provider: FlowProvider | "google" | "microsoft";
  subject: string;
  email: string | null;
  /** The provider says it verified the address. */
  emailVerified: boolean;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  /** ClassLink tenant, Clever district or Microsoft tenant. */
  tenant: string | null;
  /** The person's id in the roster feed (ClassLink sourcedId, Clever user id, a school directory id). */
  externalId: string | null;
  role: string | null;
  /** UAE PASS only: the Emirates ID number. Held in memory for matching, never stored or logged. */
  emiratesId: string | null;
  /** UAE PASS userType (SOP1, SOP2, SOP3). */
  assurance: string | null;
  /** The school's own directory vouches for the address (set by link.ts after the tenant check). */
  trustedDirectory?: boolean;
};

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 320) : typeof v === "number" ? String(v) : null);
const emailOf = (v: unknown) => {
  const e = s(v)?.toLowerCase() ?? null;
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
};
const verifiedFlag = (v: unknown) => v === true || v === "true";

async function exchangeCode(cfg: ProviderConfig, flow: FlowState, code: string): Promise<TokenSet> {
  const body: Record<string, string | undefined> = { grant_type: "authorization_code", code, redirect_uri: flow.u, code_verifier: flow.v ?? undefined };
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (cfg.tokenAuth === "client_secret_basic") headers.Authorization = basicAuth(cfg.clientId, cfg.clientSecret);
  else Object.assign(body, { client_id: cfg.clientId, client_secret: cfg.clientSecret });
  try {
    const { data } = await httpJson<TokenSet>({ method: "POST", url: cfg.tokenEndpoint, headers, body: form(body), timeoutMs: 10_000, maxBytes: 128 * 1024 });
    if (!data.access_token && !data.id_token) throw new FlowError("TOKEN_EXCHANGE");
    return data;
  } catch (e) {
    if (e instanceof FlowError) throw e;
    throw new FlowError("TOKEN_EXCHANGE");
  }
}

const jwksCache = globalThis as unknown as { __ssoJwks?: Map<string, { at: number; jwks: Jwks }> };

async function jwksFor(uri: string, refresh = false): Promise<Jwks> {
  jwksCache.__ssoJwks ??= new Map();
  const hit = jwksCache.__ssoJwks.get(uri);
  if (hit && !refresh && Date.now() - hit.at < 60 * 60_000) return hit.jwks;
  const { data } = await httpJson<Jwks>({ url: uri, timeoutMs: 8000, maxBytes: 256 * 1024 });
  if (!Array.isArray(data.keys)) throw new FlowError("ID_TOKEN_INVALID");
  jwksCache.__ssoJwks.set(uri, { at: Date.now(), jwks: data });
  return data;
}

async function checkIdToken(cfg: ProviderConfig, flow: FlowState, idToken: string, now: Date): Promise<JwtClaims> {
  if (!cfg.jwksUri || !cfg.issuer) throw new FlowError("ID_TOKEN_INVALID");
  let claims: JwtClaims;
  try {
    try {
      claims = verifyJwtSignature(idToken, await jwksFor(cfg.jwksUri)).claims;
    } catch (e) {
      // Keys rotate: fetch them again once when the token names a key we do not have.
      if (!(e instanceof JwtError && e.code === "KEY")) throw e;
      claims = verifyJwtSignature(idToken, await jwksFor(cfg.jwksUri, true)).claims;
    }
    validateIdTokenClaims(claims, { issuer: cfg.issuer, audience: cfg.clientId, nonce: flow.n, now });
  } catch (e) {
    if (e instanceof JwtError && e.code === "NONCE") throw new FlowError("NONCE_MISMATCH");
    if (e instanceof FlowError) throw e;
    throw new FlowError("ID_TOKEN_INVALID");
  }
  return claims;
}

async function bearerJson(url: string, token: string): Promise<Record<string, unknown>> {
  try {
    return (await httpJson<Record<string, unknown>>({ url, headers: { Authorization: `Bearer ${token}` }, timeoutMs: 10_000, maxBytes: 256 * 1024 })).data;
  } catch {
    throw new FlowError("USERINFO");
  }
}

/** Provider-specific profile: who signed in, in the shared shape. */
async function identityFor(cfg: ProviderConfig, tokens: TokenSet, claims: JwtClaims | null): Promise<NormalizedIdentity> {
  const base = { provider: cfg.id, emiratesId: null, assurance: null, role: null, tenant: null, externalId: null } as const;
  if (cfg.id === "clever") {
    if (!tokens.access_token) throw new FlowError("USERINFO");
    const api = cfg.apiBase ?? "https://api.clever.com";
    const me = (await bearerJson(`${api}/v3.0/me`, tokens.access_token)).data as Record<string, unknown> | undefined;
    const id = s(me?.id);
    if (!id) throw new FlowError("NO_SUBJECT");
    if (claims && s(claims.sub) !== id && s(claims.multi_role_user_id) !== id && s(claims.user_id) !== id) throw new FlowError("SUBJECT_MISMATCH");
    const user = ((await bearerJson(`${api}/v3.0/users/${encodeURIComponent(id)}`, tokens.access_token)).data ?? {}) as Record<string, unknown>;
    const name = (user.name ?? {}) as Record<string, unknown>;
    const roles = (user.roles ?? {}) as Record<string, unknown>;
    return {
      ...base,
      subject: id,
      email: emailOf(user.email) ?? emailOf(claims?.email),
      emailVerified: verifiedFlag(claims?.email_verified),
      name: [s(name.first), s(name.last)].filter(Boolean).join(" ") || null,
      givenName: s(name.first),
      familyName: s(name.last),
      tenant: s(me?.district) ?? s(user.district),
      externalId: id,
      role: Object.keys(roles)[0] ?? s(claims?.user_type),
    };
  }
  if (cfg.id === "uaepass") {
    if (!tokens.access_token || !cfg.userinfoEndpoint) throw new FlowError("USERINFO");
    const info = await bearerJson(cfg.userinfoEndpoint, tokens.access_token);
    const subject = s(info.uuid) ?? s(info.sub);
    if (!subject) throw new FlowError("NO_SUBJECT");
    const assurance = s(info.userType);
    const eid = s(info.idn)?.replace(/\D/g, "") ?? null;
    return {
      ...base,
      subject,
      email: emailOf(info.email),
      // UAE PASS confirms the address when the account is created; SOP1 accounts have no verified identity.
      emailVerified: assurance === "SOP2" || assurance === "SOP3",
      name: s(info.fullnameEN) ?? ([s(info.firstnameEN), s(info.lastnameEN)].filter(Boolean).join(" ") || null),
      givenName: s(info.firstnameEN),
      familyName: s(info.lastnameEN),
      emiratesId: eid && eid.length === 15 ? eid : null,
      assurance,
    };
  }
  // ClassLink and school OpenID Connect providers: ID token claims, completed by user info when offered.
  if (!claims) throw new FlowError("ID_TOKEN_MISSING");
  let info: Record<string, unknown> = {};
  if (cfg.userinfoEndpoint && tokens.access_token) {
    info = await bearerJson(cfg.userinfoEndpoint, tokens.access_token);
    const infoSub = s(info.sub);
    if (infoSub && infoSub !== s(claims.sub)) throw new FlowError("SUBJECT_MISMATCH");
  }
  const all: Record<string, unknown> = { ...info, ...claims };
  if (cfg.id === "classlink") {
    // ClassLink user info has used both OpenID claim names and its own (Email, TenantId, SourcedId): read both.
    return {
      ...base,
      subject: String(claims.sub),
      email: emailOf(all.email) ?? emailOf(all.Email),
      emailVerified: verifiedFlag(all.email_verified),
      name: [s(all.given_name) ?? s(all.FirstName), s(all.family_name) ?? s(all.LastName)].filter(Boolean).join(" ") || s(all.DisplayName),
      givenName: s(all.given_name) ?? s(all.FirstName),
      familyName: s(all.family_name) ?? s(all.LastName),
      tenant: s(all.classLink_tenant_id) ?? s(all.TenantId),
      externalId: s(all.classLink_sourcedId) ?? s(all.SourcedId),
      role: s(all.classLink_role) ?? s(all.Role),
    };
  }
  const map = cfg.claims ?? { email: "email", id: "sub", name: "name" };
  return {
    ...base,
    subject: String(claims.sub),
    email: emailOf(all[map.email]),
    emailVerified: verifiedFlag(all.email_verified),
    name: s(all[map.name]) ?? ([s(all.given_name), s(all.family_name)].filter(Boolean).join(" ") || null),
    givenName: s(all.given_name),
    familyName: s(all.family_name),
    externalId: s(all[map.id]),
  };
}

export type CompleteOptions = { query: URLSearchParams; cookie: string | null | undefined; now?: Date };

export async function completeSso(cfg: ProviderConfig, opts: CompleteOptions): Promise<{ identity: NormalizedIdentity; flow: FlowState }> {
  const now = opts.now ?? new Date();
  const flow = unseal<FlowState>(SEAL_PURPOSE, opts.cookie, now.getTime());
  if (!flow) throw new FlowError("STATE_MISSING");
  if (opts.query.get("error")) throw new FlowError("PROVIDER_DENIED");
  if (!sameString(opts.query.get("state"), flow.s)) throw new FlowError("STATE_MISMATCH");
  if (flow.p !== cfg.id) throw new FlowError("PROVIDER_MISMATCH");
  const code = opts.query.get("code");
  if (!code || code.length > 4096) throw new FlowError("CODE_MISSING");
  const tokens = await exchangeCode(cfg, flow, code);
  let claims: JwtClaims | null = null;
  if (cfg.idToken !== "ignore") {
    if (tokens.id_token) claims = await checkIdToken(cfg, flow, tokens.id_token, now);
    else if (cfg.idToken === "required") throw new FlowError("ID_TOKEN_MISSING");
  }
  const identity = await identityFor(cfg, tokens, claims);
  if (!identity.subject) throw new FlowError("NO_SUBJECT");
  return { identity, flow };
}

export { HttpError };
