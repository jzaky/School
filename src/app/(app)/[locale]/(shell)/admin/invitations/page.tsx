import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Clock, Download, KeyRound, Link2, MailCheck, MailX, Send, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { enabledOAuthProviders } from "@/auth";
import { fmtDate, fmtNumber } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { audienceOfRole } from "@/server/access/permission-catalog";
import { ensureJoinCode, toRow, type InviteRow } from "@/server/access/invitations";
import { SYSTEM_ROLES } from "@/server/identity/permissions";
import type { InviteState } from "@/server/access/tokens";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { Pill, type Tone } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { AccessTabs } from "@/components/access/access-tabs";
import { BulkStaffDialog, FamilyJoinUrl, FamilyQr, InviteDialog, InviteFamiliesButton, InviteRowActions, RegenerateCodeButton, StaffLinkDialog } from "@/components/access/invite-forms";
import { SignInSettings } from "@/components/access/sign-in-settings";

export async function generateMetadata() {
  const t = await getTranslations("adminInvites");
  return { title: t("title") };
}

type Tab = "invites" | "links" | "signin";
const STATE_TONE: Record<InviteState, Tone> = { PENDING: "info", ACCEPTED: "success", EXPIRED: "neutral", REVOKED: "danger" };
const STATES: InviteState[] = ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"];
const ORDER = SYSTEM_ROLES.map((r) => r.key);

