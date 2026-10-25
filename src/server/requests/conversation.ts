// Request conversations: one thread per request that the right people can see.
//
// Visibility of each message:
// - SHARED ("Family and staff"): the requester side (the requester, guardians of the student when the service
//   is open to parents, the student when it is open to students) and every staff member who can see the request.
// - STAFF ("Staff only"): an internal note for the handling team, that is staff who can see the request except a
//   staff requester. Families never receive it.
// - PRIVATE: the author and the staff members they chose, nobody else (not even requests.view_all holders).
//
// Access always starts from requestWhere and isRestrictedForViewer (src/server/access/request-access.ts).
// Requests linked to a WELLBEING or SAFEGUARDING case also go through case-access.ts: staff need full case
// access, families are never notified automatically (rule 7; staff may record a decision to notify, with a
// reason), and every staff view of such a thread writes an AuditEvent. Notifications never carry the message
// text. Messages are not part of global search or analytics.
import type { MessageVisibility, Prisma, Sensitivity } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { tenantTx, type TenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect, type Tx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { userName } from "@/lib/i18n-data";
import { canViewCase, familyMayBeAutoNotified, SENSITIVE } from "@/server/access/case-access";
import { isRestrictedForViewer, requestWhere } from "@/server/access/request-access";
import { absencePrivacy, canSeeAbsenceReason, isMedicalAbsence, type AbsencePrivacy } from "@/server/access/absence-access";

export const MESSAGE_MAX = 4000;
export const VISIBILITIES: MessageVisibility[] = ["SHARED", "STAFF", "PRIVATE"];

export class ConversationError extends Error {}

export const CONVERSATION_TEMPLATES = [
  {
    key: "request_message",
    subject: { en: "New message from school about {{number}}", ar: "رسالة جديدة من المدرسة بشأن {{number}}" },
    body: {
      en: "{{author}} sent you a message about \"{{title}}\". Open Horizon to read it and reply.",
      ar: "أرسل {{author}} رسالة إليك بشأن \"{{title}}\". افتح هورايزن لقراءتها والرد عليها.",
    },
  },
  {
    key: "request_reply",
    subject: { en: "{{author}} replied on {{number}}", ar: "رد {{author}} على الطلب {{number}}" },
    body: {
      en: "{{author}} replied on \"{{title}}\". Open the request to read the reply.",
      ar: "رد {{author}} على \"{{title}}\". افتح الطلب لقراءة الرد.",
    },
  },
  {
    key: "request_private_note",
    subject: { en: "Private note from {{author}} on {{number}}", ar: "ملاحظة خاصة من {{author}} على الطلب {{number}}" },
    body: {
      en: "{{author}} sent you a private note on \"{{title}}\". Only you and {{author}} can read it.",
      ar: "أرسل إليك {{author}} ملاحظة خاصة على \"{{title}}\". لا يطّلع عليها غيرك وغير {{author}}.",
    },
  },
  {
    key: "request_staff_note",
    subject: { en: "Staff note from {{author}} on {{number}}", ar: "ملاحظة للموظفين من {{author}} على الطلب {{number}}" },
    body: {
      en: "{{author}} added a staff-only note on \"{{title}}\". The family cannot see it.",
      ar: "أضاف {{author}} ملاحظة للموظفين فقط على \"{{title}}\". لا تظهر للأسرة.",
    },
  },
] as const;

/** Create the conversation message templates for an organization if they are missing. Admins can edit them later. */
export async function ensureConversationTemplates(tx: Tx, orgId: string) {
  const keys = CONVERSATION_TEMPLATES.map((t) => t.key as string);
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: keys }, channel: "EMAIL" }, select: { key: true } });
  const missing = CONVERSATION_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (missing.length)
    await tx.messageTemplate.createMany({
      data: missing.map((t) => ({ orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar })),
      skipDuplicates: true,
    });
}

type Viewer = Pick<Ctx, "orgId" | "db" | "membershipId" | "isStaff" | "isStudent" | "isParent" | "can" | "membership" | "user" | "roles">;

