import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { randomUUID } from "node:crypto";
import { passwordMatches } from "@/server/identity/password";
import { z } from "zod";
import { headers } from "next/headers";
import { identityDb, publicOrgBySlug, tenantDb } from "@/lib/tenant-db";
import { resolveActiveMembership } from "@/server/identity/session-org";
import { passwordSignInAllowed, oauthSignInDecision } from "@/server/access/sign-in";
import { pendingSignup } from "@/server/onboarding/oauth-signup";
import { groupRolesForUser } from "@/server/groups/access";
import { auditPasswordSignIn, globallyVerified, oauthIdentity, schoolHintOrgId } from "@/server/sso/auth-bridge";
import { resolveSignIn } from "@/server/sso/link";
import { loadPolicy } from "@/server/sso/policy";
import { localSignInAllowed } from "@/server/sso/staff-sso";
import { redeemTicket } from "@/server/sso/ticket";
import { redeemMagicLink } from "@/server/sso/magic-link";
import { schoolById } from "@/server/platform/sso-lookup";
import { loginPath } from "@/server/sso/web";
import { clientIp } from "@/server/access/rate-limit";
import { claimByVerifiedProvider } from "@/server/identity/unproven-account";
import { revokeSessionId, sessionIdRevoked, sessionRevoked, sessionTooOld } from "@/server/sso/session-revocation";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      activeOrgId: string;
      membershipId: string;
      persona?: string | null;
      /** Single sign-on sessions stay in the school they signed in to. */
      orgLocked?: boolean;
      /** When this session was opened (ms). A later password reset ends it. */
      signedInAt?: number;
    };
  }
  interface User {
    activeOrgId?: string;
    membershipId?: string;
    persona?: string | null;
    uid?: string;
    lockOrg?: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    activeOrgId?: string;
    membershipId?: string;
    persona?: string | null;
    lockOrg?: string | null;
    sat?: number;
    /** Session id, recorded as ended on sign-out. */
    sid?: string;
  }
}

const passwordSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const personaSchema = z.object({ orgSlug: z.string().min(1), personaKey: z.string().min(1) });

export const demoModeEnabled = () => process.env.DEMO_MODE === "true";

