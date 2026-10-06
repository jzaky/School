"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, unstable_update } from "@/auth";
import { isLocale } from "@/i18n/routing";
import { requirePermission } from "@/server/context";
import { listUserOrganizations } from "@/server/identity/session-org";
import { rateLimit } from "@/server/platform/rate-limit";
import { putObject } from "@/server/documents/storage";
import { GroupAccessError, platformAdminById } from "./access";
import { createGroupInvite, revokeGroupInvite } from "./invites";
import { listPushItems, pushTemplate, PushError, PUSH_KINDS, type PushKind, type PushItem, type PushResult } from "./push";
import { GroupPlatformError, assignSchool, createGroup, previewGroupInvite, redeemGroupInvite, removeGroupMember, removeSchoolFromGroup, setGroupLogo, setGroupMember, updateGroup } from "./platform";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

async function sessionUserId(): Promise<string | null> {
  const s = await auth();
  return s?.user?.id || null;
}

function errorCode(e: unknown): string {
  if (e instanceof GroupAccessError) return "forbidden";
  if (e instanceof PushError) return e.code;
  if (e instanceof GroupPlatformError) return e.code;
  return "failed";
}

const refresh = () => revalidatePath("/[locale]/group", "layout");

// ---------------------------------------------------------------------------
// Group admins
// ---------------------------------------------------------------------------

export async function createInviteAction(groupId: string): Promise<{ ok: true; code: string; expiresAt: string } | Fail> {
  const userId = await sessionUserId();
  if (!userId) return fail("forbidden");
  try {
    const inv = await createGroupInvite(userId, String(groupId));
    refresh();
    return { ok: true, code: inv.code, expiresAt: inv.expiresAt.toISOString() };
  } catch (e) {
    return fail(errorCode(e));
  }
}

export async function revokeInviteAction(groupId: string, inviteId: string): Promise<{ ok: true } | Fail> {
  const userId = await sessionUserId();
  if (!userId) return fail("forbidden");
  try {
    const done = await revokeGroupInvite(userId, String(groupId), String(inviteId));
    refresh();
    return done ? { ok: true } : fail("not_found");
  } catch (e) {
    return fail(errorCode(e));
  }
}

export async function listPushItemsAction(groupId: string, sourceOrgId: string, kind: string): Promise<{ ok: true; items: PushItem[] } | Fail> {
  const userId = await sessionUserId();
  if (!userId) return fail("forbidden");
  if (!PUSH_KINDS.includes(kind as PushKind)) return fail("invalid");
  try {
    return { ok: true, items: await listPushItems(userId, String(groupId), String(sourceOrgId), kind as PushKind) };
  } catch (e) {
    return fail(errorCode(e));
  }
}

export async function pushTemplateAction(input: { groupId: string; sourceOrgId: string; kind: string; sourceId: string; targetOrgIds: string[]; mode?: string }): Promise<{ ok: true; results: PushResult[] } | Fail> {
  const userId = await sessionUserId();
  if (!userId) return fail("forbidden");
  if (!PUSH_KINDS.includes(input.kind as PushKind) || !Array.isArray(input.targetOrgIds)) return fail("invalid");
  try {
    const res = await pushTemplate({
      userId,
      groupId: String(input.groupId),
      sourceOrgId: String(input.sourceOrgId),
      kind: input.kind as PushKind,
      sourceId: String(input.sourceId),
      targetOrgIds: input.targetOrgIds.map(String),
      mode: input.mode === "replace" ? "replace" : "copy",
    });
    refresh();
    return { ok: true, results: res.results };
  } catch (e) {
    return fail(errorCode(e));
  }
}

/** Jump into a member school. Only works when the person also holds an ACTIVE membership there. */
export async function openSchoolAction(orgId: string, locale: string): Promise<Fail | void> {
  const userId = await sessionUserId();
  if (!userId) return fail("forbidden");
  const schools = await listUserOrganizations(userId);
  if (!schools.some((s) => s.id === orgId)) return fail("no_membership");
  await unstable_update({ activeOrgId: orgId } as never);
  redirect(`/${isLocale(locale) ? locale : "en"}/home`);
}

