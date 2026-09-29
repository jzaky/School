import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { identityDb, publicOrgBySlug, tenantDb } from "@/lib/tenant-db";
import { resolveActiveMembership } from "@/server/identity/session-org";
import { passwordSignInAllowed, oauthSignInDecision } from "@/server/access/sign-in";
import { pendingSignup } from "@/server/onboarding/oauth-signup";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      activeOrgId: string;
      membershipId: string;
      persona?: string | null;
    };
  }
  interface User {
    activeOrgId?: string;
    membershipId?: string;
    persona?: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    activeOrgId?: string;
    membershipId?: string;
    persona?: string | null;
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
      if (!user?.passwordHash) return null;
      const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!ok) return null;
      const membership = await resolveActiveMembership(user.id, user.lastActiveOrgId, { includePending: true });
      if (!membership) return null;
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
];

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
  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.type === "credentials") return true;
      // OAuth: only people the school has provisioned may sign in, or someone finishing a join link.
      const email = user.email?.toLowerCase();
      if (!email) return false;
      // A school sign-up in progress (see /signup) may create the account; /signup/complete then creates the school.
      const signingUp = Boolean(await pendingSignup());
      if (!signingUp) {
        const decision = await oauthSignInDecision(email, user.name ?? null, account.provider);
        if (decision !== true) return decision;
      }
      let existing = await identityDb.user.findUnique({ where: { email } });
      if (!existing && signingUp) existing = await identityDb.user.create({ data: { email, nameEn: (await pendingSignup())?.adminName ?? user.name ?? email, emailVerified: new Date() } });
      if (!existing) return "/login?error=NotProvisioned";
      await identityDb.account.upsert({
        where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
        create: { userId: existing.id, type: account.type, provider: account.provider, providerAccountId: account.providerAccountId },
        update: {},
      });
      return true;
    },
    async jwt({ token, user, account, trigger, session }) {
      if (user && account) {
        if (account.type === "credentials") {
          token.uid = user.id;
          token.activeOrgId = user.activeOrgId;
          token.membershipId = user.membershipId;
          token.persona = user.persona ?? null;
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
        if (wanted) {
          const m = await resolveActiveMembership(token.uid, wanted);
          if (m && m.orgId === wanted) {
            token.activeOrgId = m.orgId;
            token.membershipId = m.id;
            await identityDb.user.update({ where: { id: token.uid }, data: { lastActiveOrgId: m.orgId } });
          }
        }
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
      };
      return session;
    },
  },
});