export type ThreadAccess = {
  request: Prisma.RequestGetPayload<{ include: { service: true } }>;
  viewer: "family" | "staff";
  /** The request or its linked case is WELLBEING or SAFEGUARDING. */
  sensitive: boolean;
  /** Highest sensitivity of the request and its linked case. */
  sensitivity: Sensitivity;
  caseId: string | null;
  /** Staff only: families cannot see the request itself, so a shared message would reach nobody. */
  sharedBlocked: boolean;
  /** Who is on the requester side: a family, or a member of staff who asked for something (leave, a repair). */
  audience: "family" | "requester";
  /** The viewer asked for this request (or is family): they are on the requester side and never see staff notes. */
  requesterSide: boolean;
  /** Absence reports and leave requests carry a private reason (src/server/access/absence-access.ts). */
  privacy: AbsencePrivacy | null;
  formData: Record<string, unknown> | null;
};

/**
 * Whether the member may open the conversation of a request, and on what terms. Null when they may not:
 * the request is not visible to them, they only see that it is being handled, or the linked sensitive case is
 * closed to them.
 */
export async function threadAccess(ctx: Viewer, requestId: string): Promise<ThreadAccess | null> {
  if (!requestId) return null;
  const request = await ctx.db.request.findFirst({ where: { AND: [{ id: requestId }, requestWhere(ctx as Ctx)] }, include: { service: true } });
  if (!request) return null;
  if (isRestrictedForViewer(ctx as Ctx, request)) return null;
  let sensitivity: Sensitivity = request.sensitivity;
  let sensitive = SENSITIVE.includes(request.sensitivity);
  if (request.caseId) {
    const c = await ctx.db.case.findUnique({ where: { id: request.caseId } });
    if (c && SENSITIVE.includes(c.sensitivity)) {
      if (!ctx.isStaff) {
        // A family reaches a request linked to a sensitive case only when the request itself is open to them.
        sensitive = true;
        sensitivity = c.sensitivity;
      } else {
        if (!(await canViewCase(ctx as Ctx, c, { audit: false }))) return null;
        sensitive = true;
        sensitivity = c.sensitivity;
      }
    }
  }
  // Absence reports and leave requests: families write about illness here, so staff who may not see the
  // reason (class teachers, the principal for a sick day) do not see the conversation either.
  const privacy = absencePrivacy(request.service.key);
  let formData: Record<string, unknown> | null = null;
  if (privacy) {
    const sub = request.submissionId ? await ctx.db.submission.findUnique({ where: { id: request.submissionId }, select: { data: true } }) : null;
    formData = (sub?.data ?? null) as Record<string, unknown> | null;
    if (ctx.isStaff) {
      const approver = (await ctx.db.approvalAssignee.count({ where: { membershipId: ctx.membershipId, approval: { requestId } } })) > 0;
      if (!canSeeAbsenceReason(ctx, request, formData, { approver })) return null;
    }
  }
  const requester = await ctx.db.membership.findUnique({ where: { id: request.requesterId }, include: { roles: { include: { role: true } } } });
  const familyRequest = (requester ? isFamilyMember(requester) : false) || Boolean(request.studentId && request.service.audience.some((a) => FAMILY_ROLES.includes(a)));
  return {
    privacy,
    formData,
    request,
    viewer: ctx.isStaff ? "staff" : "family",
    sensitive,
    sensitivity,
    caseId: request.caseId,
    sharedBlocked: ctx.isStaff && SENSITIVE.includes(request.sensitivity),
    audience: familyRequest ? "family" : "requester",
    requesterSide: !ctx.isStaff || request.requesterId === ctx.membershipId,
  };
}

/**
 * Messages the member may read. Families: shared only. Staff: shared, staff-only notes on requests they did not
 * ask for themselves, and private notes they wrote or received.
 */
export function visibleMessageWhere(ctx: Pick<Ctx, "isStaff" | "membershipId">): Prisma.RequestMessageWhereInput {
  if (!ctx.isStaff) return { visibility: "SHARED" };
  const me = ctx.membershipId;
  return {
    OR: [
      { visibility: "SHARED" },
      { visibility: "STAFF", request: { requesterId: { not: me } } },
      { visibility: "PRIVATE", OR: [{ membershipId: me }, { privateToIds: { has: me } }] },
    ],
  };
}