// ---------------------------------------------------------------------------
// School side: accept a group's invite code (school.manage)
// ---------------------------------------------------------------------------

export async function previewGroupCodeAction(code: string): Promise<{ ok: true; nameEn: string; nameAr: string } | Fail> {
  const ctx = await requirePermission("school.manage").catch(() => null);
  if (!ctx) return fail("forbidden");
  const limit = await rateLimit(`group-code:${ctx.orgId}`, 20, 60 * 60_000);
  if (!limit.ok) return fail("rate_limited");
  try {
    const p = await previewGroupInvite(String(code ?? ""));
    return { ok: true, nameEn: p.nameEn, nameAr: p.nameAr };
  } catch (e) {
    return fail(errorCode(e));
  }
}

export async function joinGroupAction(code: string): Promise<{ ok: true } | Fail> {
  const ctx = await requirePermission("school.manage").catch(() => null);
  if (!ctx) return fail("forbidden");
  const limit = await rateLimit(`group-code:${ctx.orgId}`, 20, 60 * 60_000);
  if (!limit.ok) return fail("rate_limited");
  try {
    await redeemGroupInvite({ code: String(code ?? ""), orgId: ctx.orgId, actorUserId: ctx.user.id, actorMembershipId: ctx.membershipId });
    revalidatePath("/[locale]", "layout");
    return { ok: true };
  } catch (e) {
    return fail(errorCode(e));
  }
}

// ---------------------------------------------------------------------------
// Platform admin
// ---------------------------------------------------------------------------

async function platformUser(): Promise<string | null> {
  const userId = await sessionUserId();
  if (!userId || !(await platformAdminById(userId))) return null;
  return userId;
}

async function platformRun<T>(fn: (userId: string) => Promise<T>): Promise<{ ok: true } | Fail> {
  const userId = await platformUser();
  if (!userId) return fail("forbidden");
  try {
    await fn(userId);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(errorCode(e));
  }
}

export async function createGroupAction(input: { nameEn: string; nameAr: string }) {
  return platformRun((userId) => createGroup({ nameEn: input.nameEn, nameAr: input.nameAr, actorUserId: userId }));
}

export async function updateGroupAction(input: { groupId: string; nameEn: string; nameAr: string }) {
  return platformRun(() => updateGroup({ groupId: String(input.groupId), nameEn: input.nameEn, nameAr: input.nameAr }));
}

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function uploadGroupLogoAction(form: FormData) {
  return platformRun(async () => {
    const groupId = String(form.get("groupId") ?? "");
    const file = form.get("file");
    if (!groupId) throw new GroupPlatformError("invalid");
    if (form.get("remove") === "1") return setGroupLogo(groupId, null);
    if (!(file instanceof File) || !LOGO_TYPES[file.type] || file.size === 0 || file.size > 512 * 1024) throw new GroupPlatformError("invalid");
    const key = await putObject(`groups/${groupId}`, `logo.${LOGO_TYPES[file.type]}`, Buffer.from(await file.arrayBuffer()), file.type);
    return setGroupLogo(groupId, key);
  });
}

export async function assignSchoolAction(input: { groupId: string; orgId: string }) {
  return platformRun((userId) => assignSchool({ groupId: String(input.groupId), orgId: String(input.orgId), actorUserId: userId }));
}

export async function removeSchoolAction(input: { groupId: string; orgId: string }) {
  return platformRun((userId) => removeSchoolFromGroup({ groupId: String(input.groupId), orgId: String(input.orgId), actorUserId: userId }));
}

export async function setMemberAction(input: { groupId: string; email: string; role: string; titleEn?: string; titleAr?: string }) {
  return platformRun(() => setGroupMember({ groupId: String(input.groupId), email: String(input.email ?? ""), role: input.role === "ADMIN" ? "ADMIN" : "VIEWER", titleEn: input.titleEn, titleAr: input.titleAr }));
}

export async function removeMemberAction(input: { groupId: string; memberId: string }) {
  return platformRun(() => removeGroupMember({ groupId: String(input.groupId), memberId: String(input.memberId) }));
}
