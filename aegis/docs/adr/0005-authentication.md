# ADR-0005: Authentication

Status: accepted, 2026-10-10

## Decision
- Console users: email and password (argon2id), optional TOTP MFA (RFC 6238 implemented with Node crypto), server-side sessions stored in PostgreSQL with rotating opaque tokens in an HttpOnly, Secure, SameSite=Lax cookie. Sessions can be revoked individually and per user.
- Enterprise SSO: OpenID Connect authorization code flow with PKCE, per organization, using the `jose` library for token verification. Enabled per organization by an admin; disabled unless configured. SAML is not implemented and is documented as missing.
- Agents and integrations: API keys with a prefix, SHA-256 hashed at rest, scoped to one agent or integration, revocable, with last-used tracking.
- Platform admins: a separate role on the user, plus a separate owner database connection used only in `packages/core/src/platform`.

## Why not an auth library
Auth.js and similar libraries optimise for social login in Next.js. AEGIS needs the same identity in Fastify and Next.js, server-side revocation, MFA and per-tenant OIDC. A small, explicit implementation is easier to audit than configuring around a library.
