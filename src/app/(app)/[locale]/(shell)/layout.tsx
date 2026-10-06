export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { buildNav } from "@/server/shell/nav";
import { AppShell } from "@/components/shell/app-shell";
import { initials, pick, userName } from "@/lib/i18n-data";
import { demoModeEnabled } from "@/auth";
import { DemoGuide } from "@/components/demo/demo-guide";
import { GUIDE_STEPS } from "@/server/demo/guide";
import { listUserOrganizations } from "@/server/identity/session-org";
import { filterNav, pathEnabled } from "@/lib/modules";
import { BrandStyle } from "@/components/onboarding/brand-style";
import { VerifyBanner } from "@/components/onboarding/verify-banner";
import { schoolVerified } from "@/server/onboarding/verification";
import { canSetup } from "@/server/onboarding/access";
import { InstallPrompt, PwaRegister } from "@/components/pwa/install-prompt";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const { db, orgId, membershipId, locale } = ctx;
  const tRoles = await getTranslations("roles");
  const [approvals, tasks, unread, personas, joinRequests, schools] = await Promise.all([
    db.approvalAssignee.count({ where: { orgId, membershipId, status: "PENDING", approval: { status: "PENDING" } } }),
    db.task.count({ where: { orgId, assigneeId: membershipId, status: { in: ["TODO", "IN_PROGRESS"] } } }),
    db.notification.count({ where: { orgId, recipientId: membershipId, readAt: null } }),
    ctx.org.isDemo && demoModeEnabled()
      ? db.demoPersona.findMany({ where: { orgId }, orderBy: { order: "asc" } })
      : Promise.resolve([]),
    ctx.can("people.manage") || ctx.can("people.invite") ? db.joinRequest.count({ where: { orgId, status: "PENDING" } }) : Promise.resolve(0),
    listUserOrganizations(ctx.user.id),
  ]);
  const personaMembers = personas.length
    ? await db.membership.findMany({ where: { id: { in: personas.map((p) => p.membershipId) } }, include: { user: true } })
    : [];
  const name = userName(ctx.user, locale);
  const primaryRole = ctx.roles[0];
  // Switched-off modules disappear from the navigation and the guide.
  const nav = filterNav(ctx.org, buildNav(ctx, { approvals, tasks, notifications: unread, joinRequests }));
  const tGuide = await getTranslations("guide");
  const guideSteps = personas.length && ctx.persona ? (GUIDE_STEPS[ctx.persona] ?? []).filter((s) => pathEnabled(ctx.org, s.href)) : [];
  // New schools: administrators see a banner until the founding administrator confirms their email.
  const showVerify = canSetup(ctx) && !(await schoolVerified(ctx.org, ctx.user));
  const isFounder = ctx.org.createdById === ctx.user.id;
  return (
    <>
    <BrandStyle primaryColor={ctx.org.primaryColor} accentColor={ctx.org.accentColor} />
    <AppShell
      nav={nav}
      unread={unread}
      user={{
        name,
        initials: initials(ctx.user.nameEn),
        email: ctx.user.email,
        roleLabel: pick(locale, ctx.membership.titleEn, ctx.membership.titleAr) || (primaryRole ? (tRoles.has(primaryRole) ? tRoles(primaryRole) : pick(locale, ctx.membership.roles[0]?.role.nameEn, ctx.membership.roles[0]?.role.nameAr)) : ""),
      }}
      org={{ name: pick(locale, ctx.org.nameEn, ctx.org.nameAr), short: pick(locale, ctx.org.shortNameEn, ctx.org.shortNameAr) || ctx.org.nameEn, hasLogo: !!ctx.org.logoUrl, logoVersion: ctx.org.updatedAt.getTime() }}
      schools={schools.length > 1 ? schools.map((s) => ({ id: s.id, name: pick(locale, s.nameEn, s.nameAr), current: s.id === orgId })) : []}
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
      {showVerify && <VerifyBanner email={isFounder ? ctx.user.email : null} canResend={isFounder} />}
      {children}
      <PwaRegister />
      {(ctx.isParent || ctx.isStudent) && <InstallPrompt />}
      {guideSteps.length > 0 && (
        <DemoGuide
          persona={ctx.persona!}
          intro={tGuide.has(`intro.${ctx.persona}`) ? tGuide(`intro.${ctx.persona}`) : tGuide("introDefault")}
          steps={guideSteps.map((s) => ({ ...s, title: tGuide(`steps.${s.key}.title`), body: tGuide(`steps.${s.key}.body`) }))}
        />
      )}
    </AppShell>
    </>
  );
}
