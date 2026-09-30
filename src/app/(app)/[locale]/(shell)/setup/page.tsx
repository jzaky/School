import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Building2, CalendarRange, Check, CircleDashed, Clock, Contact, FileSpreadsheet, GraduationCap, KeyRound, Layers, Lock, MailPlus, PartyPopper, ShieldCheck, SkipForward, UserCheck, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { canSetup } from "@/server/onboarding/access";
import { schoolVerified } from "@/server/onboarding/verification";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { enabledOptionalModules, moduleEnabled } from "@/lib/modules";
import { ACCESS_PAGES, ACCESS_PAGES_LIVE, isSetupStep, SETUP_STEPS, setupProgress, stepState, WORK_STEPS, type SetupStep } from "@/lib/onboarding";
import { STAFF_ROLE_KEYS } from "@/server/identity/permissions";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AddHolidaysButton, ContinueFooter, CurriculaStepForm, FinishButton, ModulesStepForm, ProfileStepForm, YearStepForm } from "@/components/onboarding/setup-forms";
import { EventDeleteButton } from "@/components/calendar-admin/event-dialog";
import { BellEditor } from "@/components/timetable/bell-editor";
import { dayName } from "@/components/timetable/day-name";
import { AddStaffDialog } from "@/components/admin/people/staff-forms";
import { AddStudentDialog } from "@/components/admin/people/student-forms";
import { CsvImporter } from "@/components/admin/people/csv-import";

export async function generateMetadata() {
  const t = await getTranslations("onboarding.setup");
  return { title: t("metaTitle") };
}