type MemberLite = Prisma.MembershipGetPayload<{ include: { user: true; roles: { include: { role: true } }; staffProfile: true } }>;
const FAMILY_ROLES = ["parent", "student"];
const isFamilyMember = (m: { roles: Array<{ role: { key: string } }> }) => m.roles.some((r) => FAMILY_ROLES.includes(r.role.key));

export type ThreadPerson = { id: string; nameEn: string; nameAr: string; titleEn: string; titleAr: string; family: boolean };
export type ThreadMessage = { id: string; body: string; visibility: MessageVisibility; createdAt: Date; authorId: string; privateToIds: string[]; familyNotified: boolean };
export type Thread = {
  access: ThreadAccess;
  messages: ThreadMessage[];
  people: Record<string, ThreadPerson>;
  /** When the viewer last opened the thread before this view (null: never). */
  lastReadAt: Date | null;
};

function personOf(m: MemberLite): ThreadPerson {
  const family = isFamilyMember(m);
  const role = m.roles.find((r) => !["teacher"].includes(r.role.key))?.role ?? m.roles[0]?.role;
  const isParent = m.roles.some((r) => r.role.key === "parent");
  return {
    id: m.id,
    nameEn: m.user.nameEn,
    nameAr: m.user.nameAr || m.user.nameEn,
    titleEn: family ? (isParent ? "Parent" : "Student") : (m.staffProfile?.jobTitleEn ?? m.titleEn ?? role?.nameEn ?? ""),
    titleAr: family ? (isParent ? "ولي الأمر" : "طالب") : (m.staffProfile?.jobTitleAr ?? m.titleAr ?? role?.nameAr ?? ""),
    family,
  };
}

async function people(db: Viewer["db"], ids: string[]) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {} as Record<string, ThreadPerson>;
  const rows = await db.membership.findMany({ where: { id: { in: clean } }, include: { user: true, roles: { include: { role: true } }, staffProfile: true } });
  return Object.fromEntries(rows.map((m) => [m.id, personOf(m)])) as Record<string, ThreadPerson>;
}

/**
 * Load the conversation for the viewer. Records the view: the read marker moves to now, and a staff view of a
 * wellbeing or safeguarding thread writes an AuditEvent (with the number of private notes shown).
 */
export async function loadThread(ctx: Viewer, requestId: string, opts: { markRead?: boolean; now?: Date } = {}): Promise<Thread | null> {
  const access = await threadAccess(ctx, requestId);
  if (!access) return null;
  const now = opts.now ?? new Date();
  const [messages, read] = await Promise.all([
    ctx.db.requestMessage.findMany({ where: { AND: [{ requestId }, visibleMessageWhere(ctx)] }, orderBy: { createdAt: "asc" }, take: 300 }),
    ctx.db.requestThreadRead.findUnique({ where: { requestId_membershipId: { requestId, membershipId: ctx.membershipId } } }),
  ]);
  const ids = messages.flatMap((m) => [m.membershipId, ...m.privateToIds]);
  const who = await people(ctx.db, ids);
  if (ctx.isStaff && access.sensitive) {
    await ctx.db.auditEvent.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.membershipId,
        actorUserId: ctx.user.id,
        action: "request.messages.view",
        entityType: "Request",
        entityId: requestId,
        sensitivity: access.sensitivity,
        meta: { private: messages.filter((m) => m.visibility === "PRIVATE").length, total: messages.length } as never,
      },
    });
  }
  if (opts.markRead !== false) {
    await ctx.db.requestThreadRead.upsert({
      where: { requestId_membershipId: { requestId, membershipId: ctx.membershipId } },
      create: { orgId: ctx.orgId, requestId, membershipId: ctx.membershipId, lastReadAt: now },
      update: { lastReadAt: now },
    });
  }
  return {
    access,
    messages: messages.map((m) => ({ id: m.id, body: m.body, visibility: m.visibility, createdAt: m.createdAt, authorId: m.membershipId, privateToIds: m.privateToIds, familyNotified: m.familyNotified })),
    people: who,
    lastReadAt: read?.lastReadAt ?? null,
  };
}

/**
 * Staff who can see the request (the handling team): people involved in it, plus holders of the
 * permission that opens it (requests.view_all, or for sensitive matters the safeguarding or wellbeing
 * permission). Used for the private note picker and to validate its recipients.
 */
