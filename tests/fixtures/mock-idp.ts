// A local mock of the identity providers Horizon talks to, for tests and local end-to-end runs only:
// - /oidc and /classlink: OpenID Connect providers (discovery, authorize, token with PKCE check, keys, user info)
// - /clever: Clever OAuth (authorize, tokens, certs) and /clever-api: /v3.0/me and /v3.0/users/{id}
// - /uaepass/idshub: UAE PASS (authorize, token, userinfo; no ID token)
// The authorize endpoint approves at once as the configured user and redirects back with code and state.
// Knobs on the returned object let tests tamper with the nonce, issuer, audience, signature or subject.
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";

export type MockUser = Record<string, unknown>;
type Tamper = { nonce?: string; iss?: string; aud?: string; alg?: string; expired?: boolean; badSignature?: boolean; userinfoSub?: string; noIdToken?: boolean; dropNonce?: boolean };
type Grant = { prefix: string; clientId: string; redirectUri: string; nonce: string | null; challenge: string | null; user: MockUser };

export type MockIdp = {
  base: string;
  users: Record<string, MockUser>;
  tamper: Tamper;
  clients: Record<string, { id: string; secret: string }>;
  /** Number of token requests per prefix. */
  tokenCalls: Record<string, number>;
  /** Last authorize query per prefix. */
  lastAuthorize: Record<string, Record<string, string>>;
  close: () => Promise<void>;
  /** Clever data and OneRoster pages for roster tests (see tests/fixtures/oneroster.ts). */
  routes: Map<string, (req: http.IncomingMessage, url: URL, body: string) => { status: number; body: unknown; headers?: Record<string, string> } | null>;
};

const b64u = (v: Buffer | string) => Buffer.from(v).toString("base64url");

