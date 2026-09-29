import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight, KeyRound, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import { PERMISSION_GROUPS, audienceOfRole, isSensitivePermission } from "@/server/access/permission-catalog";
import { explainAccess } from "@/server/access/roles";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { AccessCheckPicker, CreateRoleDialog } from "@/components/access/role-forms";
import { AccessTabs } from "@/components/access/access-tabs";

export async function generateMetadata() {
  const t = await getTranslations("adminRoles");
  return { title: t("title") };
}

const ORDER = SYSTEM_ROLES.map((r) => r.key);

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ tab?: string; person?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("roles.manage")) notFound();
  const t = await getTranslations("adminRoles");
  const ta = await getTranslations("access");
  const { db, locale } = ctx;
  const tab = sp.tab === "check" ? "check" : "roles";

  const roles = await db.role.findMany({
    include: { _count: { select: { members: { where: { membership: { status: "ACTIVE" } } } } } },
  });
  roles.sort((a, b) => {
    const ia = ORDER.indexOf(a.key);
    const ib = ORDER.indexOf(b.key);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.nameEn.localeCompare(b.nameEn);
  });
  const staffRoles = roles.filter((r) => audienceOfRole(r.key) === "staff");
  const familyRoles = roles.filter((r) => audienceOfRole(r.key) !== "staff");

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={tab === "roles" ? <CreateRoleDialog roles={staffRoles.map((r) => ({ id: r.id, label: pick(locale, r.nameEn, r.nameAr) }))} /> : null}
      />
      <AccessTabs
        current={tab}
        tabs={[
          { value: "roles", label: t("tabRoles"), href: "/admin/roles" },
          { value: "check", label: t("tabCheck"), href: "/admin/roles?tab=check" },
        ]}
      />
      {tab === "roles" ? (
        <>
          <RoleSection title={t("staffRoles")} description={t("staffRolesBody")} roles={staffRoles} />
          <RoleSection title={t("familyRoles")} description={t("familyRolesBody")} roles={familyRoles} />
        </>
      ) : (
        await accessCheck()
      )}
    </PageBody>
  );

  function RoleSection({ title, description, roles: list }: { title: string; description: string; roles: typeof roles }) {
    return (
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => {
            const sensitive = r.permissions.some(isSensitivePermission);
            return (
              <Link key={r.id} href={`/admin/roles/${r.id}`} className="group rounded-xl border bg-card p-4 shadow-xs transition hover:border-brand/40 hover:shadow-sm" data-testid={`role-card-${r.key}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold group-hover:text-brand">{pick(locale, r.nameEn, r.nameAr)}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{pick(locale, r.descEn, r.descAr) || t("noDescription")}</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Pill>
                    <Users className="size-3" />
                    {t("memberCount", { count: r._count.members })}
                  </Pill>
                  <Pill tone="info">{t("permissionCount", { count: r.permissions.length })}</Pill>
                  {!r.isSystem ? <Pill tone="violet">{t("badgeCustom")}</Pill> : r.customized ? <Pill tone="warning">{t("badgeCustomized")}</Pill> : <Pill tone="neutral">{t("badgeBuiltIn")}</Pill>}
                  {sensitive && (
                    <Pill tone="danger">
                      <ShieldAlert className="size-3" />
                      {t("sensitiveBadge")}
                    </Pill>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    );
  }

  async function accessCheck() {
    const members = await db.membership.findMany({
      where: { status: { in: ["ACTIVE", "SUSPENDED", "INVITED"] }, roles: { some: {} } },
      include: { user: { select: { nameEn: true, nameAr: true, email: true } }, roles: { include: { role: { select: { key: true, nameEn: true, nameAr: true } } } } },
      orderBy: { user: { nameEn: "asc" } },
      take: 2000,
    });
    const options = members.map((m) => ({
      value: m.id,
      label: userName(m.user, locale),
      hint: m.roles.map((r) => pick(locale, r.role.nameEn, r.role.nameAr)).join(", "),
      keywords: `${m.user.nameEn} ${m.user.nameAr ?? ""} ${m.user.email}`,
    }));
    const person = sp.person
      ? await db.membership.findUnique({ where: { id: sp.person }, include: { user: true, roles: { include: { role: true } } } })
      : null;
    const granted = person ? explainAccess(person) : null;
    const roleName = (key: string) => {
      const r = person?.roles.find((x) => x.role.key === key)?.role;
      return r ? pick(locale, r.nameEn, r.nameAr) : key;
    };
    return (
      <div className="space-y-4">
        <Panel>
          <div className="mb-3 flex items-start gap-2.5">
            <KeyRound className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold">{t("checkTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("checkBody")}</p>
            </div>
          </div>
          <AccessCheckPicker options={options} value={person?.id ?? ""} />
        </Panel>
        {!person ? (
          <EmptyState icon={<ShieldCheck className="size-5" />} title={t("checkEmpty")} body={t("checkEmptyBody")} />
        ) : (
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-semibold" data-testid="check-person">
                {userName(person.user, locale)}
              </div>
              <span className="text-xs text-muted-foreground" dir="ltr">
                {person.user.email}
              </span>
              <Pill tone={person.status === "ACTIVE" ? "success" : "warning"} dot>
                {t(`memberStatus.${person.status}`)}
              </Pill>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {person.roles.map((r) => (
                <Link key={r.id} href={`/admin/roles/${r.role.id}`}>
                  <Pill tone="brand">{pick(locale, r.role.nameEn, r.role.nameAr)}</Pill>
                </Link>
              ))}
            </div>
            {person.status !== "ACTIVE" && <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm">{t("checkInactive")}</p>}
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {PERMISSION_GROUPS.map((g) => {
                const rows = g.permissions.map((p) => ({ p, by: granted?.get(p) ?? [] }));
                const count = rows.filter((r) => r.by.length > 0).length;
                return (
                  <div key={g.key} className="min-w-0">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ta(`groups.${g.key}`)}</h3>
                      <span className="text-xs text-muted-foreground">{t("canCount", { count, total: rows.length })}</span>
                    </div>
                    <ul className="divide-y rounded-lg border">
                      {rows.map(({ p, by }) => (
                        <li key={p} className="flex items-start justify-between gap-3 px-3 py-2" data-testid={`check-${p}`} data-granted={by.length > 0 ? "yes" : "no"}>
                          <div className="min-w-0">
                            <div className={by.length ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{ta(`perms.${p}.label`)}</div>
                            {by.length > 0 && <div className="text-xs text-muted-foreground">{t("grantedBy", { roles: by.map(roleName).join(", ") })}</div>}
                          </div>
                          {by.length > 0 ? <Pill tone="success">{t("yes")}</Pill> : <Pill>{t("no")}</Pill>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </div>
    );
  }
}
