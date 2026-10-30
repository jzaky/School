"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { changeMemberRole, createRole, createTeam, deleteRole, env, forbidden, inviteUser, roleInputSchema, setContinuousGovernance, setMemberStatus, setTeamMembers, slugSchema, ssoConnectionSchema, updateOrganization, updateRole, upsertSsoConnection, parsePatch } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

export async function inviteUserAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.object({ email: z.string().email().max(254), roleId: z.string().uuid() }).parse(input);
    const r = await withTenant(c.ctx.orgId, (db) => inviteUser(db, c.ctx, data));
    revalidatePath("/org/users");
    // The invitation link is shown once; only the hash is stored.
    return { link: `${env().WEB_PUBLIC_URL}/invite/${r.token}`, expiresAt: r.invitation.expiresAt.toISOString() };
  });
}

export async function changeMemberRoleAction(membershipId: string, roleId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => changeMemberRole(db, c.ctx, z.string().uuid().parse(membershipId), z.string().uuid().parse(roleId)));
    revalidatePath("/org/users");
  });
}

export async function setMemberStatusAction(membershipId: string, status: "active" | "suspended") {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => setMemberStatus(db, c.ctx, z.string().uuid().parse(membershipId), z.enum(["active", "suspended"]).parse(status)));
    revalidatePath("/org/users");
  });
}

export async function createTeamAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = z.object({ key: slugSchema, name: z.string().min(2).max(80), description: z.string().max(300).default("") }).parse(input);
    const t = await withTenant(c.ctx.orgId, (db) => createTeam(db, c.ctx, data));
    revalidatePath("/org/teams");
    return { id: t.id };
  });
}

export async function setTeamMembersAction(teamId: string, membershipIds: string[], leadId: string | null) {
  return act(async () => {
    const c = await getConsoleContext();
    const ids = z.array(z.string().uuid()).max(500).parse(membershipIds);
    const lead = leadId ? z.string().uuid().parse(leadId) : undefined;
    await withTenant(c.ctx.orgId, (db) => setTeamMembers(db, c.ctx, z.string().uuid().parse(teamId), ids, lead && ids.includes(lead) ? lead : undefined));
    revalidatePath("/org/teams");
  });
}

export async function createRoleAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = roleInputSchema.parse(input);
    const r = await withTenant(c.ctx.orgId, (db) => createRole(db, c.ctx, data));
    revalidatePath("/org/roles");
    return { id: r.id };
  });
}

export async function updateRoleAction(roleId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = parsePatch(roleInputSchema.pick({ name: true, description: true, permissions: true }), input);
    await withTenant(c.ctx.orgId, (db) => updateRole(db, c.ctx, z.string().uuid().parse(roleId), data));
    revalidatePath("/org/roles");
  });
}

export async function deleteRoleAction(roleId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    await withTenant(c.ctx.orgId, (db) => deleteRole(db, c.ctx, z.string().uuid().parse(roleId)));
    revalidatePath("/org/roles");
  });
}

const settingsSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "three-letter ISO code").optional(),
  timezone: z
    .string()
    .min(2)
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "not a recognised time zone name")
    .optional(),
  locale: z.enum(["en", "ar"]).optional(),
  dataResidencyCountry: z.string().regex(/^[A-Z]{2}$/, "two-letter ISO country code").optional(),
  auditRetentionDays: z.coerce.number().int().min(365, "at least 365 days").max(36500).optional(),
  approvalDefaultExpiryMinutes: z.coerce.number().int().min(5).max(10080).optional(),
  requireMfa: z.boolean().optional(),
});

export async function updateOrganizationAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = settingsSchema.parse(input);
    const settings = { ...c.org.settings };
    if (data.currency !== undefined) settings.currency = data.currency;
    if (data.timezone !== undefined) settings.timezone = data.timezone;
    if (data.locale !== undefined) settings.locale = data.locale;
    if (data.dataResidencyCountry !== undefined) settings.dataResidencyCountry = data.dataResidencyCountry;
    if (data.auditRetentionDays !== undefined) settings.auditRetentionDays = data.auditRetentionDays;
    if (data.approvalDefaultExpiryMinutes !== undefined) settings.approvalDefaultExpiryMinutes = data.approvalDefaultExpiryMinutes;
    if (data.requireMfa !== undefined) settings.requireMfa = data.requireMfa;
    await updateOrganization(c.ctx, { ...(data.name ? { name: data.name } : {}), settings });
    revalidatePath("/org/settings");
    revalidatePath("/org/deployment");
    revalidatePath("/", "layout");
  });
}

/** Hides the onboarding checklist for everyone in the organization. Recorded as an org update. */
export async function dismissOnboardingAction() {
  return act(async () => {
    const c = await getConsoleContext();
    await updateOrganization(c.ctx, { settings: { ...c.org.settings, onboardingDismissedAt: new Date().toISOString() } });
    revalidatePath("/getting-started");
    revalidatePath("/org/settings");
    revalidatePath("/overview");
    revalidatePath("/", "layout");
  });
}

/** Brings the onboarding checklist back after it was dismissed. */
export async function restoreOnboardingAction() {
  return act(async () => {
    const c = await getConsoleContext();
    await updateOrganization(c.ctx, { settings: { onboardingDismissedAt: null } });
    revalidatePath("/getting-started");
    revalidatePath("/org/settings");
    revalidatePath("/overview");
    revalidatePath("/", "layout");
  });
}

/** Continuous governance: mode and the automatic response per monitoring rule. Recorded in evidence. */
export async function setContinuousGovernanceAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("org:admin")) throw forbidden("Missing permission org:admin");
    const data = await setContinuousGovernance({ ...c.ctx, actor: { ...c.ctx.actor, label: c.session.user.name } }, input);
    revalidatePath("/org/settings");
    revalidatePath("/", "layout");
    return data;
  });
}

/** Creates or updates the organization's single sign-on connection (OIDC or SAML). Requires org:admin. */
export async function saveSsoConnectionAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("org:admin")) throw forbidden("Missing permission org:admin");
    const data = ssoConnectionSchema.parse(input);
    await withTenant(c.ctx.orgId, (db) => upsertSsoConnection(db, c.ctx, data));
    revalidatePath("/org/settings");
  });
}