const ICONS: Record<SetupStep, React.ComponentType<{ className?: string }>> = {
  profile: Building2,
  year: CalendarRange,
  curricula: GraduationCap,
  modules: Layers,
  people: Users,
  invite: MailPlus,
  done: PartyPopper,
};

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const ctx = await getCtx();
  if (!canSetup(ctx)) notFound();
  const sp = await searchParams;
  const t = await getTranslations("onboarding.setup");
  const { org, locale } = ctx;
  const progress = setupProgress(org.onboardingSteps);
  const step: SetupStep = isSetupStep(sp.step) ? sp.step : org.onboardingCompletedAt ? "done" : progress.next;
  const verified = await schoolVerified(org, ctx.user);
  const Icon = ICONS[step];

  return (
    <PageBody className="max-w-6xl">
      <PageHeader eyebrow={t("eyebrow")} title={t("title", { school: pick(locale, org.nameEn, org.nameAr) })} description={t("subtitle")} />
      <div className="space-y-2" data-testid="setup-progress">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("progress", { done: progress.done, total: progress.total })}</span>
          <span>{t("resumeHint")}</span>
        </div>
        <Progress value={progress.percent} aria-label={t("progress", { done: progress.done, total: progress.total })} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label={t("stepsLabel")} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <ol className="flex gap-2 lg:flex-col lg:gap-1">
            {SETUP_STEPS.map((k, i) => {
              const state = k === "done" ? (org.onboardingCompletedAt ? "done" : "todo") : stepState(org.onboardingSteps, k);
              const active = k === step;
              return (
                <li key={k} className="shrink-0">
                  <Link
                    href={`/setup?step=${k}`}
                    aria-current={active ? "step" : undefined}
                    data-testid={`setup-nav-${k}`}
                    className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-brand-soft font-medium text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                  >
                    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-xs", state === "done" && "border-success bg-success text-white", state === "skipped" && "border-dashed")}>
                      {state === "done" ? <Check className="size-3.5" /> : state === "skipped" ? <SkipForward className="size-3" /> : fmtNumber({ locale }, i + 1)}
                    </span>
                    <span className="whitespace-nowrap">{t(`steps.${k}.nav`)}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <Panel className="min-w-0">
          <PanelHeader title={t(`steps.${step}.title`)} description={t(`steps.${step}.body`)} icon={<Icon className="size-4" />} />
          {await renderStep(step)}
        </Panel>
      </div>
    </PageBody>
  );

  async function renderStep(s: SetupStep) {
    const { db } = ctx;
    const prefs = await formatPrefs(ctx);
    if (s === "profile") {
      return (
        <ProfileStepForm
          hasLogo={Boolean(org.logoUrl)}
          initial={{
            nameEn: org.nameEn,
            nameAr: org.nameAr,
            shortNameEn: org.shortNameEn ?? "",
            shortNameAr: org.shortNameAr ?? "",
            primaryColor: org.primaryColor,
            accentColor: org.accentColor,
            defaultLocale: org.defaultLocale,
            weekDays: org.weekDays,
            timezone: org.timezone,
            regulator: org.regulator,
            emirate: org.emirate,
            hijriEnabled: org.hijriEnabled,
            numerals: org.numerals,
          }}
        />
      );
    }
    if (s === "year") {
      const year = await db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: { orderBy: { startsOn: "asc" } } } });
      if (!year) return <p className="text-sm text-muted-foreground">{t("year.noYear")}</p>;
      const holidays = await db.calendarEvent.findMany({ where: { kind: "HOLIDAY", startsAt: { gte: year.startsOn, lte: year.endsOn } }, orderBy: { startsAt: "asc" } });
      const periods = moduleEnabled(org, "timetable") ? await db.bellPeriod.findMany({ where: { academicYearId: year.id }, orderBy: [{ dayOfWeek: "asc" }, { periodNo: "asc" }] }) : [];
      const slotCount = moduleEnabled(org, "timetable") ? await db.timetableSlot.count({ where: { academicYearId: year.id } }) : 0;
      const days = (org.weekDays.length ? org.weekDays : [1, 2, 3, 4, 5]).map((d) => ({ day: d, name: dayName(locale, d) }));
      return (
        <div className="space-y-8">
          <YearStepForm
            year={{
              id: year.id,
              nameEn: year.nameEn,
              nameAr: year.nameAr,
              startsOn: dateKey(year.startsOn),
              endsOn: dateKey(year.endsOn),
              terms: year.terms.map((x) => ({ id: x.id, nameEn: x.nameEn, nameAr: x.nameAr, startsOn: dateKey(x.startsOn), endsOn: dateKey(x.endsOn) })),
            }}
          />
          <section className="space-y-3" data-testid="holidays">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{t("year.holidays")}</h3>
                <p className="text-xs text-muted-foreground">{t("year.holidaysHint")}</p>
              </div>
              {ctx.can("calendar.manage") && <AddHolidaysButton />}
            </div>
            {holidays.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{t("year.noHolidays")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{pick(locale, h.titleEn, h.titleAr)}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(prefs, h.startsAt, "medium")}
                        {(h.descEn ?? "").startsWith("Estimated") && <span className="ms-2">{t("year.estimated")}</span>}
                      </p>
                    </div>
                    {ctx.can("calendar.manage") && <EventDeleteButton id={h.id} title={pick(locale, h.titleEn, h.titleAr)} />}
                  </li>
                ))}
              </ul>
            )}
            {ctx.can("calendar.manage") && (
              <Link href="/admin/calendar" className="inline-block text-sm font-medium text-brand hover:underline">
                {t("year.editCalendar")}
              </Link>
            )}
          </section>
          <section className="space-y-3" data-testid="bell-schedule">
            <h3 className="text-sm font-semibold">{t("year.bell")}</h3>
            {moduleEnabled(org, "timetable") && ctx.can("timetable.manage") ? (
              <BellEditor days={days} periods={periods.map((p) => ({ day: p.dayOfWeek, periodNo: p.periodNo, startTime: p.startTime, endTime: p.endTime, kind: p.kind }))} hasLessons={slotCount > 0} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("year.bellOff")}</p>
            )}
          </section>
        </div>
      );
    }
    if (s === "curricula") {
      const courses = await db.schoolCourse.findMany({ select: { courseId: true } });
      const catalog = courses.length ? await db.curriculumCourse.findMany({ where: { id: { in: courses.map((c) => c.courseId) } }, select: { curriculum: true } }) : [];
      const counts = new Map<string, number>();
      for (const c of catalog) counts.set(c.curriculum, (counts.get(c.curriculum) ?? 0) + 1);
      const tc = await getTranslations("onboarding.curricula");
      const canCatalog = moduleEnabled(org, "pathways") && ctx.can("pathways.manage");
      return (
        <div className="space-y-6">
          <CurriculaStepForm initial={org.curricula} />
          <div className="rounded-lg border bg-muted/40 p-4 text-sm" data-testid="course-counts">
            <p className="font-medium">{t("curricula.catalogTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("curricula.catalogBody")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {counts.size === 0 ? <span className="text-xs text-muted-foreground">{t("curricula.noCourses")}</span> : [...counts].map(([k, n]) => <Pill key={k}>{t("curricula.count", { name: tc(k), n })}</Pill>)}
            </div>
            {canCatalog && (
              <Link href="/career/pathways/catalog" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
                {t("curricula.editCatalog")}
              </Link>
            )}
          </div>
        </div>
      );
    }
    if (s === "modules") return <ModulesStepForm initial={enabledOptionalModules(org)} />;
    if (s === "people") {
      const staffBase = { student: { is: null }, guardian: { is: null }, roles: { some: { role: { key: { in: STAFF_ROLE_KEYS } } } } } as const;
      const [staff, students, guardians, roles, departments, guardianRows] = await Promise.all([
        db.membership.count({ where: staffBase }),
        db.student.count(),
        db.guardian.count(),
        db.role.findMany({ orderBy: { nameEn: "asc" } }),
        db.department.findMany({ orderBy: { nameEn: "asc" } }),
        db.guardian.findMany({ orderBy: [{ lastNameEn: "asc" }, { firstNameEn: "asc" }], take: 1000 }),
      ]);
      const canPeople = ctx.can("people.manage");
      const roleOptions = roles.filter((r) => STAFF_ROLE_KEYS.includes(r.key)).map((r) => ({ key: r.key, label: pick(locale, r.nameEn, r.nameAr), description: pick(locale, r.descEn, r.descAr) }));
      const deptOptions = departments.map((d) => ({ id: d.id, label: pick(locale, d.nameEn, d.nameAr) }));
      const guardianOptions = guardianRows.map((g) => ({ value: g.id, label: personName(g, locale), hint: g.email ?? undefined, keywords: `${g.firstNameEn} ${g.lastNameEn} ${g.firstNameAr} ${g.lastNameAr} ${g.email ?? ""}` }));
      return (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { k: "staff", n: staff, icon: Contact },
              { k: "students", n: students, icon: GraduationCap },
              { k: "guardians", n: guardians, icon: Users },
            ].map((x) => (
              <div key={x.k} className="rounded-lg border p-4" data-testid={`count-${x.k}`}>
                <x.icon className="size-4 text-muted-foreground" />
                <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtNumber(prefs, x.n)}</p>
                <p className="text-xs text-muted-foreground">{t(`people.${x.k}`)}</p>
              </div>
            ))}
          </div>
          {canPeople ? (
            <>
              <div className="flex flex-wrap gap-2">
                <AddStaffDialog roles={roleOptions} departments={deptOptions} canAssignAdmin={ctx.can("school.manage")} />
                <AddStudentDialog guardians={guardianOptions} />
                <Button variant="ghost" asChild>
                  <Link href="/admin/people">{t("people.openPeople")}</Link>
                </Button>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-brand/20 bg-brand-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="setup-import-center">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-brand" />
                  <div>
                    <h3 className="text-sm font-semibold">{t("people.importCenterTitle")}</h3>
                    <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{t("people.importCenterBody")}</p>
                  </div>
                </div>
                {ctx.can("admin.access") ? (
                  <Button asChild className="shrink-0">
                    <Link href="/admin/import">{t("people.openImportCenter")}</Link>
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">{t("people.importTitle")}</h3>
                    <CsvImporter />
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              <Lock className="size-4 shrink-0" />
              {t("people.noPermission")}
            </p>
          )}
          <ContinueFooter step="people" />
        </div>
      );
    }
    if (s === "invite") {
      const cards = [
        { key: "staffInvites", href: ACCESS_PAGES.invitations, icon: MailPlus, locked: !verified, perm: ctx.can("people.invite") },
        { key: "familyCode", href: ACCESS_PAGES.invitations, icon: KeyRound, locked: !verified, perm: ctx.can("people.invite") },
        { key: "joinRequests", href: ACCESS_PAGES.joinRequests, icon: UserCheck, locked: !verified, perm: ctx.can("people.invite") },
        { key: "roles", href: ACCESS_PAGES.roles, icon: ShieldCheck, locked: false, perm: ctx.can("roles.manage") },
      ].filter((c) => c.perm);
      return (
        <div className="space-y-6">
          {!verified && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/50 p-4 text-sm" data-testid="invite-locked">
              <Lock className="mt-0.5 size-4 shrink-0" />
              {t("invite.locked")}
            </p>
          )}
          {org.joinCode && (
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{t("invite.joinCode")}</p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.2em]" dir="ltr" data-testid="join-code">
                {verified ? org.joinCode : "••••••••"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{verified ? t("invite.joinCodeHint") : t("invite.joinCodeLocked")}</p>
            </div>
          )}
          {ACCESS_PAGES_LIVE && (
            <div className="grid gap-3 sm:grid-cols-2">
              {cards.map((c) => (
                <div key={c.key} className={cn("flex flex-col rounded-lg border p-4", c.locked && "opacity-70")}>
                  <c.icon className="size-5 text-brand" />
                  <p className="mt-2 text-sm font-medium">{t(`invite.cards.${c.key}.title`)}</p>
                  <p className="mt-1 flex-1 text-xs text-muted-foreground">{t(`invite.cards.${c.key}.body`)}</p>
                  {c.locked ? (
                    <Button size="sm" variant="outline" className="mt-3 w-fit" disabled title={t("invite.lockedShort")}>
                      <Lock className="size-3.5" />
                      {t("invite.lockedShort")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="mt-3 w-fit" asChild>
                      <Link href={c.href}>{t(`invite.cards.${c.key}.cta`)}</Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <ContinueFooter step="invite" />
        </div>
      );
    }
    // Done: a checklist with a way back to every step and the admin page that owns it.
    const admin: Record<Exclude<SetupStep, "done">, string> = { profile: "/admin/school", year: "/admin/calendar", curricula: "/setup?step=curricula", modules: "/setup?step=modules", people: "/admin/people", invite: ACCESS_PAGES.invitations };
    return (
      <div className="space-y-6">
        <ul className="divide-y rounded-lg border" data-testid="setup-checklist">
          {WORK_STEPS.map((k) => {
            const state = stepState(org.onboardingSteps, k);
            return (
              <li key={k} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {state === "done" ? <Check className="size-4 shrink-0 text-success" /> : state === "skipped" ? <SkipForward className="size-4 shrink-0 text-muted-foreground" /> : <CircleDashed className="size-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t(`steps.${k}.nav`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`done.state.${state}`)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/setup?step=${k}`}>{state === "done" ? t("done.review") : t("done.finish")}</Link>
                  </Button>
                  {(k !== "invite" || ACCESS_PAGES_LIVE) && !admin[k].startsWith("/setup") && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={admin[k]}>{t("done.editLater")}</Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col items-start gap-3 rounded-lg bg-brand-soft/60 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 size-4 shrink-0 text-brand" />
            <p className="text-sm">{org.onboardingCompletedAt ? t("done.completed", { date: fmtDate(prefs, org.onboardingCompletedAt, "medium") }) : t("done.ready")}</p>
          </div>
          <FinishButton />
        </div>
      </div>
    );
  }
}
