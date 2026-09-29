"use server";

// Server actions for roles, invitations, join settings and join requests. Thin wrappers: check the
// permission, call the core function (which audits), flush post-commit effects, refresh the page.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { unstable_update } from "@/auth";
import { getCtx, type Ctx } from "@/server/context";
import { flushEffects } from "@/server/queue";
import { listUserOrganizations } from "@/server/identity/session-org";
import { isLocale } from "@/i18n/routing";
import {
  AccessError,
  addRoleMember,
  createRole,
  deleteRole,
  removeRoleMember,
  restoreRoleDefault,
  setMemberRoles,
  setRolePermission,
  updateRoleDetails,
  type Actor,
} from "./roles";
import {
  InviteError,
  createStaffLink,
  inviteAllFamilies,
  inviteParent,
  inviteStaff,
  inviteStudent,
  regenerateJoinCode,
  resendInvitation,
  revokeInvitation,
  updateJoinSettings,
} from "./invitations";
import { approveJoinRequest, rejectJoinRequest } from "./join-requests";
import { JoinError } from "./membership-setup";
import type { Permission } from "@/server/identity/permissions";
import { FIRST_RUN_COOKIE } from "./first-run";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

async function actorWith(...perms: Permission[]): Promise<{ ctx: Ctx; actor: Actor } | null> {
  const ctx = await getCtx();
  if (!perms.some((p) => ctx.can(p))) return null;
  return { ctx, actor: { orgId: ctx.orgId, membershipId: ctx.membershipId, userId: ctx.user.id } };
}

function codeOf(e: unknown): string | null {
  if (e instanceof AccessError || e instanceof InviteError || e instanceof JoinError) return e.code;
  return null;
}

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | Fail> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    const code = codeOf(e);
    if (code) return fail(code);
    throw e;
  }
}

function refreshRoles() {
  revalidatePath("/[locale]/admin/roles", "layout");
  revalidatePath("/[locale]/admin/people", "page");
}
function refreshInvites() {
  revalidatePath("/[locale]/admin/invitations", "page");
  revalidatePath("/[locale]/admin/people", "page");
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const permSchema = z.object({ roleId: z.string().min(1), permission: z.string().min(1), granted: z.boolean(), confirmText: z.string().max(200).nullable().optional() });

export async function setRolePermissionAction(input: z.input<typeof permSchema>) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const d = permSchema.safeParse(input);
  if (!d.success) return fail("INVALID");
  const res = await run(() => setRolePermission(a.actor, d.data));
  if (res.ok) refreshRoles();
  return res.ok ? { ok: true as const } : res;
}

export async function restoreRoleDefaultAction(roleId: string) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => restoreRoleDefault(a.actor, String(roleId)));
  if (res.ok) refreshRoles();
  return res.ok ? { ok: true as const } : res;
}

const detailsSchema = z.object({
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().max(80),
  descEn: z.string().trim().max(300).optional(),
  descAr: z.string().trim().max(300).optional(),
});

export async function createRoleAction(input: z.input<typeof detailsSchema> & { copyFromRoleId?: string | null }) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const d = detailsSchema.safeParse(input);
  if (!d.success) return fail("INVALID");
  const res = await run(() => createRole(a.actor, { ...d.data, copyFromRoleId: input.copyFromRoleId || null }));
  if (!res.ok) return res;
  refreshRoles();
  return { ok: true as const, roleId: res.value.id };
}

export async function updateRoleDetailsAction(input: z.input<typeof detailsSchema> & { roleId: string }) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const d = detailsSchema.safeParse(input);
  if (!d.success) return fail("INVALID");
  const res = await run(() => updateRoleDetails(a.actor, { ...d.data, roleId: String(input.roleId) }));
  if (res.ok) refreshRoles();
  return res.ok ? { ok: true as const } : res;
}

export async function deleteRoleAction(input: { roleId: string; moveToRoleId?: string | null }) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => deleteRole(a.actor, { roleId: String(input.roleId), moveToRoleId: input.moveToRoleId || null }));
  if (res.ok) refreshRoles();
  return res.ok ? { ok: true as const } : res;
}

const memberRolesSchema = z.object({ membershipId: z.string().min(1), roleIds: z.array(z.string().min(1)).min(1).max(30), confirmSensitive: z.boolean().optional() });

export async function setMemberRolesAction(input: z.input<typeof memberRolesSchema>) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const d = memberRolesSchema.safeParse(input);
  if (!d.success) return fail("INVALID");
  const res = await run(() => setMemberRoles(a.actor, d.data));
  if (res.ok) refreshRoles();
  return res.ok ? { ok: true as const } : res;
}

export async function addRoleMemberAction(input: { roleId: string; membershipId: string; confirmSensitive?: boolean }) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => addRoleMember(a.actor, { roleId: String(input.roleId), membershipId: String(input.membershipId), confirmSensitive: !!input.confirmSensitive }));
  if (res.ok) refreshRoles();
  return res.ok ? { ok: true as const } : res;
}

export async function removeRoleMemberAction(input: { roleId: string; membershipId: string }) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => removeRoleMember(a.actor, { roleId: String(input.roleId), membershipId: String(input.membershipId) }));
  if (res.ok) refreshRoles();
  return res.ok ? { ok: true as const } : res;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const staffRowSchema = z.object({ nameEn: z.string().max(120), email: z.string().max(254), roleKeys: z.array(z.string().max(80)).max(10), department: z.string().max(120).nullable().optional() });