const providers: NextAuthConfig["providers"] = [
  Credentials({
    id: "password",
    name: "Email and password",
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const parsed = passwordSchema.safeParse(raw);
      if (!parsed.success) return null;
      if (!(await passwordSignInAllowed(parsed.data.email))) return null;
      const user = await identityDb.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
      // Same work whether or not the account exists, so timing reveals nothing.
      const ok = await passwordMatches(parsed.data.password, user?.passwordHash);
      if (!user?.passwordHash) return null;
      if (!ok) {
        const m = await resolveActiveMembership(user.id, user.lastActiveOrgId, { includePending: true });
        if (m) await auditPasswordSignIn(m.orgId, m.id, user.id, "wrong_password");
        return null;
      }
      const membership = await resolveActiveMembership(user.id, user.lastActiveOrgId, { includePending: true });
      if (!membership) {
        // School group people may have no membership in any school: they get a session for the group area only.
        if ((await groupRolesForUser(user.id)).length) return { id: user.id, email: user.email, name: user.nameEn };
        return null;
      }
      // Staff of a school that requires single sign-on are told so only after proving the password, so the
      // message reveals nothing to someone guessing addresses.
      if (!(await localSignInAllowed(membership.orgId, membership.id, await loadPolicy(membership.orgId)))) {
        await auditPasswordSignIn(membership.orgId, membership.id, user.id, "sso_required");
        throw new SsoRequired();
      }
      await auditPasswordSignIn(membership.orgId, membership.id, user.id, "ok");
      return { id: user.id, email: user.email, name: user.nameEn, activeOrgId: membership.orgId, membershipId: membership.id };
    },
  }),
  Credentials({
    id: "persona",
    name: "Demo persona",
    credentials: { orgSlug: {}, personaKey: {} },
    async authorize(raw) {
      if (!demoModeEnabled()) return null;
      const parsed = personaSchema.safeParse(raw);
      if (!parsed.success) return null;
      const org = await publicOrgBySlug(parsed.data.orgSlug);
      if (!org?.isDemo) return null;
      const db = tenantDb(org.id);
      const persona = await db.demoPersona.findUnique({
        where: { orgId_key: { orgId: org.id, key: parsed.data.personaKey } },
      });
      if (!persona) return null;
      const membership = await db.membership.findUnique({ where: { id: persona.membershipId } });
      if (!membership || membership.status !== "ACTIVE") return null;
      const user = await identityDb.user.findUnique({ where: { id: membership.userId } });
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        name: user.nameEn,
        activeOrgId: org.id,
        membershipId: membership.id,
        persona: persona.key,
      };
    },
  }),
  // Single sign-on (ClassLink, Clever, UAE PASS, school OpenID Connect): redeems the one-time ticket issued by
  // /api/sso/[provider]/callback after the flow and linking checks passed.
  Credentials({
    id: "sso",
    name: "Single sign-on",
    credentials: { ticket: {} },
    async authorize(raw) {
      const t = await redeemTicket((raw as { ticket?: unknown })?.ticket);
      if (!t) return null;
      const m = await tenantDb(t.orgId).membership.findUnique({ where: { id: t.membershipId }, select: { userId: true, status: true } });
      if (!m || m.userId !== t.userId || (m.status !== "ACTIVE" && m.status !== "PENDING_APPROVAL")) return null;
      const user = await identityDb.user.findUnique({ where: { id: t.userId } });
      if (!user) return null;
      await identityDb.user.update({ where: { id: user.id }, data: { lastActiveOrgId: t.orgId } });
      return { id: user.id, email: user.email, name: user.nameEn, activeOrgId: t.orgId, membershipId: t.membershipId, lockOrg: t.orgId };
    },
  }),
  // Email sign-in link: single use, 15 minutes, see src/server/sso/magic-link.ts.
  Credentials({
    id: "magic",
    name: "Email link",
    credentials: { token: {} },
    async authorize(raw) {
      let ip = "local";
      try {
        ip = clientIp(await headers());
      } catch {
        ip = "local";
      }
      const r = await redeemMagicLink((raw as { token?: unknown })?.token, { ip });
      if (!r) return null;
      const user = await identityDb.user.findUnique({ where: { id: r.userId } });
      if (!user) return null;
      await identityDb.user.update({ where: { id: user.id }, data: { lastActiveOrgId: r.orgId } });
      return { id: user.id, email: user.email, name: user.nameEn, activeOrgId: r.orgId, membershipId: r.membershipId };
    },
  }),
];

