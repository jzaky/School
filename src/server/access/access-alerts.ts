// Safeguarding access alerts. When a role or a person gains or loses access to safeguarding or wellbeing
// records (SAFEGUARDING_WATCHED), everyone who manages safeguarding is told, in the app and by email.
// If the person who made the change is the only one who manages safeguarding, the principal is told instead.
// The message says who changed what. It never contains case details. One alert per change: the
// idempotency key is the change id recorded in the audit event.
import type { Tx, ExecCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { fmtDate } from "@/lib/format";
import { SAFEGUARDING_WATCHED } from "./permission-catalog";
import { accessOf, roleWatchedDelta, watchedDeltas, type AccessSnapshot } from "./guardrails";
import { activeAssignmentWhere } from "./until";

export const ACCESS_ALERT_TEMPLATE = "safeguarding_access_changed";

type Bi = { en: string; ar: string };

export const ACCESS_ALERT_TEMPLATE_SEED = {
  key: ACCESS_ALERT_TEMPLATE,
  subject: { en: "Safeguarding access changed by {{who}}", ar: "تغيير في صلاحيات الحماية بواسطة {{who}}" },
  body: {
    en: "{{changes}}\n\nThis change to who can see safeguarding or wellbeing records was made by {{who}}. Open the access report in Horizon to review it. This message never includes case details.",
    ar: "{{changes}}\n\nأجرى {{who}} هذا التغيير على من يمكنه الاطلاع على سجلات الحماية أو الرفاه. افتح تقرير الصلاحيات في هورايزن لمراجعته. لا تتضمن هذه الرسالة أي تفاصيل عن الحالات.",
  },
};

/** Creates the template for schools that do not have it yet, so admins can edit it before it is first used. */
export async function ensureAccessAlertTemplate(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findFirst({ where: { orgId, key: ACCESS_ALERT_TEMPLATE, channel: "EMAIL" }, select: { id: true } });
  if (have) return;
  const t = ACCESS_ALERT_TEMPLATE_SEED;
  await tx.messageTemplate.createMany({
    data: [{ orgId, key: t.key, channel: "EMAIL", subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar }],
    skipDuplicates: true,
  });
}

/** Plain-language names for the watched permissions, used inside alert sentences. */
const LABELS: Record<string, Bi> = {
  "safeguarding.view": { en: "see safeguarding cases", ar: "الاطلاع على ملفات الحماية" },
  "safeguarding.manage": { en: "manage safeguarding cases", ar: "إدارة ملفات الحماية" },
  "safeguarding.export": { en: "export safeguarding records", ar: "تصدير سجلات الحماية" },
  "safeguarding.break_glass": { en: "use emergency access to restricted cases", ar: "استخدام الوصول الطارئ إلى الملفات المقيّدة" },
  "cases.wellbeing": { en: "see wellbeing cases", ar: "الاطلاع على حالات الرفاه" },
};

const list = (perms: string[], locale: "en" | "ar") => perms.map((p) => LABELS[p]?.[locale] ?? p).join(locale === "ar" ? "، " : ", ");
const day = (ms: number, locale: "en" | "ar") => fmtDate({ locale }, new Date(ms), "medium");

export const SYSTEM_ACTOR: Bi = { en: "Horizon (automatic end date)", ar: "هورايزن (انتهاء تلقائي للمدة)" };

export type RoleChange = { name: Bi; before: string[]; after: string[]; holders: number; deleted?: boolean };

export type AlertInput = {
  /** Membership that made the change (null for the daily expiry job). */
  actorId: string | null;
  who: Bi;
  before: AccessSnapshot;
  after: AccessSnapshot;
  /** People whose access may have changed. */
  memberIds: string[];
  /** Look at the "before" picture at this moment (an assignment that has just expired). Defaults to now. */
  beforeAt?: Date;
  roles?: RoleChange[];
  changeId: string;
};

/** The sentences for one change, in both languages. Exported for unit tests. */
export function describeAccessChange(
  deltas: ReturnType<typeof watchedDeltas>,
  names: Map<string, Bi>,
  after: AccessSnapshot,
  roles: RoleChange[],
  now: Date,
): Bi {
  const en: string[] = [];
  const ar: string[] = [];
  for (const r of roles) {
    const d = roleWatchedDelta(r.before, r.after, SAFEGUARDING_WATCHED);
    if (r.deleted && d.lost.length) {
      en.push(`The role ${r.name.en} was deleted. It gave: ${list(d.lost, "en")}.`);
      ar.push(`حُذف الدور «${r.name.ar}» وكان يمنح: ${list(d.lost, "ar")}.`);
      continue;
    }
    if (d.gained.length) {
      en.push(`The role ${r.name.en} now gives: ${list(d.gained, "en")} (people with this role: ${r.holders}).`);
      ar.push(`أصبح الدور «${r.name.ar}» يمنح: ${list(d.gained, "ar")} (عدد من يحمل هذا الدور: ${r.holders}).`);
    }
    if (d.lost.length) {
      en.push(`The role ${r.name.en} no longer gives: ${list(d.lost, "en")} (people with this role: ${r.holders}).`);
      ar.push(`لم يعد الدور «${r.name.ar}» يمنح: ${list(d.lost, "ar")} (عدد من يحمل هذا الدور: ${r.holders}).`);
    }
  }
  for (const d of deltas) {
    const n = names.get(d.membershipId) ?? { en: "A staff member", ar: "أحد الموظفين" };
    const until = (perms: string[]) => {
      const a = accessOf(after, d.membershipId, now);
      const ends = perms.map((p) => a.get(p) ?? Number.POSITIVE_INFINITY);
      const last = Math.max(...ends);
      return Number.isFinite(last) ? last : null;
    };
    if (d.gained.length) {
      const u = until(d.gained);
      en.push(`New access for ${n.en}: ${list(d.gained, "en")}${u ? ` (until ${day(u, "en")})` : ""}.`);
      ar.push(`صلاحيات جديدة لـ ${n.ar}: ${list(d.gained, "ar")}${u ? ` (حتى ${day(u, "ar")})` : ""}.`);
    }
    if (d.lost.length) {
      en.push(`Access removed from ${n.en}: ${list(d.lost, "en")}.`);
      ar.push(`أُزيلت صلاحيات من ${n.ar}: ${list(d.lost, "ar")}.`);
    }
    if (d.longer.length) {
      const u = until(d.longer);
      en.push(`Access extended for ${n.en}${u ? ` until ${day(u, "en")}` : " with no end date"}: ${list(d.longer, "en")}.`);
      ar.push(`مُدّدت صلاحيات ${n.ar}${u ? ` حتى ${day(u, "ar")}` : " دون تاريخ انتهاء"}: ${list(d.longer, "ar")}.`);
    }
    if (d.shorter.length) {
      const u = until(d.shorter);
      en.push(`Access shortened for ${n.en}${u ? ` to end on ${day(u, "en")}` : ""}: ${list(d.shorter, "en")}.`);
      ar.push(`قُصّرت مدة صلاحيات ${n.ar}${u ? ` لتنتهي في ${day(u, "ar")}` : ""}: ${list(d.shorter, "ar")}.`);
    }
  }
  return { en: en.join("\n"), ar: ar.join("\n") };
}

/** Active members who hold `permission` through an assignment that has not ended. */
async function holdersOf(tx: Tx, orgId: string, permission: string, now: Date) {
  const rows = await tx.membership.findMany({
    where: { orgId, status: "ACTIVE", roles: { some: { AND: [activeAssignmentWhere(now), { role: { permissions: { has: permission } } }] } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Who is told: the people who managed safeguarding when the change was made, else the principal. Never the actor. */
export function alertRecipients(managers: string[], principals: string[], actorId: string | null): { to: string[]; fallback: boolean } {
  const to = [...new Set(managers)].filter((id) => id !== actorId);
  if (to.length) return { to, fallback: false };
  return { to: [...new Set(principals)].filter((id) => id !== actorId), fallback: true };
}

/**
 * Sends the alert when the change touched safeguarding or wellbeing access. Runs inside the change's
 * transaction (so a failed change sends nothing); email goes out after commit through ec.effects.
 * Returns how many people were told.
 */
export async function alertSafeguardingAccess(ec: ExecCtx, input: AlertInput): Promise<number> {
  const { tx, orgId, now } = ec;
  const deltas = watchedDeltas(input.before, input.after, [...new Set(input.memberIds)], SAFEGUARDING_WATCHED, now, input.beforeAt ?? now);
  const roles = (input.roles ?? []).filter((r) => {
    const d = roleWatchedDelta(r.before, r.after, SAFEGUARDING_WATCHED);
    return d.gained.length > 0 || d.lost.length > 0;
  });
  if (deltas.length === 0 && roles.length === 0) return 0;

  const people = await tx.membership.findMany({ where: { orgId, id: { in: deltas.map((d) => d.membershipId) } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
  const names = new Map(people.map((p) => [p.id, { en: p.user.nameEn, ar: p.user.nameAr || p.user.nameEn }]));
  const changes = describeAccessChange(deltas, names, input.after, roles, now);

  // The people who managed safeguarding when the change was made: current holders (read after the change),
  // minus anyone who only gained it in this change, plus anyone who just lost it.
  const gainedManage = new Set(deltas.filter((d) => d.gained.includes("safeguarding.manage")).map((d) => d.membershipId));
  const lostManage = deltas.filter((d) => d.lost.includes("safeguarding.manage")).map((d) => d.membershipId);
  const managers = [...(await holdersOf(tx, orgId, "safeguarding.manage", now)).filter((id) => !gainedManage.has(id)), ...lostManage];
  const principals = (
    await tx.membership.findMany({ where: { orgId, status: "ACTIVE", roles: { some: { AND: [activeAssignmentWhere(now), { role: { key: "principal" } }] } } }, select: { id: true } })
  ).map((m) => m.id);
  const { to } = alertRecipients(managers, principals, input.actorId);
  if (to.length === 0) return 0;

  await ensureAccessAlertTemplate(tx, orgId);
  await notify(ec, {
    recipients: to,
    templateKey: ACCESS_ALERT_TEMPLATE,
    kind: ACCESS_ALERT_TEMPLATE,
    vars: { who: input.who, changes },
    href: "/admin/roles/report",
    sensitivity: "CONFIDENTIAL",
    channels: ["IN_APP", "EMAIL"],
    idempotencyBase: `access-alert:${input.changeId}`,
  });
  return to.length;
}

/** The display name of a member, in both languages, for the "who" of an alert. */
export async function memberName(tx: Tx, orgId: string, membershipId: string): Promise<Bi> {
  const m = await tx.membership.findFirst({ where: { orgId, id: membershipId }, select: { user: { select: { nameEn: true, nameAr: true } } } });
  return m ? { en: m.user.nameEn, ar: m.user.nameAr || m.user.nameEn } : { en: "A staff member", ar: "أحد الموظفين" };
}
