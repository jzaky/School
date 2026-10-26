"use server";

// Sign-in page actions (public: email links, forgotten password) and the school's sign-in settings
// (signin.manage). Public actions answer the same way whatever happens, so they reveal nothing about accounts.
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/auth";
import { encryptField } from "@/lib/crypto";
import { clientIp } from "@/server/access/rate-limit";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { schoolBySlug, tenantTaken } from "@/server/platform/sso-lookup";
import { requestMagicLink } from "./magic-link";
import { requestPasswordReset, resetPassword } from "./password-reset";
import { cleanDomainList, cleanMethods, MATCH_BY, oidcReady, type MatchBy } from "./policy";
import { cleanScopes, discover, ProviderError, SSO_METHODS, methodConfigured } from "./providers";
import { checkOutboundUrl } from "./http";
import { localeOf, SCHOOL_HINT_COOKIE } from "./web";

async function ip() {
  try {
    return clientIp(await headers());
  } catch {
    return "local";
  }
}

// ---------------------------------------------------------------------------
// Public: email sign-in link, forgotten password, reset, magic link landing
// ---------------------------------------------------------------------------

export type PublicState = { done: boolean; error: string | null };

export async function requestMagicLinkAction(_: PublicState, form: FormData): Promise<PublicState> {
  const email = String(form.get("email") ?? "").slice(0, 200);
  const locale = localeOf(String(form.get("locale") ?? "en"));
  const slug = String(form.get("school") ?? "");
  if (!z.string().email().safeParse(email.trim()).success) return { done: false, error: "email" };
  const school = slug ? await schoolBySlug(slug) : null;
  await requestMagicLink({ email, orgId: school?.id ?? null, locale, ip: await ip() });
  return { done: true, error: null };
}

export async function requestPasswordResetAction(_: PublicState, form: FormData): Promise<PublicState> {
  const email = String(form.get("email") ?? "").slice(0, 200);
  const locale = localeOf(String(form.get("locale") ?? "en"));
  if (!z.string().email().safeParse(email.trim()).success) return { done: false, error: "email" };
  await requestPasswordReset({ email, locale, ip: await ip() });
  return { done: true, error: null };
}

export type ResetState = { done: boolean; error: string | null; issues?: string[] };

export async function resetPasswordAction(_: ResetState, form: FormData): Promise<ResetState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "").slice(0, 200);
  const confirm = String(form.get("confirm") ?? "").slice(0, 200);
  const locale = localeOf(String(form.get("locale") ?? "en"));
  if (password !== confirm) return { done: false, error: "mismatch" };
  const res = await resetPassword({ token, password, ip: await ip(), locale });
  if (res.ok) return { done: true, error: null };
  return { done: false, error: res.code, issues: res.issues };
}

/** The magic link landing page's button: uses the link once and opens a fresh session. */
export async function redeemMagicLinkAction(form: FormData) {
  const token = String(form.get("token") ?? "");
  const locale = localeOf(String(form.get("locale") ?? "en"));
  try {
    await signIn("magic", { token, redirectTo: `/${locale}/home` });
  } catch (e) {
    if (e instanceof AuthError) redirect(`/${locale}/magic-link?state=invalid`);
    throw e;
  }
}

/** Remembers the school chosen on /login/[school] so Google and Microsoft sign-ins land in it. A hint only. */
export async function rememberSchoolAction(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return;
  (await cookies()).set(SCHOOL_HINT_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180, secure: (process.env.AUTH_URL ?? process.env.APP_URL ?? "").startsWith("https://") });
}

export async function findSchoolAction(_: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  const raw = String(form.get("school") ?? "").trim().toLowerCase();
  const school = raw ? await schoolBySlug(raw) : null;
  if (!school) return { error: "notFound" };
  redirect(`/login/${school.slug}`);
}

// ---------------------------------------------------------------------------
// Settings (signin.manage)
// ---------------------------------------------------------------------------

type Fail = { ok: false; error: string; field?: string };
const fail = (error: string, field?: string): Fail => ({ ok: false, error, field });

async function manager() {
  const ctx = await getCtx();
  return ctx.can("signin.manage") ? ctx : null;
}

const settingsSchema = z.object({
  methods: z.array(z.string()).max(12),
  staffSsoRequired: z.boolean(),
  allowedDomains: z.array(z.string().max(253)).max(20),
  matchBy: z.string(),
  selfJoinDomains: z.array(z.string().max(253)).max(20),
  selfJoinApproval: z.boolean(),
  classlinkTenantId: z.string().trim().max(80),
  cleverDistrictId: z.string().trim().max(80),
  microsoftTenantId: z.string().trim().max(80),
  uaePassEidMatch: z.boolean(),
  oidcName: z.string().trim().max(60),
  oidcIssuer: z.string().trim().max(500),
  oidcClientId: z.string().trim().max(200),
  /** Blank keeps the saved secret. */
  oidcSecret: z.string().max(2000),
  oidcScopes: z.string().trim().max(300),
  oidcEmailClaim: z.string().trim().max(60),
  oidcIdClaim: z.string().trim().max(60),
  oidcNameClaim: z.string().trim().max(60),
  oidcTrustEmail: z.boolean(),
});
export type SettingsInput = z.input<typeof settingsSchema>;

const CLAIM = /^[A-Za-z_][A-Za-z0-9_.:-]{0,59}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT = /^[A-Za-z0-9_-]{1,80}$/;

