import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { buildNav } from "@/server/shell/nav";
import { AppShell } from "@/components/shell/app-shell";
import { initials, pick, userName } from "@/lib/i18n-data";
import { demoModeEnabled } from "@/auth";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const { db, orgId, membershipId, locale } = ctx;
  const tRoles = await getTranslations("roles");
  const [approvals, tasks, unread, personas] = await Promise.all([
    db.approvalAssignee.count({ where: { orgId, membershipId, status: "PENDING", approval: { status: "PENDING" } } }),
    db.task.count({ where: { orgId, assigneeId: membershipId, status: { in: ["TODO", "IN_PROGRESS"] } } }),
    db.notification.count({ where: { orgId, recipientId: membershipId, readAt: null } }),
    ctx.org.isDemo && demoModeEnabled()
      ? db.demoPersona.findMany({ where: { orgId }, orderBy: { order: "asc" } })
      : Promise.resolve([]),
  ]);
  const personaMembers = personas.length
    ? await db.membership.findMany({ where: { id: { in: personas.map((p) => p.membershipId) } }, include: { user: true } })
    : [];
  const name = userName(ctx.user, locale);
  const primaryRole = ctx.roles[0];
  const nav = buildNav(ctx, { approvals, tasks, notifications: unread });
  return (
    <AppShell
      nav={nav}
      unread={unread}
      user={{
        name,
        initials: initials(ctx.user.nameEn),
        email: ctx.user.email,
        roleLabel: pick(locale, ctx.membership.titleEn, ctx.membership.titleAr) || (primaryRole ? tRoles(primaryRole) : ""),
      }}
      org={{ name: pick(locale, ctx.org.nameEn, ctx.org.nameAr), short: pick(locale, ctx.org.shortNameEn, ctx.org.shortNameAr) || ctx.org.nameEn }}
      demo={{
        enabled: personas.length > 0,
        current: ctx.persona,
        personas: personas.map((p) => {
          const m = personaMembers.find((x) => x.id === p.membershipId);
          const n = m ? userName(m.user, locale) : "";
          return { key: p.key, label: pick(locale, p.roleLabelEn, p.roleLabelAr), name: n, initials: initials(m?.user.nameEn ?? "") };
        }),
      }}
    >
      {children}
    </AppShell>
  );
}