function signJwt(claims: Record<string, unknown>, key: KeyObject, kid: string, tamper: Tamper) {
  const header = { alg: tamper.alg ?? "RS256", kid, typ: "JWT" };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  if (header.alg === "none") return `${input}.`;
  let sig = sign("sha256", Buffer.from(input), key);
  if (tamper.badSignature) sig = Buffer.from(sig.map((b, i) => (i === 5 ? b ^ 0xff : b)));
  return `${input}.${b64u(sig)}`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

export async function startMockIdp(port = 0): Promise<MockIdp> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomBytes(6).toString("hex");
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid, use: "sig", alg: "RS256" };
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, { prefix: string; user: MockUser }>();
  const state: MockIdp = {
    base: "",
    users: {
      oidc: { sub: "oidc-sub-1", email: "staff@school.test", email_verified: true, name: "Mock Staff" },
      classlink: { sub: "cl-sub-1", email: "teacher@school.test", given_name: "Mock", family_name: "Teacher", classLink_tenant_id: "1234", classLink_sourcedId: "t-1", classLink_role: "teacher" },
      clever: { id: "clever-user-1", district: "district-1", email: "teacher@school.test", name: { first: "Mock", last: "Teacher" }, roles: { teacher: {} } },
      uaepass: { sub: "UAEPASS/uuid-1", uuid: "uuid-1", userType: "SOP3", email: "parent@family.test", firstnameEN: "Mock", lastnameEN: "Parent", fullnameEN: "Mock Parent", idn: "784201012345671" },
    },
    tamper: {},
    clients: {
      oidc: { id: "oidc-client", secret: "oidc-secret" },
      classlink: { id: "cl-client", secret: "cl-secret" },
      clever: { id: "clever-client", secret: "clever-secret" },
      uaepass: { id: "uaepass-client", secret: "uaepass-secret" },
    },
    tokenCalls: {},
    lastAuthorize: {},
    routes: new Map(),
    close: async () => undefined,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", state.base);
    const body = req.method === "POST" ? await readBody(req) : "";
    const custom = state.routes.get(url.pathname);
    if (custom) {
      const out = custom(req, url, body);
      if (out) return json(res, out.status, out.body, out.headers);
    }
    const [, prefix, ...rest] = url.pathname.split("/");
    const path = `/${rest.join("/")}`;
    const issuer = `${state.base}/${prefix}`;
    const client = state.clients[prefix === "clever-api" ? "clever" : prefix];

    // Discovery and keys
    if ((prefix === "oidc" || prefix === "classlink") && path === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        code_challenge_methods_supported: prefix === "oidc" ? ["S256"] : null,
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      });
    }
    if (path === "/jwks" || (prefix === "clever" && path === "/oauth/certs")) return json(res, 200, { keys: [jwk] });

    // Authorize: approve straight away as the configured user.
    const isAuthorize = path === "/authorize" || (prefix === "clever" && path === "/oauth/authorize") || (prefix === "uaepass" && path === "/idshub/authorize");
    if (isAuthorize) {
      const q = Object.fromEntries(url.searchParams.entries());
      state.lastAuthorize[prefix] = q;
      if (!client || q.client_id !== client.id || q.response_type !== "code") return json(res, 400, { error: "invalid_request" });
      const code = randomBytes(16).toString("hex");
      grants.set(code, { prefix, clientId: q.client_id, redirectUri: q.redirect_uri, nonce: q.nonce ?? null, challenge: q.code_challenge ?? null, user: { ...state.users[prefix] } });
      const back = new URL(q.redirect_uri);
      back.searchParams.set("code", code);
      if (q.state) back.searchParams.set("state", q.state);
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    // Token
    const isToken = path === "/token" || (prefix === "clever" && path === "/oauth/tokens") || (prefix === "uaepass" && path === "/idshub/token");
    if (isToken && req.method === "POST") {
      state.tokenCalls[prefix] = (state.tokenCalls[prefix] ?? 0) + 1;
      const form = new URLSearchParams(body);
      const auth = req.headers.authorization ?? "";
      const [id, secret] = auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString("utf8").split(":").map(decodeURIComponent) : [form.get("client_id"), form.get("client_secret")];
      if (!client || id !== client.id || secret !== client.secret) return json(res, 401, { error: "invalid_client" });
      const grant = grants.get(form.get("code") ?? "");
      grants.delete(form.get("code") ?? "");
      if (!grant || grant.prefix !== prefix || grant.redirectUri !== form.get("redirect_uri")) return json(res, 400, { error: "invalid_grant" });
      if (grant.challenge) {
        const verifier = form.get("code_verifier") ?? "";
        if (createHash("sha256").update(verifier).digest("base64url") !== grant.challenge) return json(res, 400, { error: "invalid_grant", error_description: "pkce" });
      }
      const access = randomBytes(16).toString("hex");
      tokens.set(access, { prefix, user: grant.user });
      const out: Record<string, unknown> = { access_token: access, token_type: "Bearer", expires_in: 3600 };
      if (prefix !== "uaepass" && !state.tamper.noIdToken) {
        const now = Math.floor(Date.now() / 1000);
        const t = state.tamper;
        const sub = prefix === "clever" ? String(grant.user.id) : String(grant.user.sub);
        const claims: Record<string, unknown> = {
          ...(prefix === "clever" ? { email: grant.user.email, district_id: grant.user.district } : grant.user),
          sub,
          iss: t.iss ?? issuer,
          aud: t.aud ?? client.id,
          iat: now,
          exp: t.expired ? now - 3600 : now + 600,
        };
        if (!t.dropNonce && (grant.nonce || t.nonce)) claims.nonce = t.nonce ?? grant.nonce;
        out.id_token = signJwt(claims, privateKey, kid, t);
      }
      return json(res, 200, out);
    }

    // User info and Clever API
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const tok = tokens.get(bearer);
    if (path === "/userinfo" || (prefix === "uaepass" && path === "/idshub/userinfo")) {
      if (!tok) return json(res, 401, { error: "invalid_token" });
      const u = { ...tok.user };
      if (state.tamper.userinfoSub) u.sub = state.tamper.userinfoSub;
      return json(res, 200, u);
    }
    if (prefix === "clever-api" && tok) {
      if (path === "/v3.0/me") return json(res, 200, { type: "user", data: { id: tok.user.id, district: tok.user.district, type: "user" } });
      if (path === `/v3.0/users/${tok.user.id}`) return json(res, 200, { data: tok.user });
    }
    return json(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}

/** Follows the authorize redirect like a browser would, returning the callback query. */
export async function approve(authorizeUrl: string): Promise<URLSearchParams> {
  const res = await fetch(authorizeUrl, { redirect: "manual" });
  const loc = res.headers.get("location");
  if (!loc) throw new Error(`authorize did not redirect (${res.status})`);
  return new URL(loc).searchParams;
}
