// Single sign-on providers handled by the Horizon flow (src/server/sso/flow.ts): ClassLink, Clever, UAE PASS and
// each school's own OpenID Connect provider. Google and Microsoft stay on Auth.js (src/auth.ts) and share the
// linking rules in src/server/sso/link.ts.
//
// Client ids and secrets come from environment variables, never from the database. The one exception is a
// school's own identity provider, whose client secret is stored encrypted (FIELD_ENCRYPTION_KEY).
//
// Facts used here, from the providers' public documentation (checked October 2026):
// - ClassLink publishes OpenID Connect discovery at https://launchpad.classlink.com/.well-known/openid-configuration
//   (authorize /oauth2/v2/auth, token /oauth2/v2/token, keys /oauth2/v2/jwks, RS256, claims classLink_tenant_id,
//   classLink_sourcedId, classLink_role). It does not advertise PKCE, so PKCE is off for ClassLink.
// - Clever: authorize https://clever.com/oauth/authorize, token https://clever.com/oauth/tokens (HTTP Basic),
//   https://api.clever.com/v3.0/me and /v3.0/users/{id}. An id_token is returned only when Clever has switched on
//   OpenID Connect for the app (issuer https://clever.com, keys https://clever.com/oauth/certs). email_verified is
//   false by default, so a Clever address counts only when the district is the school's own (see link.ts).
// - UAE PASS: https://stg-id.uaepass.ae/idshub/{authorize,token,userinfo} (staging) and https://id.uaepass.ae/idshub/...
//   (production), scope urn:uae:digitalid:profile:general, acr_values
//   urn:safelayer:tws:policies:authentication:level:low, token call with HTTP Basic. User info returns uuid,
//   userType (SOP1, SOP2, SOP3), email, mobile, firstnameEN, lastnameEN, fullnameEN and, for SOP2 and SOP3, idn
//   (Emirates ID). The documentation describes no ID token, nonce or PKCE, so the flow relies on state and the
//   back-channel user info call.
import { decryptField } from "@/lib/crypto";
import { HttpError, httpJson } from "./http";

export const SIGN_IN_METHODS = ["password", "magic_link", "google", "microsoft", "classlink", "clever", "uaepass", "oidc"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export const isSignInMethod = (v: unknown): v is SignInMethod => typeof v === "string" && (SIGN_IN_METHODS as readonly string[]).includes(v);

export const FLOW_PROVIDERS = ["classlink", "clever", "uaepass", "oidc"] as const;
export type FlowProvider = (typeof FLOW_PROVIDERS)[number];
export const isFlowProvider = (v: unknown): v is FlowProvider => typeof v === "string" && (FLOW_PROVIDERS as readonly string[]).includes(v);

/** Single sign-on methods (everything except password and magic link). */
export const SSO_METHODS: SignInMethod[] = ["google", "microsoft", "classlink", "clever", "uaepass", "oidc"];

export type ProviderConfig = {
  id: FlowProvider;
  /** Expected iss of ID tokens (null: the provider issues none). */
  issuer: string | null;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string | null;
  jwksUri: string | null;
  clientId: string;
  clientSecret: string;
  tokenAuth: "client_secret_basic" | "client_secret_post";
  scopes: string;
  pkce: boolean;
  nonce: boolean;
  /** required: sign-in fails without a valid ID token; optional: checked when present; ignore: not requested. */
  idToken: "required" | "optional" | "ignore";
  authParams: Record<string, string>;
  /** Clever only: the data API base. */
  apiBase?: string;
  /** School OpenID Connect provider: which claims hold the address, the external id and the name. */
  claims?: { email: string; id: string; name: string };
  trustEmail?: boolean;
};

type Env = NodeJS.ProcessEnv;

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Environment variables a provider needs that are missing on this server (names only). */
export function missingEnv(method: SignInMethod, env: Env = process.env): string[] {
  const need: Record<SignInMethod, string[]> = {
    password: [],
    magic_link: ["RESEND_API_KEY"],
    google: ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
    microsoft: ["AUTH_MICROSOFT_ENTRA_ID_ID", "AUTH_MICROSOFT_ENTRA_ID_SECRET"],
    classlink: ["CLASSLINK_CLIENT_ID", "CLASSLINK_CLIENT_SECRET"],
    clever: ["CLEVER_CLIENT_ID", "CLEVER_CLIENT_SECRET"],
    uaepass: ["UAEPASS_CLIENT_ID", "UAEPASS_CLIENT_SECRET"],
    oidc: ["FIELD_ENCRYPTION_KEY"],
  };
  return need[method].filter((n) => !env[n]);
}

export const methodConfigured = (method: SignInMethod, env: Env = process.env) => missingEnv(method, env).length === 0;

export function uaePassEnvironment(env: Env = process.env): "staging" | "production" {
  return env.UAEPASS_ENV === "production" ? "production" : "staging";
}

export function uaePassBase(env: Env = process.env): string {
  if (env.UAEPASS_BASE) return trimSlash(env.UAEPASS_BASE);
  return uaePassEnvironment(env) === "production" ? "https://id.uaepass.ae/idshub" : "https://stg-id.uaepass.ae/idshub";
}

export const classLinkIssuer = (env: Env = process.env) => trimSlash(env.CLASSLINK_ISSUER || "https://launchpad.classlink.com");
export const cleverOAuthBase = (env: Env = process.env) => trimSlash(env.CLEVER_OAUTH_BASE || "https://clever.com");
export const cleverApiBase = (env: Env = process.env) => trimSlash(env.CLEVER_API_BASE || "https://api.clever.com");

// ---------------------------------------------------------------------------
// OpenID Connect discovery (cached per issuer for an hour)
// ---------------------------------------------------------------------------

export type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; userinfo_endpoint?: string; jwks_uri?: string; code_challenge_methods_supported?: string[] | null; token_endpoint_auth_methods_supported?: string[] | null };