export async function saveSignInSettingsAction(raw: SettingsInput): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  const methods = cleanMethods(d.methods);
  const allowed = cleanDomainList(d.allowedDomains);
  if (allowed.invalid) return fail("DOMAIN", "allowedDomains");
  const selfJoin = cleanDomainList(d.selfJoinDomains);
  if (selfJoin.invalid) return fail("DOMAIN", "selfJoinDomains");
  if (allowed.domains.length && selfJoin.domains.some((x) => !allowed.domains.includes(x))) return fail("SELF_JOIN_DOMAIN", "selfJoinDomains");
  if (!(MATCH_BY as string[]).includes(d.matchBy)) return fail("INVALID");
  if (d.classlinkTenantId && !TENANT.test(d.classlinkTenantId)) return fail("TENANT", "classlinkTenantId");
  if (d.cleverDistrictId && !TENANT.test(d.cleverDistrictId)) return fail("TENANT", "cleverDistrictId");
  if (d.microsoftTenantId && !GUID.test(d.microsoftTenantId)) return fail("MS_TENANT", "microsoftTenantId");
  if (d.classlinkTenantId && (await tenantTaken("classlink", d.classlinkTenantId, ctx.orgId))) return fail("TENANT_TAKEN", "classlinkTenantId");
  if (d.cleverDistrictId && (await tenantTaken("clever", d.cleverDistrictId, ctx.orgId))) return fail("TENANT_TAKEN", "cleverDistrictId");
  for (const c of [d.oidcEmailClaim, d.oidcIdClaim, d.oidcNameClaim]) if (c && !CLAIM.test(c)) return fail("CLAIM", "oidc");
  let issuer: string | null = null;
  if (d.oidcIssuer) {
    try {
      issuer = checkOutboundUrl(d.oidcIssuer).toString().replace(/\/+$/, "");
    } catch {
      return fail("ISSUER", "oidcIssuer");
    }
  }
  const existing = await ctx.db.signInPolicy.findUnique({ where: { orgId: ctx.orgId } });
  const secretEnc = d.oidcSecret ? encryptField(d.oidcSecret) : (existing?.oidcSecretEnc ?? null);
  const oidc = { oidcIssuer: issuer, oidcClientId: d.oidcClientId || null, oidcSecretEnc: issuer && d.oidcClientId ? secretEnc : null };
  // Requiring single sign-on with no working single sign-on would lock staff out.
  const ssoUsable = methods.some((m) => SSO_METHODS.includes(m) && methodConfigured(m) && (m !== "oidc" || oidcReady(oidc)) && (m !== "classlink" || !!d.classlinkTenantId) && (m !== "clever" || !!d.cleverDistrictId));
  if (d.staffSsoRequired && !ssoUsable) return fail("NO_SSO_METHOD", "staffSsoRequired");
  const data = {
    methods,
    staffSsoRequired: d.staffSsoRequired,
    allowedDomains: allowed.domains,
    matchBy: d.matchBy as MatchBy,
    selfJoinDomains: selfJoin.domains,
    selfJoinApproval: d.selfJoinApproval,
    classlinkTenantId: d.classlinkTenantId || null,
    cleverDistrictId: d.cleverDistrictId || null,
    microsoftTenantId: d.microsoftTenantId ? d.microsoftTenantId.toLowerCase() : null,
    uaePassEidMatch: d.uaePassEidMatch,
    oidcName: d.oidcName || null,
    ...oidc,
    oidcScopes: cleanScopes(d.oidcScopes || "openid email profile"),
    oidcEmailClaim: d.oidcEmailClaim || "email",
    oidcIdClaim: d.oidcIdClaim || "sub",
    oidcNameClaim: d.oidcNameClaim || "name",
    oidcTrustEmail: d.oidcTrustEmail,
    updatedById: ctx.membershipId,
  };
  const changed = existing ? Object.keys(data).filter((k) => k !== "updatedById" && k !== "oidcSecretEnc" && JSON.stringify((existing as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k])) : Object.keys(data).filter((k) => k !== "updatedById");
  if (d.oidcSecret) changed.push("oidcSecret");
  await ctx.db.signInPolicy.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, ...data }, update: data });
  // Keep the original Google and Microsoft switches in step (join pages and older screens read them).
  await ctx.db.organization.update({ where: { id: ctx.orgId }, data: { googleSignIn: methods.includes("google"), microsoftSignIn: methods.includes("microsoft") } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "signin.settings_updated", entityType: "SignInPolicy", entityId: ctx.orgId, meta: { changed, methods, staffSsoRequired: d.staffSsoRequired } });
  revalidatePath("/[locale]/admin/sign-in", "page");
  return { ok: true };
}

/** Checks a school identity provider's discovery document before saving. */
export async function testOidcAction(issuerRaw: string): Promise<{ ok: true; issuer: string; pkce: boolean; userinfo: boolean } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  let issuer: string;
  try {
    issuer = checkOutboundUrl(String(issuerRaw).trim()).toString().replace(/\/+$/, "");
  } catch {
    return fail("ISSUER");
  }
  try {
    const d = await discover(issuer, Date.now() + 2 * 3600_000);
    return { ok: true, issuer: d.issuer, pkce: !d.code_challenge_methods_supported || d.code_challenge_methods_supported.includes("S256"), userinfo: !!d.userinfo_endpoint };
  } catch (e) {
    return fail(e instanceof ProviderError ? e.code : "DISCOVERY");
  }
}

/** Removes a linked sign-in identity (for example after a person's account at the provider changed). */
export async function unlinkIdentityAction(id: string): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const row = await ctx.db.ssoIdentity.findUnique({ where: { id: String(id) } });
  if (!row) return fail("NOT_FOUND");
  await ctx.db.ssoIdentity.delete({ where: { id: row.id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "auth.sso_unlinked", entityType: "Membership", entityId: row.membershipId, meta: { method: row.provider } });
  revalidatePath("/[locale]/admin/sign-in", "page");
  return { ok: true };
}
