import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlarmClock, Building2, CalendarCheck2, GraduationCap, Inbox, ListChecks, Send, ShieldCheck, Timer, Users } from "lucide-react";
import { getGroupCtx, pickGroup } from "@/server/groups/context";
import { loadGroupDashboard } from "@/server/groups/dashboard";
import { APPLICATION_STAGES, GROUP_WINDOW_DAYS, avgTurnaround } from "@/server/groups/kpis";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { BarList } from "@/components/charts/bar-list";
import { Button } from "@/components/ui/button";
import { GroupSwitcher, OpenSchoolButton } from "@/components/groups/group-bits";
import { GroupMark } from "@/components/groups/group-mark";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("dashboardTitle") };
}

export default async function GroupDashboardPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const sp = await searchParams;
  const ctx = await getGroupCtx();
  const t = await getTranslations("groups");
  const tStage = await getTranslations("applications.stage");
  const current = pickGroup(ctx, sp.g);
  if (!current) {
    if (ctx.platformAdmin) redirect(`/${ctx.locale}/group/platform`);
    return (
      <PageBody>
        <EmptyState icon={<Building2 className="size-5" />} title={t("noGroupTitle")} body={t("noGroupBody")} action={ctx.activeOrgId ? <Button asChild variant="outline"><Link href="/home">{t("backToSchool")}</Link></Button> : undefined} />
      </PageBody>
    );
  }
  const { locale } = ctx;
  const data = await loadGroupDashboard(ctx.userId, current.groupId);
  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { maximumFractionDigits: 1 });
  const n = (v: number) => nf.format(v);
  const hrs = (v: number | null) => (v === null ? t("noData") : t("hours", { n: nf.format(v) }));
  const k = data.totals;
  const groupName = pick(locale, current.group.nameEn, current.group.nameAr);
  const schoolName = (s: { nameEn: string; nameAr: string }) => pick(locale, s.nameEn, s.nameAr);
  const emirateLabel = (e: string) => {
    const key = `emirates.${e.replace(/\s+/g, "")}`;
    return t.has(key) ? t(key) : e;
  };

  return (
    <PageBody>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <GroupMark groupId={current.groupId} name={groupName} hasLogo={!!current.group.logoUrl} version={current.group.updatedAt.getTime()} />
          <PageHeader eyebrow={t("dashboardTitle")} title={<span data-testid="group-name">{groupName}</span>} description={t("dashboardSubtitle", { days: GROUP_WINDOW_DAYS, count: data.schools.length })} />
        </div>
        <GroupSwitcher groups={ctx.roles.map((r) => ({ id: r.groupId, name: pick(locale, r.group.nameEn, r.group.nameAr) }))} current={current.groupId} />
      </div>
      <p className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="group-privacy-note">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        {t("privacyNote")}
      </p>

      {data.schools.length === 0 ? (
        <EmptyState icon={<Building2 className="size-5" />} title={t("noSchoolsTitle")} body={t("noSchoolsBody")} action={<Button asChild variant="outline"><Link href="/group/schools">{t("nav.schools")}</Link></Button>} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="group-totals">
            <StatCard label={t("kpi.openRequests")} value={n(k.openRequests)} hint={t("kpi.submittedHint", { n: n(k.requestsSubmitted) })} icon={<Inbox className="size-5" />} testId="kpi-open-requests" />
            <StatCard label={t("kpi.turnaround")} value={hrs(k.avgTurnaroundHours)} hint={t("kpi.turnaroundHint", { n: n(k.closedRequests) })} icon={<Timer className="size-5" />} tone="info" testId="kpi-turnaround" />
            <StatCard label={t("kpi.overdue")} value={n(k.overdue)} hint={t("kpi.overdueHint", { requests: n(k.overdueRequests), tasks: n(k.overdueTasks) })} icon={<AlarmClock className="size-5" />} tone={k.overdue ? "warning" : "success"} testId="kpi-overdue" />
            <StatCard label={t("kpi.parentMeetings")} value={n(k.parentMeetingsHeld)} hint={t("kpi.parentMeetingsHint", { n: n(k.parentMeetingsUpcoming) })} icon={<CalendarCheck2 className="size-5" />} tone="gold" testId="kpi-parent-meetings" />
            <StatCard label={t("kpi.activeUsers")} value={n(k.activeUsers)} hint={t("kpi.activeUsersHint", { n: n(k.accounts) })} icon={<Users className="size-5" />} testId="kpi-active-users" />
            <StatCard label={t("kpi.setup")} value={t("kpi.setupValue", { done: n(k.onboardingCompleted), total: n(k.schools) })} hint={t("kpi.setupHint")} icon={<ListChecks className="size-5" />} tone="success" testId="kpi-setup" />
            <StatCard label={t("kpi.plansApproved")} value={n(k.plansApproved)} hint={t("kpi.plansHint", { n: n(k.plansProposed) })} icon={<GraduationCap className="size-5" />} tone="info" testId="kpi-plans" />
            <StatCard label={t("kpi.applications")} value={n(k.applicationsTotal)} hint={t("kpi.applicationsHint", { n: n(k.applications.OFFER + k.applications.ACCEPTED + k.applications.ENROLLED) })} icon={<Send className="size-5" />} tone="gold" testId="kpi-applications" />
          </div>

          <Panel padded={false}>
            <div className="p-5 pb-0">
              <PanelHeader title={t("bySchool")} description={t("bySchoolHint")} icon={<Building2 className="size-4" />} />
            </div>
            {/* Desktop: one row per school */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm" data-testid="group-school-table">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{t("col.school")}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t("col.students")}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t("col.open")}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t("col.turnaround")}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t("col.overdue")}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t("col.meetings")}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t("col.active")}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{t("col.setup")}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t("col.career")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">
                      <span className="sr-only">{t("col.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.schools.map((s) => {
                    const sk = s.kpis;
                    const apps = Object.values(sk.applications).reduce((a, b) => a + (b ?? 0), 0);
                    return (
                      <tr key={s.orgId} data-testid={`group-school-row-${s.orgId}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{schoolName(s)}</div>
                          <div className="text-xs text-muted-foreground">{t("emirateJoined", { emirate: emirateLabel(s.emirate), via: t(`via.${s.via === "invite" ? "invite" : "platform"}`) })}</div>
                        </td>
                        <td className="px-3 py-3 text-end tabular-nums">{n(sk.students)}</td>
                        <td className="px-3 py-3 text-end tabular-nums">{n(sk.openRequests)}</td>
                        <td className="px-3 py-3 text-end tabular-nums">{hrs(avgTurnaround(sk))}</td>
                        <td className="px-3 py-3 text-end tabular-nums">
                          <span className={sk.overdueRequests + sk.overdueTasks ? "font-medium text-warning" : undefined}>{n(sk.overdueRequests + sk.overdueTasks)}</span>
                        </td>
                        <td className="px-3 py-3 text-end tabular-nums">{t("heldUpcoming", { held: n(sk.parentMeetingsHeld), upcoming: n(sk.parentMeetingsUpcoming) })}</td>
                        <td className="px-3 py-3 text-end tabular-nums">{t("ofTotal", { n: n(sk.activeUsers), total: n(sk.accounts) })}</td>
                        <td className="px-3 py-3">
                          {sk.onboarding.completed ? <Pill tone="success">{t("setupDone")}</Pill> : <Pill tone="warning">{t("setupSteps", { done: n(sk.onboarding.done), total: n(sk.onboarding.total) })}</Pill>}
                        </td>
                        <td className="px-3 py-3 text-end tabular-nums">{apps || sk.plansApproved ? t("plansApps", { plans: sk.plansApproved, apps }) : <span className="text-muted-foreground">{t("noCareer")}</span>}</td>
                        <td className="px-4 py-3 text-end">
                          <OpenSchoolButton orgId={s.orgId} canOpen={s.canOpen} schoolName={schoolName(s)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Phone: one card per school */}
            <ul className="divide-y border-t md:hidden" role="list">
              {data.schools.map((s) => {
                const sk = s.kpis;
                const apps = Object.values(sk.applications).reduce((a, b) => a + (b ?? 0), 0);
                const cell = (label: string, value: string) => (
                  <div className="min-w-0">
                    <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                );
                return (
                  <li key={s.orgId} className="space-y-3 p-4" data-testid={`group-school-card-${s.orgId}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{schoolName(s)}</div>
                        <div className="text-xs text-muted-foreground">{emirateLabel(s.emirate)}</div>
                      </div>
                      {sk.onboarding.completed ? <Pill tone="success">{t("setupDone")}</Pill> : <Pill tone="warning">{t("setupSteps", { done: n(sk.onboarding.done), total: n(sk.onboarding.total) })}</Pill>}
                    </div>
                    <dl className="grid grid-cols-3 gap-3 text-sm">
                      {cell(t("col.open"), n(sk.openRequests))}
                      {cell(t("col.turnaround"), hrs(avgTurnaround(sk)))}
                      {cell(t("col.overdue"), n(sk.overdueRequests + sk.overdueTasks))}
                      {cell(t("col.meetings"), t("heldUpcoming", { held: n(sk.parentMeetingsHeld), upcoming: n(sk.parentMeetingsUpcoming) }))}
                      {cell(t("col.active"), t("ofTotal", { n: n(sk.activeUsers), total: n(sk.accounts) }))}
                      {cell(t("col.career"), apps || sk.plansApproved ? t("plansApps", { plans: sk.plansApproved, apps }) : t("noCareer"))}
                    </dl>
                    <OpenSchoolButton orgId={s.orgId} canOpen={s.canOpen} schoolName={schoolName(s)} />
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader title={t("serviceUsage")} description={t("serviceUsageHint", { days: GROUP_WINDOW_DAYS })} />
              <BarList rows={k.serviceUsage.map((s) => ({ label: pick(locale, s.nameEn, s.nameAr), value: s.count }))} format={n} empty={t("noData")} />
            </Panel>
            <Panel>
              <PanelHeader title={t("applicationsByStage")} description={t("applicationsByStageHint")} />
              <BarList rows={APPLICATION_STAGES.filter((st) => k.applications[st] > 0).map((st) => ({ label: tStage(st), value: k.applications[st] }))} format={n} empty={t("noCareerData")} />
            </Panel>
          </div>
        </>
      )}
    </PageBody>
  );
}
