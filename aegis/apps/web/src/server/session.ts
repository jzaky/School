import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { rawPrisma } from "@aegis/db";
import { getUserMembership, hasPermission, listUserMemberships, makeContext, resolveSession, SESSION_COOKIE, type OrgContext, type Permission, type SessionInfo, type UserMembership } from "@aegis/core";

export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.user.mfaEnabled && !s.mfaPassed) redirect("/mfa");
  return s;
}

export interface ConsoleContext {
  session: SessionInfo;
  membership: UserMembership;
  memberships: UserMembership[];
  org: { id: string; slug: string; name: string; demoMode: boolean; settings: Record<string, unknown> };
  ctx: OrgContext;
  can: (p: Permission) => boolean;
}

/** Resolves the signed-in user plus their active organization. Redirects when either is missing. */
export const getConsoleContext = cache(async (): Promise<ConsoleContext> => {
  const session = await requireUser();
  const all = await listUserMemberships(session.user.id);
  // A single sign-on session sees only the organization whose identity provider issued it.
  const memberships = session.ssoOrgId ? all.filter((m) => m.orgId === session.ssoOrgId) : all;
  const active = memberships.filter((m) => m.status === "active");
  const membership = (session.activeOrgId ? active.find((m) => m.orgId === session.activeOrgId) : undefined) ?? active[0];
  if (!membership) redirect("/no-organization");
  const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: membership.orgId } });
  const h = await headers();
  const settings = (org.settings as Record<string, unknown>) ?? {};
  // The organization can require two-factor authentication: until it is on, only the account page opens.
  if (settings.requireMfa === true && !session.user.mfaEnabled && !(h.get("x-aegis-path") ?? "").startsWith("/account")) redirect("/account/security?mfa=required");
  const ctx = makeContext(
    membership.orgId,
    { type: "user", id: session.user.id, label: session.user.name, permissions: membership.permissions, membershipId: membership.membershipId },
    { requestId: h.get("x-request-id") ?? undefined },
  );
  return {
    session,
    membership,
    memberships,
    org: { id: org.id, slug: org.slug, name: org.name, demoMode: org.demoMode, settings: (org.settings as Record<string, unknown>) ?? {} },
    ctx,
    can: (p) => hasPermission(membership.permissions, p),
  };
});

export async function requirePermission(p: Permission): Promise<ConsoleContext> {
  const c = await getConsoleContext();
  if (!c.can(p)) redirect(`/forbidden?need=${encodeURIComponent(p)}`);
  return c;
}

export async function requirePlatformAdmin(): Promise<SessionInfo> {
  const s = await requireUser();
  if (!s.user.isPlatformAdmin) redirect("/forbidden?need=platform_admin");
  return s;
}

export { getUserMembership };
