import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Info, ShieldAlert, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { PERMISSION_GROUPS, audienceOfRole, isSensitivePermission, permissionAllowedFor } from "@/server/access/permission-catalog";
import { STAFF_MEMBERSHIP_WHERE } from "@/server/access/roles";
import { rolesManagers } from "@/server/access/guardrails";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { AddRoleMember, DeleteRoleDialog, PermissionSwitch, RemoveRoleMember, RestoreDefaultButton, RoleDetailsDialog } from "@/components/access/role-forms";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("adminRoles");
  const role = ctx.can("roles.manage") ? await ctx.db.role.findUnique({ where: { id }, select: { nameEn: true, nameAr: true } }) : null;
  return { title: role ? pick(ctx.locale, role.nameEn, role.nameAr) : t("title") };
}

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.can("roles.manage")) notFound();
  const { db, locale } = ctx;
  const role = await db.role.findUnique({ where: { id } });
  if (!role) notFound();
  const t = await getTranslations("adminRoles");
  const ta = await getTranslations("access");
  const audience = audienceOfRole(role.key);
  const isStaffRole = audience === "staff";
  const name = pick(locale, role.nameEn, role.nameAr);
  const sensitive = role.permissions.some(isSensitivePermission);
  const def = SYSTEM_ROLES.find((r) => r.key === role.key);

  const [members, memberCount, allRoles] = await Promise.all([
    isStaffRole
      ? db.membership.findMany({
          where: { roles: { some: { roleId: role.id } } },
          include: { user: { select: { nameEn: true, nameAr: true, email: true } }, roles: { select: { roleId: true } } },
          orderBy: { user: { nameEn: "asc" } },
          take: 300,
        })
      : Promise.resolve([]),
    db.membership.count({ where: { status: "ACTIVE", roles: { some: { roleId: role.id } } } }),
    db.role.findMany({ select: { id: true, key: true, nameEn: true, nameAr: true, permissions: true } }),
  ]);

  // Removing someone must never leave the school without a person who can manage roles.
  let candidates: Array<{ value: string; label: string; hint?: string; keywords?: string }> = [];
  let managerRoleMembers: Array<{ id: string; status: string; roleIds: string[] }> = [];
  if (isStaffRole) {
    const [staff, managers] = await Promise.all([
      db.membership.findMany({
        where: { AND: [STAFF_MEMBERSHIP_WHERE, { status: { in: ["ACTIVE", "INVITED"] } }, { roles: { none: { roleId: role.id } } }] },
        include: { user: { select: { nameEn: true, nameAr: true, email: true } } },
        orderBy: { user: { nameEn: "asc" } },
        take: 1000,
      }),
      db.membership.findMany({
        where: { roles: { some: { role: { permissions: { has: "roles.manage" } } } } },
        select: { id: true, status: true, roles: { select: { roleId: true } } },
      }),
    ]);
    candidates = staff.map((m) => ({ value: m.id, label: userName(m.user, locale), hint: m.user.email, keywords: `${m.user.nameEn} ${m.user.nameAr ?? ""} ${m.user.email}` }));
    managerRoleMembers = managers.map((m) => ({ id: m.id, status: m.status, roleIds: m.roles.map((r) => r.roleId) }));
  }
  const snapshot = { roles: allRoles.map((r) => ({ id: r.id, permissions: r.permissions })), members: managerRoleMembers };
  const lockFor = (membershipId: string, roleIds: string[]) => {
    if (roleIds.length <= 1) return t("lockLastRole");
    if (!role.permissions.includes("roles.manage")) return null;
    const after = { ...snapshot, members: snapshot.members.map((m) => (m.id === membershipId ? { ...m, roleIds: m.roleIds.filter((x) => x !== role.id) } : m)) };
    const managers = rolesManagers(after);
    if (managers.length === 0) return t("error.LAST_ROLES_MANAGER");
    if (membershipId === ctx.membershipId && !managers.includes(membershipId)) return t("error.SELF_LOCKOUT");
    return null;
  };

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
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RoleDetailsDialog role={{ id: role.id, nameEn: role.nameEn, nameAr: role.nameAr, descEn: role.descEn ?? "", descAr: role.descAr ?? "", isSystem: role.isSystem }} />
          {role.isSystem && def && role.customized && <RestoreDefaultButton roleId={role.id} />}
          {!role.isSystem && (
            <DeleteRoleDialog
              roleId={role.id}
              memberCount={members.length}
              targets={allRoles.filter((r) => r.id !== role.id && audienceOfRole(r.key) === "staff").map((r) => ({ id: r.id, label: pick(locale, r.nameEn, r.nameAr) }))}
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
                      <PermissionSwitch roleId={role.id} roleName={name} permission={p} label={label} granted={role.permissions.includes(p)} sensitive={sens} />
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
                <AddRoleMember roleId={role.id} candidates={candidates} sensitive={sensitive} />
                {members.length === 0 ? (
                  <EmptyState title={t("noMembers")} body={t("noMembersBody")} className="py-8" />
                ) : (
                  <ul className="divide-y rounded-lg border" data-testid="role-members">
                    {members.map((m) => {
                      const n = userName(m.user, locale);
                      return (
                        <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2" data-testid="role-member">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                              {n}
                              {m.id === ctx.membershipId && <Pill>{t("you")}</Pill>}
                              {m.status !== "ACTIVE" && <Pill tone="warning">{t(`memberStatus.${m.status}`)}</Pill>}
                            </div>
                            <div className="truncate text-xs text-muted-foreground" dir="ltr">
                              {m.user.email}
                            </div>
                          </div>
                          <RemoveRoleMember roleId={role.id} membershipId={m.id} name={n} lock={lockFor(m.id, m.roles.map((r) => r.roleId))} />
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
