import { rawPrisma, type TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { AegisError, forbidden } from "../lib/errors.js";

/**
 * SCIM 2.0 provisioning (RFC 7643, 7644), the subset identity providers such as Microsoft Entra ID and
 * Okta use: Users (list with `userName eq`, get, create, replace, patch `active`, delete) and Groups
 * mapped to AEGIS roles (list, get, patch members). Callers are integration API keys with the
 * `scim:provision` scope.
 *
 * Safety rules: a provisioned user joins with the viewer role; groups can assign any role except
 * owner and admin, which only a person in the console can grant; deleting a user suspends the
 * membership (evidence and approvals keep their author) and never deletes the global account; an
 * account that already exists is never linked by provisioning (claimed email domains are not proof of
 * ownership); it joins only by accepting an invitation, so provisioning cannot pull in another person's account.
 */
export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PROTECTED_ROLES = new Set(["owner", "admin"]);

export class ScimError extends AegisError {
  constructor(
    readonly scimStatus: number,
    readonly scimType: string | null,
    message: string,
  ) {
    super(scimStatus === 404 ? "not_found" : scimStatus === 409 ? "conflict" : scimStatus === 403 ? "forbidden" : "validation", message);
  }
}

function assertScim(ctx: OrgContext) {
  if (ctx.actor.type !== "integration" && ctx.actor.type !== "system") throw forbidden("SCIM is for provisioning keys");
}

const userInput = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().email().max(254),
  name: z.object({ givenName: z.string().max(100).optional(), familyName: z.string().max(100).optional(), formatted: z.string().max(200).optional() }).partial().optional(),
  displayName: z.string().max(200).optional(),
  active: z.boolean().default(true),
  externalId: z.string().max(200).optional(),
});

type Member = { id: string; userId: string; status: string; role: { key: string } };
function toScimUser(m: Member, u: { id: string; email: string; name: string }, base: string) {
  return { schemas: [SCIM_USER_SCHEMA], id: m.userId, userName: u.email, displayName: u.name, name: { formatted: u.name }, emails: [{ value: u.email, primary: true }], active: m.status === "active", groups: [{ value: m.role.key, display: m.role.key }], meta: { resourceType: "User", location: `${base}/Users/${m.userId}` } };
}

export async function scimListUsers(db: TenantDb, ctx: OrgContext, q: { filter?: string; startIndex?: number; count?: number }, base: string) {
  assertScim(ctx);
  let emailEq: string | null = null;
  if (q.filter) {
    const m = /^userName eq "([^"]+)"$/i.exec(q.filter.trim());
    if (!m) throw new ScimError(400, "invalidFilter", "Only userName eq \"...\" filters are supported");
    emailEq = m[1]!.toLowerCase();
  }
  const members = await db.membership.findMany({ where: { orgId: ctx.orgId }, include: { role: true }, orderBy: { createdAt: "asc" } });
  const users = await db.user.findMany({ where: { id: { in: members.map((m) => m.userId) }, ...(emailEq ? { email: emailEq } : {}) }, select: { id: true, email: true, name: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  const all = members.filter((m) => byId.has(m.userId));
  const start = Math.max(1, q.startIndex ?? 1);
  const count = Math.min(200, Math.max(0, q.count ?? 100));
  const page = all.slice(start - 1, start - 1 + count);
  return { schemas: [SCIM_LIST_SCHEMA], totalResults: all.length, startIndex: start, itemsPerPage: page.length, Resources: page.map((m) => toScimUser(m, byId.get(m.userId)!, base)) };
}

async function memberFor(db: TenantDb, ctx: OrgContext, userId: string) {
  const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId } }, include: { role: true } });
  if (!m) throw new ScimError(404, null, "User not found");
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
  if (!u) throw new ScimError(404, null, "User not found");
  return { m, u };
}

export async function scimGetUser(db: TenantDb, ctx: OrgContext, userId: string, base: string) {
  assertScim(ctx);
  const { m, u } = await memberFor(db, ctx, userId);
  return toScimUser(m, u, base);
}