export default async function InvitationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; state?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("people.invite")) notFound();
  const t = await getTranslations("adminInvites");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const now = new Date();
  const tab: Tab = sp.tab === "links" || sp.tab === "signin" ? sp.tab : "invites";
  const stateFilter = STATES.includes(sp.state as InviteState) ? (sp.state as InviteState) : null;

  const [roles, invitations] = await Promise.all([
    db.role.findMany({ select: { id: true, key: true, nameEn: true, nameAr: true, descEn: true, descAr: true } }),
    db.invitation.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  roles.sort((a, b) => (ORDER.indexOf(a.key) === -1 ? 999 : ORDER.indexOf(a.key)) - (ORDER.indexOf(b.key) === -1 ? 999 : ORDER.indexOf(b.key)) || a.nameEn.localeCompare(b.nameEn));
  const roleName = (key: string) => {
    const r = roles.find((x) => x.key === key);
    return r ? pick(locale, r.nameEn, r.nameAr) : key;
  };
  const staffRoles = roles.filter((r) => audienceOfRole(r.key) === "staff").map((r) => ({ key: r.key, label: pick(locale, r.nameEn, r.nameAr), description: pick(locale, r.descEn, r.descAr) }));
  const rows = invitations.map((i) => toRow(i, now));
  const personal = rows.filter((r) => !r.isLink);
  const links = rows.filter((r) => r.isLink);
  const counts = { pending: personal.filter((r) => r.state === "PENDING").length, accepted: personal.filter((r) => r.state === "ACCEPTED").length, expired: personal.filter((r) => r.state === "EXPIRED").length };

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={tab === "invites" ? await inviteActions() : tab === "links" ? <StaffLinkDialog roles={staffRoles} /> : null}
      />
      <AccessTabs
        current={tab}
        label={t("title")}
        tabs={[
          { value: "invites", label: t("tabInvites"), href: "/admin/invitations", count: counts.pending },
          { value: "links", label: t("tabLinks"), href: "/admin/invitations?tab=links" },
          { value: "signin", label: t("tabSignIn"), href: "/admin/invitations?tab=signin" },
        ]}
      />
      {tab === "invites" && (await invitesTab())}
      {tab === "links" && (await linksTab())}
      {tab === "signin" && (
        <SignInSettings
          canEdit={ctx.can("roles.manage")}
          providers={enabledOAuthProviders()}
          initial={{
            googleSignIn: ctx.org.googleSignIn,
            microsoftSignIn: ctx.org.microsoftSignIn,
            staffEmailDomains: ctx.org.staffEmailDomains,
            staffDomainAutoApprove: ctx.org.staffDomainAutoApprove,
            parentSelfJoin: ctx.org.parentSelfJoin,
            parentJoinApproval: ctx.org.parentJoinApproval,
            studentSelfJoin: ctx.org.studentSelfJoin,
          }}
        />
      )}
    </PageBody>
  );

  async function inviteActions() {
    const [students, departments, waitingFamilies] = await Promise.all([
      db.student.findMany({ where: { status: "ACTIVE" }, select: { id: true, studentNo: true, gradeLevel: true, section: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, membershipId: true }, orderBy: [{ gradeLevel: "asc" }, { lastNameEn: "asc" }], take: 3000 }),
      db.department.findMany({ orderBy: { nameEn: "asc" }, select: { id: true, nameEn: true, nameAr: true } }),
      db.guardian.count({ where: { membershipId: null, email: { not: null }, links: { some: {} } } }),
    ]);
    const opt = (s: (typeof students)[number]) => ({ value: s.id, label: personName(s, locale), hint: `${s.studentNo} · ${t("gradeN", { grade: s.gradeLevel })}`, keywords: `${s.firstNameEn} ${s.lastNameEn} ${s.firstNameAr} ${s.lastNameAr} ${s.studentNo}` });
    return (
      <>
        <InviteFamiliesButton waiting={waitingFamilies} />
        <BulkStaffDialog />
        <InviteDialog
          roles={staffRoles}
          departments={departments.map((d) => ({ id: d.id, label: pick(locale, d.nameEn, d.nameAr) }))}
          students={students.map(opt)}
          accountless={students.filter((s) => !s.membershipId).map(opt)}
        />
      </>
    );
  }

  async function invitesTab() {
    const list = stateFilter ? personal.filter((r) => r.state === stateFilter) : personal;
    const creators = await db.membership.findMany({ where: { id: { in: [...new Set(list.map((r) => r.createdById))] } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
    const cols = "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_120px_minmax(0,1fr)_200px]";
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("statPending")} value={fmtNumber(prefs, counts.pending)} icon={<Clock className="size-4" />} tone="info" href="/admin/invitations?state=PENDING" />
          <StatCard label={t("statAccepted")} value={fmtNumber(prefs, counts.accepted)} icon={<MailCheck className="size-4" />} tone="success" href="/admin/invitations?state=ACCEPTED" />
          <StatCard label={t("statExpired")} value={fmtNumber(prefs, counts.expired)} icon={<MailX className="size-4" />} tone="warning" href="/admin/invitations?state=EXPIRED" />
          <StatCard label={t("statLinks")} value={fmtNumber(prefs, links.filter((l) => l.state === "PENDING").length)} icon={<Link2 className="size-4" />} tone="gold" href="/admin/invitations?tab=links" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip href="/admin/invitations" active={!stateFilter} label={t("filterAll")} />
          {STATES.map((s) => (
            <FilterChip key={s} href={`/admin/invitations?state=${s}`} active={stateFilter === s} label={t(`state.${s}`)} />
          ))}
        </div>
        {list.length === 0 ? (
          <EmptyState icon={<Send className="size-5" />} title={t("emptyInvites")} body={t("emptyInvitesBody")} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <div className={`hidden gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid ${cols}`}>
              <span>{t("colPerson")}</span>
              <span>{t("colAccess")}</span>
              <span>{t("colStatus")}</span>
              <span>{t("colSent")}</span>
              <span className="text-end">{t("colActions")}</span>
            </div>
            <div className="divide-y">
              {list.map((r) => (
                <div key={r.id} className={`grid gap-2 px-4 py-3 sm:px-5 lg:items-center lg:gap-3 ${cols}`} data-testid="invite-row">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.nameEn || r.email}</div>
                    <div className="truncate text-xs text-muted-foreground" dir="ltr">
                      {r.email}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-1">
                    <Pill tone="brand">{t(`kind.${r.kind}`)}</Pill>
                    {r.kind === "STAFF" && r.roleKeys.map((k) => <Pill key={k}>{roleName(k)}</Pill>)}
                    {r.kind === "PARENT" && <Pill>{t("childCount", { count: r.studentIds.length })}</Pill>}
                  </div>
                  <div>
                    <Pill tone={STATE_TONE[r.state]} dot>
                      {t(`state.${r.state}`)}
                    </Pill>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>{t("sentBy", { name: userName(creators.find((c) => c.id === r.createdById)?.user, locale) || t("someone"), date: fmtDate(prefs, r.lastSentAt ?? r.createdAt) })}</div>
                    {r.state === "PENDING" && <div>{t("expiresOn", { date: fmtDate(prefs, r.expiresAt) })}</div>}
                  </div>
                  <InviteRowActions id={r.id} canResend={r.state === "PENDING" || r.state === "EXPIRED"} canRevoke={r.state === "PENDING"} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  async function linksTab() {
    const code = await ensureJoinCode(ctx.orgId);
    return (
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("familyCodeTitle")} description={ctx.org.parentSelfJoin ? t("familyCodeBody") : t("familyCodeOff")} icon={<Users className="size-4" />} action={<RegenerateCodeButton />} />
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <FamilyQr code={code} />
            <div className="w-full min-w-0 space-y-3">
              <div>
                <div className="text-xs text-muted-foreground">{t("schoolCode")}</div>
                <div className="font-mono text-2xl font-semibold tracking-wider text-brand" dir="ltr" data-testid="join-code">
                  {code}
                </div>
              </div>
              <FamilyJoinUrl code={code} />
              <Button asChild variant="outline" size="sm">
                <a href="/api/access/poster" download data-testid="download-poster">
                  <Download className="size-4" />
                  {t("downloadPoster")}
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">{ctx.org.parentJoinApproval ? t("approvalOn") : t("approvalOff")}</p>
              <Link href="/admin/invitations?tab=signin" className="text-xs font-medium text-brand hover:underline">
                {t("changeJoinSettings")}
              </Link>
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("staffLinksTitle")} description={t("staffLinksBody")} icon={<KeyRound className="size-4" />} />
          {links.length === 0 ? (
            <EmptyState icon={<Link2 className="size-5" />} title={t("emptyLinks")} body={t("emptyLinksBody")} className="py-8" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {links.map((l: InviteRow) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid="staff-link-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {l.roleKeys.map(roleName).join(", ")}
                      <Pill tone={STATE_TONE[l.state]} dot>
                        {t(`state.${l.state === "ACCEPTED" ? "USED_UP" : l.state}`)}
                      </Pill>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("linkUses", { uses: l.uses, max: l.maxUses })} · {t("expiresOn", { date: fmtDate(prefs, l.expiresAt) })}
                    </div>
                  </div>
                  <InviteRowActions id={l.id} canResend={false} canRevoke={l.state === "PENDING"} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={active ? "rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground" : "rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"}>
      {label}
    </Link>
  );
}