export async function handlingTeam(db: Viewer["db"] | TenantTx, access: ThreadAccess): Promise<ThreadPerson[]> {
  const q = db as TenantTx;
  const r = access.request;
  // A referrer of a wellbeing or safeguarding matter only sees that it is being handled, so is never on the team.
  const involved = new Set<string>([...(access.sensitive ? [] : [r.requesterId]), ...(r.assigneeId ? [r.assigneeId] : [])]);
  const [approvers, theCase] = await Promise.all([
    q.approvalAssignee.findMany({ where: { approval: { requestId: r.id } }, select: { membershipId: true } }),
    r.caseId ? q.case.findUnique({ where: { id: r.caseId }, select: { assigneeId: true, sensitivity: true, participants: { where: { role: { in: ["ASSIGNEE", "TEAM"] } }, select: { membershipId: true } } } }) : null,
  ]);
  for (const a of approvers) if (a.membershipId) involved.add(a.membershipId);
  if (theCase?.assigneeId) involved.add(theCase.assigneeId);
  for (const p of theCase?.participants ?? []) if (p.membershipId) involved.add(p.membershipId);
  const sens = access.sensitivity;
  const perm = sens === "SAFEGUARDING" ? "safeguarding.view" : sens === "WELLBEING" ? "cases.wellbeing" : "requests.view_all";
  const privacy = access.privacy;
  const reasonPerms = privacy ? (privacy.subject === "student" ? ["attendance.reasons", "people.medical"] : ["absence.reasons"]) : [];
  const rows = await q.membership.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ id: { in: [...involved] } }, ...[perm, ...reasonPerms].map((p) => ({ roles: { some: { role: { permissions: { has: p } } } } }))],
    },
    include: { user: true, roles: { include: { role: true } }, staffProfile: true },
    orderBy: { user: { nameEn: "asc" } },
  });
  const approverIds = new Set(approvers.map((a) => a.membershipId).filter(Boolean) as string[]);
  const medical = privacy ? isMedicalAbsence(r.service.key, access.formData) : false;
  return rows
    .filter((m) => !isFamilyMember(m))
    .filter((m) => {
      // Absence reports: only people who may read the reason can be on the conversation.
      if (!privacy) return true;
      const perms = new Set(m.roles.flatMap((x) => x.role.permissions));
      if (m.id === r.requesterId) return true;
      if (reasonPerms.some((p) => perms.has(p))) return true;
      return approverIds.has(m.id) && !medical;
    })
    .map(personOf);
}

/** The requester side: the requester, and the student's guardians when the service is open to parents. */
async function requesterSideRecipients(tx: TenantTx, orgId: string, access: ThreadAccess): Promise<string[]> {
  const r = access.request;
  const ids = new Set<string>();
  const requester = await tx.membership.findFirst({ where: { orgId, id: r.requesterId, status: "ACTIVE" }, select: { id: true } });
  if (requester) ids.add(requester.id);
  if (r.studentId && r.service.audience.includes("parent")) {
    const links = await tx.guardianLink.findMany({ where: { orgId, studentId: r.studentId }, include: { guardian: { select: { membershipId: true } } } });
    for (const l of links) if (l.guardian.membershipId) ids.add(l.guardian.membershipId);
  }
  return [...ids];
}

/** Staff to tell about a family reply: the assignee, staff who already wrote in the thread and pending approvers; otherwise the office team. */
async function staffWatchers(tx: TenantTx, orgId: string, access: ThreadAccess, authorId: string): Promise<string[]> {
  const r = access.request;
  const ids = new Set<string>();
  if (r.assigneeId) ids.add(r.assigneeId);
  const [authors, approvers] = await Promise.all([
    tx.requestMessage.findMany({ where: { orgId, requestId: r.id }, select: { membershipId: true }, distinct: ["membershipId"] }),
    tx.approvalAssignee.findMany({ where: { orgId, status: "PENDING", approval: { requestId: r.id, status: "PENDING" } }, select: { membershipId: true } }),
  ]);
  for (const a of [...authors.map((x) => x.membershipId), ...approvers.map((x) => x.membershipId)]) if (a) ids.add(a);
  ids.delete(authorId);
  const staff = ids.size
    ? await tx.membership.findMany({ where: { orgId, id: { in: [...ids] }, status: "ACTIVE" }, include: { roles: { include: { role: true } } } })
    : [];
  const out = staff.filter((m) => !isFamilyMember(m)).map((m) => m.id);
  if (out.length) return out;
  // Nobody has picked it up yet: the office team that processes requests.
  const office = await tx.membership.findMany({
    where: { orgId, status: "ACTIVE", AND: [{ roles: { some: { role: { permissions: { has: "requests.process" } } } } }, { roles: { some: { role: { permissions: { has: "requests.view_all" } } } } }] },
    select: { id: true },
  });
  return office.map((m) => m.id).filter((id) => id !== authorId);
}