export class ProviderError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "DISCOVERY" | "ISSUER_MISMATCH" | "SECRET") {
    super(`provider:${code}`);
  }
}

const g = globalThis as unknown as { __oidcDiscovery?: Map<string, { at: number; doc: Discovery }> };
const DISCOVERY_TTL = 60 * 60_000;

export async function discover(issuer: string, now = Date.now()): Promise<Discovery> {
  const iss = trimSlash(issuer);
  g.__oidcDiscovery ??= new Map();
  const hit = g.__oidcDiscovery.get(iss);
  if (hit && now - hit.at < DISCOVERY_TTL) return hit.doc;
  let doc: Discovery;
  try {
    doc = (await httpJson<Discovery>({ url: `${iss}/.well-known/openid-configuration`, timeoutMs: 8000, maxBytes: 256 * 1024 })).data;
  } catch (e) {
    if (e instanceof HttpError && (e.code === "URL" || e.code === "BLOCKED_ADDRESS")) throw new ProviderError("DISCOVERY");
    throw new ProviderError("DISCOVERY");
  }
  if (typeof doc.authorization_endpoint !== "string" || typeof doc.token_endpoint !== "string") throw new ProviderError("DISCOVERY");
  // OpenID Connect Discovery 4.3: the document must name the issuer it was fetched from.
  if (trimSlash(String(doc.issuer ?? "")) !== iss) throw new ProviderError("ISSUER_MISMATCH");
  g.__oidcDiscovery.set(iss, { at: now, doc });
  return doc;
}