export async function scimCreateUser(db: TenantDb, ctx: OrgContext, body: unknown, base: string) {
  assertScim(ctx);
  const input = userInput.parse(body);
  const email = input.userName.toLowerCase();
  const name = input.displayName ?? input.name?.formatted ?? ([input.name?.givenName, input.name?.familyName].filter(Boolean).join(" ") || email);
  const found = await rawPrisma().user.findUnique({ where: { email } });
  if (found) {
    const existing = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: found.id } } });
    if (existing) throw new ScimError(409, "uniqueness", "User already exists in this organization");
    // Claimed email domains are not proof of ownership, so an existing account (which may belong to another
    // organization) is never attached by provisioning. It joins only by accepting an invitation, signed in as itself.
    throw new ScimError(409, "uniqueness", "An account with this email already exists; invite it from the console so its owner accepts");
  }
  const user = await rawPrisma().user.create({ data: { email, name, passwordHash: null } });
  const viewer = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId: ctx.orgId, key: "viewer" } } });
  const m = await db.membership.create({ data: { orgId: ctx.orgId, userId: user.id, roleId: viewer.id, status: input.active ? "active" : "suspended" }, include: { role: true } });
  await appendEvidence(db, ctx, { type: "scim.user_provisioned", subjectType: "membership", subjectId: m.id, payload: { userId: user.id, role: "viewer", active: input.active, externalId: input.externalId ?? null } });
  return toScimUser(m, user, base);
}

/** Replace: only displayName and active are taken; email changes are not accepted over SCIM. */
export async function scimReplaceUser(db: TenantDb, ctx: OrgContext, userId: string, body: unknown, base: string) {
  assertScim(ctx);
  const input = userInput.parse(body);
  const { m, u } = await memberFor(db, ctx, userId);
  if (input.userName.toLowerCase() !== u.email) throw new ScimError(400, "mutability", "userName cannot be changed over SCIM");
  return setActive(db, ctx, m, u, input.active, base);
}

export async function scimPatchUser(db: TenantDb, ctx: OrgContext, userId: string, body: unknown, base: string) {
  assertScim(ctx);
  const ops = z.object({ Operations: z.array(z.object({ op: z.string(), path: z.string().optional(), value: z.unknown() })).min(1) }).parse(body).Operations;
  const { m, u } = await memberFor(db, ctx, userId);
  let active = m.status === "active";
  for (const op of ops) {
    const kind = op.op.toLowerCase();
    if (kind !== "replace" && kind !== "add") throw new ScimError(400, "invalidSyntax", `Unsupported operation ${op.op}`);
    if (op.path === "active") active = op.value === true || op.value === "True" || op.value === "true";
    else if (!op.path && op.value && typeof op.value === "object" && "active" in (op.value as object)) active = (op.value as { active: unknown }).active === true;
    else if (op.path && op.path !== "displayName" && op.path !== "name.formatted") throw new ScimError(400, "mutability", `Attribute ${op.path} cannot be changed over SCIM`);
  }
  return setActive(db, ctx, m, u, active, base);
}

async function setActive(db: TenantDb, ctx: OrgContext, m: Member, u: { id: string; email: string; name: string }, active: boolean, base: string) {
  const status = active ? "active" : "suspended";
  if (m.status !== status) {
    if (!active && m.role.key === "owner") {
      const owners = await db.membership.count({ where: { orgId: ctx.orgId, status: "active", role: { key: "owner" } } });
      if (owners <= 1) throw new ScimError(400, "mutability", "The last owner cannot be deactivated");
    }
    await db.membership.update({ where: { id: m.id }, data: { status } });
    if (!active) await rawPrisma().session.updateMany({ where: { userId: u.id, activeOrgId: ctx.orgId, revokedAt: null }, data: { revokedAt: new Date() } });
    await appendEvidence(db, ctx, { type: `scim.user_${active ? "activated" : "deactivated"}`, subjectType: "membership", subjectId: m.id, payload: { userId: u.id } });
  }
  return toScimUser({ ...m, status }, u, base);
}