/** Password sign-in refused because the school requires single sign-on for staff (shown to the person). */
class SsoRequired extends CredentialsSignin {
  code = "sso_required";
}

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google({ allowDangerousEmailAccountLinking: true }));
}
if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET) {
  providers.push(
    MicrosoftEntraID({
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

export const enabledOAuthProviders = () => ({
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  microsoft: Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET),
});

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login", error: "/login" },
  providers,
  events: {
    // A copied session cookie stops working once its owner signs out.
    async signOut(message) {
      const sid = "token" in message ? message.token?.sid : undefined;
      if (sid) await revokeSessionId(sid).catch(() => undefined);
    },
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.type === "credentials") return true;
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const linkAccount = (userId: string) =>
        identityDb.account.upsert({
          where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
          create: { userId, type: account.type, provider: account.provider, providerAccountId: account.providerAccountId },
          update: {},
        });
      // A school sign-up in progress (see /signup) may create the account; /signup/complete then creates the school.
      const g = oauthIdentity(account.provider, account.providerAccountId, user, profile);
      if (!g) return "/login?error=SSO_UNKNOWN";
      const pending = await pendingSignup();
      if (pending) {
        // Only an address the provider itself verified may create an account or be linked to an existing one.
        if (!globallyVerified(g)) return "/login?error=EMAIL_UNVERIFIED";
        const found = await identityDb.user.findUnique({ where: { email } });
        if (found) await claimByVerifiedProvider(found.id);
        const existing = found ?? (await identityDb.user.create({ data: { email, nameEn: pending.adminName ?? user.name ?? email, emailVerified: new Date() } }));
        await linkAccount(existing.id);
        return true;
      }
      const existing = await identityDb.user.findUnique({ where: { email } });
      const hint = await schoolHintOrgId();
      const membership = existing ? await resolveActiveMembership(existing.id, hint ?? existing.lastActiveOrgId, { includePending: true }) : null;
      const orgId = hint ?? membership?.orgId ?? null;
      if (!orgId) {
        // Not a member of any school yet: only someone finishing a join link may continue, and only with an
        // address the provider itself verified.
        if (!globallyVerified(g)) return "/login?error=EMAIL_UNVERIFIED";
        const decision = await oauthSignInDecision(email, user.name ?? null, account.provider);
        if (decision !== true) return decision;
        const created = await identityDb.user.findUnique({ where: { email } });
        if (!created) return "/login?error=NotProvisioned";
        // The provider proved the address: a password set before it was proven no longer opens this account.
        await claimByVerifiedProvider(created.id);
        await linkAccount(created.id);
        return true;
      }
      // Members: the shared rules decide (school option on, verified address, allowed domains, linking).
      const outcome = await resolveSignIn(orgId, g.identity, { msTenant: g.msTenant, msVerifiedDomain: g.msVerifiedDomain });
      if (!outcome.ok) return loginPath(hint ? ((await schoolById(orgId))?.slug ?? null) : null, outcome.code);
      user.uid = outcome.userId;
      user.activeOrgId = outcome.orgId;
      user.membershipId = outcome.membershipId;
      await linkAccount(outcome.userId);
      return true;
    },
    async jwt({ token, user, account, trigger, session }) {
      if (user && account) {
        // Every sign-in issues a new token with its own start time (a password reset ends older ones) and id.
        token.sat = Date.now();
        token.sid = randomUUID();
        if (account.type === "credentials") {
          token.uid = user.id;
          token.activeOrgId = user.activeOrgId;
          token.membershipId = user.membershipId;
          token.persona = user.persona ?? null;
          token.lockOrg = user.lockOrg ?? null;
        } else if (user.uid && user.activeOrgId) {
          // Google or Microsoft member sign-in, resolved by the shared rules in the signIn callback.
          const u = await identityDb.user.findUnique({ where: { id: user.uid }, select: { nameEn: true } });
          token.uid = user.uid;
          token.activeOrgId = user.activeOrgId;
          token.membershipId = user.membershipId;
          token.name = u?.nameEn ?? token.name;
          token.persona = null;
          token.lockOrg = null;
          await identityDb.user.update({ where: { id: user.uid }, data: { lastActiveOrgId: user.activeOrgId } });
        } else {
          const existing = await identityDb.user.findUnique({ where: { email: user.email!.toLowerCase() } });
          if (existing) {
            const m = await resolveActiveMembership(existing.id, existing.lastActiveOrgId, { includePending: true });
            token.uid = existing.id;
            token.activeOrgId = m?.orgId;
            token.membershipId = m?.id;
            token.name = existing.nameEn;
            token.persona = null;
          }
        }
      }
      // Signed in before their school existed (OAuth sign-up): pick up the new membership once it is there.
      if (token.uid && !token.activeOrgId) {
        const m = await resolveActiveMembership(token.uid, null);
        if (m) {
          token.activeOrgId = m.orgId;
          token.membershipId = m.id;
        }
      }
      if (trigger === "update" && session && typeof session === "object" && token.uid) {
        const wanted = (session as { activeOrgId?: string }).activeOrgId;
        // A single sign-on session stays in its school: switching needs a new sign-in there.
        if (wanted && (!token.lockOrg || token.lockOrg === wanted)) {
          const m = await resolveActiveMembership(token.uid, wanted);
          if (m && m.orgId === wanted) {
            token.activeOrgId = m.orgId;
            token.membershipId = m.id;
            await identityDb.user.update({ where: { id: token.uid }, data: { lastActiveOrgId: m.orgId } });
          }
        }
      }
      // Every read of the session checks that it is still valid (src/server/sso/session-revocation.ts).
      if (token.uid) {
        token.sat ??= Date.now();
        if (sessionTooOld(token.sat)) return null;
        if (await sessionIdRevoked(token.sid)) return null;
        const u = await identityDb.user.findUnique({ where: { id: token.uid }, select: { sessionsValidFrom: true } });
        if (!u || sessionRevoked(u.sessionsValidFrom, token.sat)) return null;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.uid ?? "",
        email: token.email ?? "",
        name: token.name ?? "",
        activeOrgId: token.activeOrgId ?? "",
        membershipId: token.membershipId ?? "",
        persona: token.persona ?? null,
        orgLocked: Boolean(token.lockOrg),
        signedInAt: token.sat ?? 0,
      };
      return session;
    },
  },
});
