import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarClock, Info, Lock, ShieldAlert, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { pick, userName } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { Link } from "@/i18n/navigation";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { PERMISSION_GROUPS, audienceOfRole, isSensitivePermission, opensSensitiveRecords, permissionAllowedFor } from "@/server/access/permission-catalog";
import { STAFF_MEMBERSHIP_WHERE } from "@/server/access/roles";
import {
  checkAccessChange,
  permissionsBlockedForSelf,
  rolePermissionsBlockedForSelf,
  rolesBlockedForSelf,
  selfEscalation,
  withAssignmentEnd,
  withMemberRoles,
  withoutPermanentRole,
  withoutRole,
} from "@/server/access/guardrails";
import { loadSnapshot } from "@/server/access/snapshot";
import { MAX_UNTIL_DAYS, assignmentActive, daysLeft, dubaiDayKey } from "@/server/access/until";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { AddRoleMember, AssignmentEndButton, DeleteRoleDialog, PermissionSwitch, RemoveRoleMember, RestoreDefaultButton, RoleDetailsDialog } from "@/components/access/role-forms";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("adminRoles");
  const role = ctx.can("roles.manage") ? await ctx.db.role.findFirst({ where: { OR: [{ id }, { key: id }] }, select: { nameEn: true, nameAr: true } }) : null;
  return { title: role ? pick(ctx.locale, role.nameEn, role.nameAr) : t("title") };
}

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.can("roles.manage")) notFound();
  const { db, locale } = ctx;
  // A role opens by id, or by key for stable links (the demo guide links to /admin/roles/school_admin).
  const role = await db.role.findFirst({ where: { OR: [{ id }, { key: id }] } });
  if (!role) notFound();
  const t = await getTranslations("adminRoles");
  const ta = await getTranslations("access");
  const audience = audienceOfRole(role.key);
  const isStaffRole = audience === "staff";
  const name = pick(locale, role.nameEn, role.nameAr);
  const sensitive = opensSensitiveRecords(role.permissions);
  const def = SYSTEM_ROLES.find((r) => r.key === role.key);

  const now = new Date();
  const prefs = await formatPrefs(ctx);
  const [members, memberCount, allRoles, snapshot] = await Promise.all([
    isStaffRole
      ? db.membership.findMany({
          where: { roles: { some: { roleId: role.id } } },
          include: { user: { select: { nameEn: true, nameAr: true, email: true } }, roles: { select: { roleId: true, expiresAt: true } } },
          orderBy: { user: { nameEn: "asc" } },
          take: 300,
        })
      : Promise.resolve([]),
    db.membership.count({ where: { status: "ACTIVE", roles: { some: { roleId: role.id } } } }),
    db.role.findMany({ select: { id: true, key: true, nameEn: true, nameAr: true, permissions: true } }),
    // The viewer, everyone in this role and everyone who manages roles: enough to check every change offered here.
    tenantTx(ctx.orgId, (tx) => loadSnapshot(tx, [ctx.membershipId], [role.id])),
  ]);
  const me = ctx.membershipId;
  const today = dubaiDayKey(now);
  const maxDay = dubaiDayKey(new Date(now.getTime() + MAX_UNTIL_DAYS * 86_400_000));
  const dateOf = (d: Date) => fmtDate(prefs, d, "medium");

  let candidates: Array<{ value: string; label: string; hint?: string; keywords?: string }> = [];
  let selfNote: string | null = null;
  if (isStaffRole) {
    const staff = await db.membership.findMany({
      where: { AND: [STAFF_MEMBERSHIP_WHERE, { status: { in: ["ACTIVE", "INVITED"] } }, { roles: { none: { roleId: role.id } } }] },
      include: { user: { select: { nameEn: true, nameAr: true, email: true } } },
      orderBy: { user: { nameEn: "asc" } },
      take: 1000,
    });
    // Nobody is offered a change that would raise their own sensitive access: the viewer is left out of the picker.
    const selfBlocked = rolesBlockedForSelf(snapshot, me, [role.id], now).length > 0;
    candidates = staff.filter((m) => !(selfBlocked && m.id === me)).map((m) => ({ value: m.id, label: userName(m.user, locale), hint: m.user.email, keywords: `${m.user.nameEn} ${m.user.nameAr ?? ""} ${m.user.email}` }));
    if (selfBlocked && staff.some((m) => m.id === me)) selfNote = t("selfNotListed");
  }

  const errorText = (code: string) => (code === "SELF_ESCALATION" ? t("selfBlockedChange") : t(`error.${code}`));
  // Ending someone's role: a staff member keeps at least one role, one that does not expire, and the school keeps a roles manager.
  const lockFor = (membershipId: string, roleIds: string[]) => {
    if (roleIds.length <= 1) return t("lockLastRole");
    const cur = snapshot.members.find((m) => m.id === membershipId);
    if (!cur) return null;
    const err = checkAccessChange(snapshot, withMemberRoles(snapshot, membershipId, cur.roleIds.filter((x) => x !== role.id)), me, now, [membershipId]);
    return err ? errorText(err) : null;
  };
  // Changing when someone's role ends: what the dialog may offer.
  const endFor = (membershipId: string, until: Date | null, name: string) => {
    const cur = snapshot.members.find((m) => m.id === membershipId);
    if (!cur) return { lock: null, maxDay, allowNoEnd: true, note: null };
    const soon = new Date(now.getTime() + 60_000);
    if (!until) {
      // Giving a permanent role an end date: they need another permanent role, and the roles manager rules hold.
      if (withoutPermanentRole(withAssignmentEnd(snapshot, membershipId, role.id, soon), [membershipId]).length) return { lock: t("needsPermanentForEnd", { name }), maxDay, allowNoEnd: false, note: null };
      const err = checkAccessChange(snapshot, withAssignmentEnd(snapshot, membershipId, role.id, new Date(now.getTime() + 86_400_000)), me, now, [membershipId]);
      return { lock: err ? errorText(err) : null, maxDay, allowNoEnd: false, note: null };
    }
    // The viewer's own sensitive access can only be shortened.
    const extendBlocked = selfEscalation(snapshot, withAssignmentEnd(snapshot, membershipId, role.id, null), me, now).length > 0;
    if (extendBlocked) return { lock: null, maxDay: dubaiDayKey(until), allowNoEnd: false, note: t("selfExtendBlocked") };
    return { lock: null, maxDay, allowNoEnd: true, note: null };
  };

  // Permissions the viewer cannot switch on for a role they hold, and whether restoring the default would raise their access.
  const sensitiveHere = PERMISSION_GROUPS.flatMap((g) => g.permissions).filter((p) => isSensitivePermission(p));
  const blockedPerms = new Set(permissionsBlockedForSelf(snapshot, me, role.id, sensitiveHere, now));
  const restoreBlocked = def && role.customized && rolePermissionsBlockedForSelf(snapshot, me, role.id, def.permissions, now) ? t("selfBlockedRestore") : null;
  // Deleting a role I hold must not move me into a role that raises my access.
  const deleteTargets = allRoles.filter((r) => r.id !== role.id && audienceOfRole(r.key) === "staff");
  const mine = snapshot.members.find((m) => m.id === me && m.roleIds.includes(role.id));
  const allowedTargets = mine
    ? deleteTargets.filter((r) => {
        const without = withoutRole(snapshot, role.id);
        const meAfter = without.members.find((m) => m.id === me)!;
        return selfEscalation(snapshot, withMemberRoles(without, me, [...new Set([...meAfter.roleIds, r.id])]), me, now).length === 0;
      })
    : deleteTargets;
  const timeLimitedCount = members.filter((m) => m.roles.some((r) => r.roleId === role.id && r.expiresAt && assignmentActive(r.expiresAt, now))).length;

  const groups = PERMISSION_GROUPS.map((g) => ({ key: g.key, permissions: g.permissions.filter((p) => permissionAllowedFor(audience, p)) })).filter((g) => g.permissions.length > 0);

  return (
    <PageBody>
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/admin/roles">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("backToRoles")}
        </Link>
      </Button>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="role-title">
              {name}
            </h1>
            {!role.isSystem ? <Pill tone="violet">{t("badgeCustom")}</Pill> : role.customized ? <Pill tone="warning">{t("badgeCustomized")}</Pill> : <Pill>{t("badgeBuiltIn")}</Pill>}
            {sensitive && (
              <Pill tone="danger">
                <ShieldAlert className="size-3" />
                {t("sensitiveBadge")}
              </Pill>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{pick(locale, role.descEn, role.descAr) || t("noDescription")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`audience.${audience}`)} · {t("memberCount", { count: memberCount })}
            {timeLimitedCount > 0 && <> · {t("timeLimitedCount", { count: timeLimitedCount })}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RoleDetailsDialog role={{ id: role.id, nameEn: role.nameEn, nameAr: role.nameAr, descEn: role.descEn ?? "", descAr: role.descAr ?? "", isSystem: role.isSystem }} />
          {role.isSystem && def && role.customized && <RestoreDefaultButton roleId={role.id} blocked={restoreBlocked} />}
          {!role.isSystem && (
            <DeleteRoleDialog
              roleId={role.id}
              memberCount={members.length}
              targets={allowedTargets.map((r) => ({ id: r.id, label: pick(locale, r.nameEn, r.nameAr) }))}
              hiddenNote={allowedTargets.length < deleteTargets.length ? t("deleteTargetsHidden") : null}
            />
          )}
        </div>
      </div>

      {role.isSystem && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>{role.customized ? t("customizedNote") : t("builtInNote")}</span>
        </div>
      )}
      {!isStaffRole && (
        <div className="flex items-start gap-2 rounded-lg border bg-info-soft/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <span>{t("familyAudienceNote")}</span>
        </div>
      )}
      {blockedPerms.size > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm" data-testid="self-role-note">
          <Lock className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{t("selfRoleNote", { count: blockedPerms.size })}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 lg:col-span-2">
          {groups.map((g) => (
            <Panel key={g.key} padded={false}>
              <div className="border-b px-5 py-3">
                <h2 className="text-sm font-semibold">{ta(`groups.${g.key}`)}</h2>
                <p className="text-xs text-muted-foreground">{ta(`groupHelp.${g.key}`)}</p>
              </div>
              <ul className="divide-y">
                {g.permissions.map((p) => {
                  const label = ta(`perms.${p}.label`);
                  const sens = isSensitivePermission(p);
                  return (
                    <li key={p} className="flex items-start justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {label}
                          {sens && (
                            <Pill tone="danger" className="px-1.5">
                              <ShieldAlert className="size-3" />
                              {t("sensitiveShort")}
                            </Pill>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{ta(`perms.${p}.help`)}</p>
                      </div>
                      <PermissionSwitch
                        roleId={role.id}
                        roleName={name}
                        permission={p}
                        label={label}
                        granted={role.permissions.includes(p)}
                        sensitive={sens}
                        selfBlocked={blockedPerms.has(p) ? t("selfBlockedPermission") : null}
                      />
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t("members")} description={isStaffRole ? t("membersBody") : t("familyMembersBody")} icon={<Users className="size-4" />} />
            {isStaffRole ? (
              <div className="space-y-4">
                <AddRoleMember roleId={role.id} candidates={candidates} sensitive={sensitive} today={today} maxDay={maxDay} selfNote={selfNote} />
                {members.length === 0 ? (
                  <EmptyState title={t("noMembers")} body={t("noMembersBody")} className="py-8" />
                ) : (
                  <ul className="divide-y rounded-lg border" data-testid="role-members">
                    {members.map((m) => {
                      const n = userName(m.user, locale);
                      const until = m.roles.find((r) => r.roleId === role.id)?.expiresAt ?? null;
                      const ended = until ? !assignmentActive(until, now) : false;
                      const end = endFor(m.id, until, n);
                      return (
                        <li key={m.id} className="flex flex-col gap-1 px-3 py-2.5" data-testid="role-member" data-until={until ? dubaiDayKey(until) : undefined}>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                              <span className="truncate">{n}</span>
                              {m.id === ctx.membershipId && <Pill>{t("you")}</Pill>}
                              {m.status !== "ACTIVE" && <Pill tone="warning">{t(`memberStatus.${m.status}`)}</Pill>}
                              {until && (
                                <Pill tone={ended ? "neutral" : "warning"}>
                                  <CalendarClock className="size-3" />
                                  {ended ? t("endedPill", { date: dateOf(until) }) : t("untilPill", { date: dateOf(until) })}
                                </Pill>
                              )}
                            </div>
                            <div className="flex min-w-0 gap-1 text-xs text-muted-foreground">
                              <span className="truncate" dir="ltr">
                                {m.user.email}
                              </span>
                              {until && !ended && <span className="shrink-0">· {t("daysLeft", { count: daysLeft(until, now) })}</span>}
                            </div>
                          </div>
                          <div className="-me-2 flex shrink-0 items-center justify-end gap-0.5">
                            {!ended && (
                              <AssignmentEndButton
                                roleId={role.id}
                                membershipId={m.id}
                                name={n}
                                roleName={name}
                                until={until ? dubaiDayKey(until) : null}
                                today={today}
                                maxDay={end.maxDay}
                                allowNoEnd={end.allowNoEnd}
                                lock={end.lock}
                                note={end.note}
                              />
                            )}
                            <RemoveRoleMember roleId={role.id} membershipId={m.id} name={n} lock={lockFor(m.id, m.roles.map((r) => r.roleId))} timeLimited={!!until} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/invitations">{t("goToInvitations")}</Link>
              </Button>
            )}
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