/** Deprovisioning suspends the membership; the account and its history stay. */
export async function scimDeleteUser(db: TenantDb, ctx: OrgContext, userId: string, base: string) {
  assertScim(ctx);
  const { m, u } = await memberFor(db, ctx, userId);
  await setActive(db, ctx, m, u, false, base);
}

export async function scimListGroups(db: TenantDb, ctx: OrgContext, base: string) {
  assertScim(ctx);
  const roles = await db.role.findMany({ where: { orgId: ctx.orgId }, orderBy: { key: "asc" } });
  const members = await db.membership.findMany({ where: { orgId: ctx.orgId, status: "active" }, select: { userId: true, roleId: true } });
  const resources = roles.map((r) => ({ schemas: [SCIM_GROUP_SCHEMA], id: r.key, displayName: r.name, members: members.filter((m) => m.roleId === r.id).map((m) => ({ value: m.userId })), meta: { resourceType: "Group", location: `${base}/Groups/${r.key}` } }));
  return { schemas: [SCIM_LIST_SCHEMA], totalResults: resources.length, startIndex: 1, itemsPerPage: resources.length, Resources: resources };
}

/** Adding a member to a group sets that member's role. Owner and admin cannot be assigned this way. */
export async function scimPatchGroup(db: TenantDb, ctx: OrgContext, roleKey: string, body: unknown) {
  assertScim(ctx);
  const role = await db.role.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: roleKey } } });
  if (!role) throw new ScimError(404, null, "Group not found");
  if (PROTECTED_ROLES.has(role.key)) throw new ScimError(403, null, `The ${role.name} role is assigned only in the console`);
  const ops = z.object({ Operations: z.array(z.object({ op: z.string(), path: z.string().optional(), value: z.unknown() })).min(1) }).parse(body).Operations;
  const viewer = await db.role.findUniqueOrThrow({ where: { orgId_key: { orgId: ctx.orgId, key: "viewer" } } });
  for (const op of ops) {
    const kind = op.op.toLowerCase();
    const ids = Array.isArray(op.value) ? (op.value as { value?: string }[]).map((v) => v.value).filter((x): x is string => !!x) : [];
    const pathMember = /^members\[value eq "([^"]+)"\]$/.exec(op.path ?? "");
    if (kind === "add" && (op.path === "members" || !op.path)) {
      for (const userId of ids) {
        const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId } }, include: { role: true } });
        if (!m) throw new ScimError(404, null, `User ${userId} not found`);
        if (PROTECTED_ROLES.has(m.role.key)) throw new ScimError(403, null, "An owner or administrator's role is changed only in the console");
        await db.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
        await appendEvidence(db, ctx, { type: "scim.role_assigned", subjectType: "membership", subjectId: m.id, payload: { from: m.role.key, to: role.key } });
      }
    } else if (kind === "remove" && (pathMember || op.path === "members")) {
      const targets = pathMember ? [pathMember[1]!] : ids;
      for (const userId of targets) {
        const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId } } });
        if (m && m.roleId === role.id) {
          await db.membership.update({ where: { id: m.id }, data: { roleId: viewer.id } });
          await appendEvidence(db, ctx, { type: "scim.role_assigned", subjectType: "membership", subjectId: m.id, payload: { from: role.key, to: "viewer" } });
        }
      }
    } else throw new ScimError(400, "invalidSyntax", `Unsupported group operation ${op.op} ${op.path ?? ""}`);
  }
  return { ok: true };
}

export function scimError(e: unknown): { status: number; body: Record<string, unknown> } {
  if (e instanceof ScimError) return { status: e.scimStatus, body: { schemas: [SCIM_ERROR_SCHEMA], status: String(e.scimStatus), ...(e.scimType ? { scimType: e.scimType } : {}), detail: e.message } };
  if (e instanceof z.ZodError) return { status: 400, body: { schemas: [SCIM_ERROR_SCHEMA], status: "400", scimType: "invalidValue", detail: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } };
  if (e instanceof AegisError) {
    const status = e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : e.code === "unauthorized" ? 401 : 400;
    return { status, body: { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail: e.message } };
  }
  return { status: 500, body: { schemas: [SCIM_ERROR_SCHEMA], status: "500", detail: "Internal error" } };
}