export type PostInput = {
  requestId: string;
  body: string;
  visibility: MessageVisibility;
  privateToIds?: string[];
  /** Sensitive threads only: staff decided to notify the family, with this reason. */
  notifyFamily?: boolean;
  notifyReason?: string;
};

export type PostResult = { id: string; visibility: MessageVisibility; notified: number };

/**
 * Post a message. Families may only post shared messages. Staff may post any visibility; private notes need at
 * least one recipient from the handling team. Side effects (email, push) go into `effects` with idempotency keys.
 */
export async function postMessage(ctx: Viewer, input: PostInput, opts: { effects: Effect[]; now?: Date; quiet?: boolean }): Promise<PostResult> {
  const access = await threadAccess(ctx, input.requestId);
  if (!access) throw new ConversationError("NOT_FOUND");
  const body = (input.body ?? "").trim();
  if (!body) throw new ConversationError("EMPTY");
  if (body.length > MESSAGE_MAX) throw new ConversationError("TOO_LONG");
  if (!VISIBILITIES.includes(input.visibility)) throw new ConversationError("INVALID");
  if (!ctx.isStaff && input.visibility !== "SHARED") throw new ConversationError("FORBIDDEN");
  const visibility = input.visibility;
  if (visibility === "SHARED" && access.sharedBlocked) throw new ConversationError("PROTECTED");
  // A staff requester (for example someone asking for leave) talks to the team; staff notes are not theirs to write.
  if (visibility === "STAFF" && access.requesterSide) throw new ConversationError("FORBIDDEN");

  let privateTo: string[] = [];
  if (visibility === "PRIVATE") {
    privateTo = [...new Set((input.privateToIds ?? []).filter((id) => id && id !== ctx.membershipId))];
    if (!privateTo.length) throw new ConversationError("RECIPIENTS_REQUIRED");
    const team = new Set((await handlingTeam(ctx.db, access)).map((p) => p.id));
    if (privateTo.some((id) => !team.has(id))) throw new ConversationError("RECIPIENT_NOT_ALLOWED");
  }
  // Rule 7: on wellbeing and safeguarding matters the family is told only by a recorded staff decision.
  const decided = ctx.isStaff && !access.requesterSide && visibility === "SHARED" && access.sensitive && Boolean(input.notifyFamily);
  const reason = (input.notifyReason ?? "").trim();
  if (decided && reason.length < 5) throw new ConversationError("REASON_REQUIRED");

  const now = opts.now ?? new Date();
  const r = access.request;
  const authorName = { en: ctx.user.nameEn, ar: ctx.user.nameAr || ctx.user.nameEn };
  const vars = { number: r.number, title: { en: r.titleEn, ar: r.titleAr }, author: authorName };
  const href = `/requests/${r.id}#conversation`;

  return tenantTx(
    ctx.orgId,
    async (tx) => {
      await ensureConversationTemplates(tx, ctx.orgId);
      const msg = await tx.requestMessage.create({
        data: { orgId: ctx.orgId, requestId: r.id, membershipId: ctx.membershipId, visibility, privateToIds: privateTo, body, familyNotified: decided, createdAt: now },
      });
      await tx.auditEvent.create({
        data: {
          orgId: ctx.orgId,
          actorId: ctx.membershipId,
          actorUserId: ctx.user.id,
          action: "request.message.create",
          entityType: "Request",
          entityId: r.id,
          sensitivity: access.sensitivity,
          meta: { messageId: msg.id, visibility, recipients: privateTo.length } as never,
          createdAt: now,
        },
      });
      await tx.requestThreadRead.upsert({
        where: { requestId_membershipId: { requestId: r.id, membershipId: ctx.membershipId } },
        create: { orgId: ctx.orgId, requestId: r.id, membershipId: ctx.membershipId, lastReadAt: now },
        update: { lastReadAt: now },
      });
      const ec = execCtx(tx, ctx.orgId, { effects: opts.effects, actorId: ctx.membershipId, now, quiet: opts.quiet });
      let recipients: string[] = [];
      let templateKey = "";
      if (visibility === "SHARED" && !access.requesterSide) {
        const family = await requesterSideRecipients(tx, ctx.orgId, access);
        if (decided) {
          if (access.caseId) {
            const guardians = r.studentId ? await tx.guardianLink.findMany({ where: { orgId: ctx.orgId, studentId: r.studentId }, select: { guardianId: true } }) : [];
            await tx.parentNotificationDecision.create({ data: { orgId: ctx.orgId, caseId: access.caseId, decision: "NOTIFY", reason, guardianIds: guardians.map((g) => g.guardianId), decidedById: ctx.membershipId, createdAt: now } });
          }
          await tx.auditEvent.create({
            data: { orgId: ctx.orgId, actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "request.family_notify", entityType: "Request", entityId: r.id, sensitivity: access.sensitivity, reason, meta: { messageId: msg.id } as never, createdAt: now },
          });
        }
        if (familyMayBeAutoNotified(access.sensitivity) || decided) recipients = family;
        templateKey = "request_message";
      } else if (visibility === "SHARED") {
        recipients = await staffWatchers(tx, ctx.orgId, access, ctx.membershipId);
        templateKey = "request_reply";
      } else if (visibility === "PRIVATE") {
        recipients = privateTo;
        templateKey = "request_private_note";
      } else {
        recipients = r.assigneeId && r.assigneeId !== ctx.membershipId ? [r.assigneeId] : [];
        templateKey = "request_staff_note";
      }
      recipients = recipients.filter((id) => id !== ctx.membershipId);
      if (recipients.length) {
        await notify(ec, {
          recipients,
          templateKey,
          kind: "request_message",
          vars,
          href,
          sensitivity: access.sensitivity,
          channels: ["IN_APP", "EMAIL"],
          idempotencyBase: `reqmsg:${msg.id}`,
        });
      }
      return { id: msg.id, visibility, notified: recipients.length };
    },
    { timeout: 30000 },
  );
}

