"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { changeMemberRole, createRole, createTeam, deleteRole, env, inviteUser, roleInputSchema, setMemberStatus, setTeamMembers, slugSchema, updateOrganization, updateRole } from "@aegis/core";
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
    const data = roleInputSchema.pick({ name: true, description: true, permissions: true }).partial().parse(input);
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
  timezone: z.string().min(2).max(64).optional(),
  approvalDefaultExpiryMinutes: z.coerce.number().int().min(5).max(10080).optional(),
});

export async function updateOrganizationAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const data = settingsSchema.parse(input);
    const settings = { ...c.org.settings };
    if (data.currency !== undefined) settings.currency = data.currency;
    if (data.timezone !== undefined) settings.timezone = data.timezone;
    if (data.approvalDefaultExpiryMinutes !== undefined) settings.approvalDefaultExpiryMinutes = data.approvalDefaultExpiryMinutes;
    await updateOrganization(c.ctx, { ...(data.name ? { name: data.name } : {}), settings });
    revalidatePath("/org/settings");
    revalidatePath("/", "layout");
  });
}