export async function inviteStaffAction(input: { rows: Array<z.input<typeof staffRowSchema>> }) {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const rows = z.array(staffRowSchema).min(1).max(500).safeParse(input.rows);
  if (!rows.success) return fail("INVALID");
  const res = await run(() => inviteStaff(a.actor, rows.data));
  if (!res.ok) return res;
  await flushEffects(res.value.effects);
  refreshInvites();
  return { ok: true as const, created: res.value.created.map((c) => ({ email: c.email, token: c.token, emailed: c.emailed })), problems: res.value.problems };
}

export async function inviteParentAction(input: { email: string; nameEn?: string; studentIds: string[] }) {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => inviteParent(a.actor, { email: String(input.email ?? ""), nameEn: input.nameEn ?? null, studentIds: (input.studentIds ?? []).map(String) }));
  if (!res.ok) return res;
  await flushEffects(res.value.effects);
  refreshInvites();
  return { ok: true as const, created: res.value.created.map((c) => ({ email: c.email, token: c.token, emailed: c.emailed })) };
}

export async function inviteStudentAction(input: { studentId: string; email: string }) {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => inviteStudent(a.actor, { studentId: String(input.studentId), email: String(input.email ?? "") }));
  if (!res.ok) return res;
  await flushEffects(res.value.effects);
  refreshInvites();
  return { ok: true as const, created: res.value.created.map((c) => ({ email: c.email, token: c.token, emailed: c.emailed })) };
}

export async function inviteAllFamiliesAction() {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => inviteAllFamilies(a.actor));
  if (!res.ok) return res;
  await flushEffects(res.value.effects);
  refreshInvites();
  return { ok: true as const, count: res.value.count, skipped: res.value.skipped };
}

export async function resendInvitationAction(invitationId: string) {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => resendInvitation(a.actor, String(invitationId)));
  if (!res.ok) return res;
  await flushEffects(res.value.effects);
  refreshInvites();
  return { ok: true as const, token: res.value.token, emailed: res.value.emailed };
}

export async function revokeInvitationAction(invitationId: string) {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => revokeInvitation(a.actor, String(invitationId)));
  if (res.ok) refreshInvites();
  return res.ok ? { ok: true as const } : res;
}

export async function createStaffLinkAction(input: { roleKey: string; maxUses: number; days: number }) {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => createStaffLink(a.actor, { roleKey: String(input.roleKey), maxUses: Number(input.maxUses), days: Number(input.days) }));
  if (!res.ok) return res;
  refreshInvites();
  return { ok: true as const, token: res.value.token };
}

export async function regenerateJoinCodeAction() {
  const a = await actorWith("people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => regenerateJoinCode(a.actor));
  if (!res.ok) return res;
  refreshInvites();
  return { ok: true as const, code: res.value };
}

const settingsSchema = z.object({
  googleSignIn: z.boolean(),
  microsoftSignIn: z.boolean(),
  staffEmailDomains: z.array(z.string().max(253)).max(10),
  staffDomainAutoApprove: z.boolean(),
  parentSelfJoin: z.boolean(),
  parentJoinApproval: z.boolean(),
  studentSelfJoin: z.boolean(),
});

export async function updateJoinSettingsAction(input: z.input<typeof settingsSchema>) {
  const a = await actorWith("roles.manage");
  if (!a) return fail("FORBIDDEN");
  const d = settingsSchema.safeParse(input);
  if (!d.success) return fail("INVALID");
  const res = await run(() => updateJoinSettings(a.actor, d.data));
  if (!res.ok) return res;
  refreshInvites();
  return { ok: true as const, settings: res.value };
}

// ---------------------------------------------------------------------------
// Join requests
// ---------------------------------------------------------------------------

export async function approveJoinRequestAction(input: { requestId: string; studentIds?: string[]; roleKeys?: string[]; note?: string }) {
  const a = await actorWith("people.manage", "people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() =>
    approveJoinRequest(a.actor, { requestId: String(input.requestId), studentIds: (input.studentIds ?? []).map(String), roleKeys: (input.roleKeys ?? []).map(String), note: input.note ?? null }),
  );
  if (!res.ok) return res;
  await flushEffects(res.value.effects);
  revalidatePath("/[locale]", "layout");
  return { ok: true as const };
}

export async function rejectJoinRequestAction(input: { requestId: string; note: string }) {
  const a = await actorWith("people.manage", "people.invite");
  if (!a) return fail("FORBIDDEN");
  const res = await run(() => rejectJoinRequest(a.actor, { requestId: String(input.requestId), note: String(input.note ?? "") }));
  if (!res.ok) return res;
  await flushEffects(res.value.effects);
  revalidatePath("/[locale]", "layout");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// School switcher and first-run tips
// ---------------------------------------------------------------------------

export async function switchSchoolAction(orgId: string, locale: string) {
  const ctx = await getCtx();
  const schools = await listUserOrganizations(ctx.user.id);
  if (!schools.some((s) => s.id === orgId)) return fail("FORBIDDEN");
  await unstable_update({ activeOrgId: orgId } as never);
  redirect(`/${isLocale(locale) ? locale : "en"}/home`);
}

export async function dismissFirstRunAction() {
  const ctx = await getCtx();
  const jar = await cookies();
  const cur = (jar.get(FIRST_RUN_COOKIE)?.value ?? "").split(".").filter(Boolean);
  if (!cur.includes(ctx.membershipId)) cur.push(ctx.membershipId);
  jar.set(FIRST_RUN_COOKIE, cur.slice(-10).join("."), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/[locale]/home", "page");
  return { ok: true as const };
}