export function clearDiscoveryCache() {
  g.__oidcDiscovery?.clear();
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export type SchoolOidc = {
  oidcIssuer: string | null;
  oidcClientId: string | null;
  oidcSecretEnc: string | null;
  oidcScopes: string;
  oidcEmailClaim: string;
  oidcIdClaim: string;
  oidcNameClaim: string;
  oidcTrustEmail: boolean;
};

export async function providerConfig(id: FlowProvider, school: SchoolOidc | null, env: Env = process.env): Promise<ProviderConfig> {
  if (id === "classlink") {
    if (!methodConfigured("classlink", env)) throw new ProviderError("NOT_CONFIGURED");
    const issuer = classLinkIssuer(env);
    const d = await discover(issuer);
    return {
      id,
      issuer: trimSlash(d.issuer),
      authorizationEndpoint: d.authorization_endpoint,
      tokenEndpoint: d.token_endpoint,
      userinfoEndpoint: d.userinfo_endpoint ?? null,
      jwksUri: d.jwks_uri ?? null,
      clientId: env.CLASSLINK_CLIENT_ID!,
      clientSecret: env.CLASSLINK_CLIENT_SECRET!,
      tokenAuth: "client_secret_basic",
      scopes: "openid profile email",
      // ClassLink's discovery document lists no PKCE methods. Turn on here if it starts advertising S256.
      pkce: (d.code_challenge_methods_supported ?? []).includes("S256"),
      nonce: true,
      idToken: "required",
      authParams: {},
    };
  }
  if (id === "clever") {
    if (!methodConfigured("clever", env)) throw new ProviderError("NOT_CONFIGURED");
    const base = cleverOAuthBase(env);
    return {
      id,
      issuer: base,
      authorizationEndpoint: `${base}/oauth/authorize`,
      tokenEndpoint: `${base}/oauth/tokens`,
      userinfoEndpoint: null,
      jwksUri: `${base}/oauth/certs`,
      clientId: env.CLEVER_CLIENT_ID!,
      clientSecret: env.CLEVER_CLIENT_SECRET!,
      tokenAuth: "client_secret_basic",
      scopes: "",
      pkce: false,
      nonce: true,
      idToken: "optional",
      authParams: {},
      apiBase: cleverApiBase(env),
    };
  }
  if (id === "uaepass") {
    if (!methodConfigured("uaepass", env)) throw new ProviderError("NOT_CONFIGURED");
    const base = uaePassBase(env);
    return {
      id,
      issuer: null,
      authorizationEndpoint: `${base}/authorize`,
      tokenEndpoint: `${base}/token`,
      userinfoEndpoint: `${base}/userinfo`,
      jwksUri: null,
      clientId: env.UAEPASS_CLIENT_ID!,
      clientSecret: env.UAEPASS_CLIENT_SECRET!,
      tokenAuth: "client_secret_basic",
      scopes: env.UAEPASS_SCOPE || "urn:uae:digitalid:profile:general",
      pkce: false,
      nonce: false,
      idToken: "ignore",
      authParams: { acr_values: env.UAEPASS_ACR_VALUES || "urn:safelayer:tws:policies:authentication:level:low" },
    };
  }
  // The school's own OpenID Connect provider (Okta, Microsoft AD FS, Keycloak, and so on).
  if (!school?.oidcIssuer || !school.oidcClientId || !school.oidcSecretEnc) throw new ProviderError("NOT_CONFIGURED");
  if (!methodConfigured("oidc", env)) throw new ProviderError("NOT_CONFIGURED");
  let secret: string;
  try {
    secret = decryptField(school.oidcSecretEnc);
  } catch {
    throw new ProviderError("SECRET");
  }
  const d = await discover(school.oidcIssuer);
  const auth = d.token_endpoint_auth_methods_supported ?? [];
  return {
    id: "oidc",
    issuer: trimSlash(d.issuer),
    authorizationEndpoint: d.authorization_endpoint,
    tokenEndpoint: d.token_endpoint,
    userinfoEndpoint: d.userinfo_endpoint ?? null,
    jwksUri: d.jwks_uri ?? null,
    clientId: school.oidcClientId,
    clientSecret: secret,
    tokenAuth: auth.length && !auth.includes("client_secret_basic") && auth.includes("client_secret_post") ? "client_secret_post" : "client_secret_basic",
    scopes: cleanScopes(school.oidcScopes),
    // PKCE (S256) is sent unless the provider says it does not support it.
    pkce: d.code_challenge_methods_supported === undefined || d.code_challenge_methods_supported === null || d.code_challenge_methods_supported.includes("S256"),
    nonce: true,
    idToken: "required",
    authParams: {},
    claims: { email: school.oidcEmailClaim || "email", id: school.oidcIdClaim || "sub", name: school.oidcNameClaim || "name" },
    trustEmail: school.oidcTrustEmail,
  };
}

export function cleanScopes(raw: string | null | undefined): string {
  const scopes = String(raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^[\x21\x23-\x5B\x5D-\x7E]{1,80}$/.test(s));
  if (!scopes.includes("openid")) scopes.unshift("openid");
  return [...new Set(scopes)].slice(0, 12).join(" ");
}