/**
 * Unread messages per request for the viewer: visible messages by someone else since the viewer last opened
 * the thread. Threads the viewer may not open (a sensitive case closed to them) never count.
 */
export async function unreadByRequest(
  ctx: Viewer,
  rows: Array<{ id: string; caseId: string | null; sensitivity: string; requesterId: string; assigneeId: string | null; service?: { key: string } }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const open = rows.filter((r) => !isRestrictedForViewer(ctx as Ctx, r));
  const requestIds = open.map((r) => r.id);
  if (!requestIds.length) return out;
  const [reads, msgs] = await Promise.all([
    ctx.db.requestThreadRead.findMany({ where: { membershipId: ctx.membershipId, requestId: { in: requestIds } }, select: { requestId: true, lastReadAt: true } }),
    ctx.db.requestMessage.findMany({
      where: { AND: [{ requestId: { in: requestIds } }, { membershipId: { not: ctx.membershipId } }, visibleMessageWhere(ctx)] },
      select: { requestId: true, createdAt: true },
    }),
  ]);
  const since = new Map(reads.map((r) => [r.requestId, r.lastReadAt.getTime()]));
  for (const m of msgs) if (m.createdAt.getTime() > (since.get(m.requestId) ?? 0)) out.set(m.requestId, (out.get(m.requestId) ?? 0) + 1);
  // Requests linked to a case (a sensitive case may be closed to the viewer) and absence reports (the reason may
  // be private to them): the full access check decides.
  for (const r of open) {
    if (!out.has(r.id)) continue;
    const needsCheck = Boolean(r.caseId) || !r.service || Boolean(absencePrivacy(r.service.key));
    if (needsCheck && !(await threadAccess(ctx, r.id))) out.delete(r.id);
  }
  return out;
}

/** Display name helper for the UI. */
export const personLabel = (p: ThreadPerson | undefined, locale: string) => (p ? userName({ nameEn: p.nameEn, nameAr: p.nameAr }, locale) : "");
