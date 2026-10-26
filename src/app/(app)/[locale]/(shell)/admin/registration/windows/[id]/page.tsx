import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, Download, HandHelping, School, Sparkles, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { gradeLevelValues } from "@/lib/grade-levels";
import { gradeRuns, windowState } from "@/lib/selection-window";
import { currentYear, registrationYear } from "@/server/registration/service";
import { getSelectionSettings, sessionActive, windowCohort, type ProgressStatus } from "@/server/registration/selection";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { RemindButton } from "@/components/registration/window-controls";
import { RevokeExceptionButton, RevokeHelperButton, StatusPill } from "@/components/registration/assist-controls";

export async function generateMetadata() {
  const t = await getTranslations("selection.overview");
  return { title: t("title") };
}

const STATUSES: ProgressStatus[] = ["not_started", "in_progress", "submitted", "signed_off"];
const BAR: Record<ProgressStatus, string> = { signed_off: "bg-success", submitted: "bg-info", in_progress: "bg-warning", not_started: "bg-muted-foreground/25" };

export default async function WindowOverviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ grade?: string; homeroom?: string; status?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("registration.manage")) notFound();
  const t = await getTranslations("selection.overview");
  const tw = await getTranslations("selection.windows");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { orgId, locale } = ctx;
  const now = new Date();

  const data = await tenantTx(
    orgId,
    async (tx) => {
      const w = await tx.courseSelectionWindow.findFirst({ where: { orgId, id } });
      if (!w) return null;
      const target = await registrationYear(tx, orgId, w.academicYearId);
      const cohort = await windowCohort(tx, orgId, w);
      const ids = cohort.map((s) => s.id);
      const year = await currentYear(tx, orgId);
      const [homerooms, helpers, exceptions, settings] = await Promise.all([
        year ? tx.enrollment.findMany({ where: { orgId, studentId: { in: ids }, class: { academicYearId: year.id, isHomeroom: true } }, include: { class: true } }) : [],
        tx.courseSelectionHelper.findMany({ where: { orgId, studentId: { in: ids }, revokedAt: null, until: { gt: now } }, orderBy: { createdAt: "desc" } }),
        tx.courseSelectionException.findMany({ where: { orgId, studentId: { in: ids }, academicYearId: w.academicYearId, revokedAt: null, until: { gt: now } }, orderBy: { createdAt: "desc" } }),
        getSelectionSettings(tx, orgId),
      ]);
      const classIds = [...new Set(homerooms.map((h) => h.classId))];
      const sessions = await tx.courseSelectionSession.findMany({ where: { orgId, classId: { in: classIds }, academicYearId: w.academicYearId, endedAt: null, endsAt: { gt: now } } });
      const memberIds = [...new Set([...helpers.flatMap((h) => [h.helperId, h.grantedById]), ...exceptions.map((e) => e.grantedById), ...cohort.map((s) => s.progress.submission?.lastById ?? ""), ...homerooms.map((h) => h.class.teacherMembershipId ?? ""), ...sessions.map((s) => s.startedById)].filter(Boolean))];
      const members = memberIds.length ? await tx.membership.findMany({ where: { orgId, id: { in: memberIds } }, include: { user: { select: { nameEn: true, nameAr: true } }, guardian: true, student: true } }) : [];
      return { w, target, cohort, homerooms, helpers, exceptions, sessions: sessions.filter((s) => sessionActive(s, now)), members, settings };
    },
    { timeout: 60_000 },
  );
  if (!data) notFound();
  const { w, cohort, settings } = data;
  const nameOf = (mid: string | null | undefined) => {
    const m = data.members.find((x) => x.id === mid);
    if (!m) return "";
    const p = m.guardian ?? m.student;
    return p ? personName(p, locale) : userName(m.user, locale);
  };
  const homeroomOf = new Map(data.homerooms.map((h) => [h.studentId, h.class]));
  const studentName = new Map(cohort.map((s) => [s.id, personName(s, locale)]));
  const state = windowState(w, now);
  const gradesText = gradeRuns(w.gradeLevels)
    .map(([a, b]) => (a === b ? tg("label", gradeLevelValues(a)) : tw("gradeSpan", { from: tg("label", gradeLevelValues(a)), to: tg("label", gradeLevelValues(b)) })))
    .join(locale === "ar" ? "، " : ", ");
  const round = pick(locale, w.roundEn, w.roundAr);
  const yearName = data.target ? `⁦${pick(locale, data.target.year.nameEn, data.target.year.nameAr)}⁩` : "";
  const statuses = settings.signOffRequired ? STATUSES : STATUSES.filter((s) => s !== "signed_off");
  const count = (list: typeof cohort, s: ProgressStatus) => list.filter((x) => x.progress.status === s).length;
  const unfinished = cohort.filter((s) => s.progress.status === "not_started" || s.progress.status === "in_progress");

  // Filters (grade, homeroom, status) from the URL.
  const grade = sp.grade && /^-?\d{1,2}$/.test(sp.grade) ? Number(sp.grade) : null;
  const status = STATUSES.includes(sp.status as ProgressStatus) ? (sp.status as ProgressStatus) : null;
  const homeroom = sp.homeroom ?? null;
  const filtered = cohort
    .filter((s) => (grade === null || s.gradeLevel === grade) && (!homeroom || homeroomOf.get(s.id)?.id === homeroom) && (!status || s.progress.status === status))
    .sort((a, b) => a.gradeLevel - b.gradeLevel || (homeroomOf.get(a.id)?.nameEn ?? "").localeCompare(homeroomOf.get(b.id)?.nameEn ?? "") || personName(a, locale).localeCompare(personName(b, locale), locale));
  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { grade: grade === null ? null : String(grade), homeroom, status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/registration/windows/${w.id}${s ? `?${s}` : ""}`;
  };
  // Progress by homeroom (students without a homeroom are grouped by grade).
  const groups = new Map<string, { key: string; label: string; teacher: string; grade: number; list: typeof cohort }>();
  for (const s of cohort) {
    const cls = homeroomOf.get(s.id);
    const key = cls?.id ?? `grade:${s.gradeLevel}`;
    if (!groups.has(key)) groups.set(key, { key, label: cls ? pick(locale, cls.nameEn, cls.nameAr) : t("noHomeroom", { grade: tg("label", gradeLevelValues(s.gradeLevel)) }), teacher: cls ? nameOf(cls.teacherMembershipId) : "", grade: s.gradeLevel, list: [] });
    groups.get(key)!.list.push(s);
  }
  const groupList = [...groups.values()].sort((a, b) => a.grade - b.grade || a.label.localeCompare(b.label, locale));
  const yearParam = data.target?.next ? "next" : "current";
  const activeSessions = data.sessions;

  return (
    <PageBody>
      <div>
        <Link href="/admin/registration/windows" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("back")}
        </Link>
      </div>
      <PageHeader
        eyebrow={yearName}
        title={round ? t("titleRound", { grades: gradesText, round }) : gradesText}
        description={t("subtitle", { opens: fmtDateTime(prefs, w.opensAt), closes: fmtDateTime(prefs, w.closesAt) })}
        actions={
          <>
            {state === "open" && <RemindButton windowId={w.id} count={unfinished.length} />}
            <Button asChild variant="outline">
              <a href={`/api/registration/windows/${w.id}/export`} data-testid="export-csv">
                <Download className="size-4" />
                {t("export")}
              </a>
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={state === "open" ? "success" : state === "upcoming" ? "brand" : "neutral"} dot>
          {tw(`state.${state}`)}
        </Pill>
        <span className="text-muted-foreground">{t("cohort", { count: cohort.length })}</span>
      </div>
      <div className={cn("grid grid-cols-2 gap-3", statuses.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {statuses.map((s) => (
          <StatCard key={s} label={t(`stat.${s}`)} value={fmtNumber(prefs, count(cohort, s))} tone={s === "signed_off" ? "success" : s === "submitted" ? "info" : s === "in_progress" ? "warning" : "brand"} href={q({ status: status === s ? null : s })} testId={`stat-${s}`} />
        ))}
      </div>

      {cohort.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title={t("emptyCohort")} body={t("emptyCohortBody")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <Panel>
              <PanelHeader title={t("byHomeroom")} icon={<School className="size-4" />} />
              <ul className="divide-y" data-testid="homeroom-progress">
                {groupList.map((g) => {
                  const done = g.list.filter((s) => s.progress.status === "submitted" || s.progress.status === "signed_off").length;
                  return (
                    <li key={g.key} className="py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <Link href={q({ homeroom: g.key.startsWith("grade:") ? null : g.key, grade: g.key.startsWith("grade:") ? String(g.grade) : null })} className="min-w-0 font-medium hover:text-brand">
                          {g.label}
                          {g.teacher && <span className="ms-1.5 text-xs font-normal text-muted-foreground">{g.teacher}</span>}
                        </Link>
                        <span className="text-xs tabular-nums text-muted-foreground">{t("doneOf", { done: fmtNumber(prefs, done), total: fmtNumber(prefs, g.list.length) })}</span>
                      </div>
                      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        {[...statuses].reverse().map((s) => {
                          const n = count(g.list, s);
                          return n ? <div key={s} className={BAR[s]} style={{ width: `${(n / g.list.length) * 100}%` }} /> : null;
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {statuses.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <span className={cn("size-2 rounded-full", BAR[s])} />
                    {t(`stat.${s}`)}
                  </span>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={t("students")} description={t("studentsBody", { count: filtered.length })} icon={<Users className="size-4" />} />
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap gap-1.5" data-testid="filter-grade">
                  <Link href={q({ grade: null, homeroom: null })} className={cn("rounded-full border px-3 py-1 text-xs font-medium", grade === null && !homeroom ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
                    {t("allGrades")}
                  </Link>
                  {[...new Set(cohort.map((s) => s.gradeLevel))].sort((a, b) => a - b).map((g) => (
                    <Link key={g} href={q({ grade: String(g), homeroom: null })} className={cn("rounded-full border px-3 py-1 text-xs font-medium", grade === g ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
                      {tg("label", gradeLevelValues(g))}
                    </Link>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" data-testid="filter-status">
                  {statuses.map((s) => (
                    <Link key={s} href={q({ status: status === s ? null : s })} className={cn("rounded-full border px-3 py-1 text-xs font-medium", status === s ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")}>
                      {t(`stat.${s}`)}
                    </Link>
                  ))}
                  {homeroom && (
                    <Link href={q({ homeroom: null })} className="rounded-full border border-brand bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
                      {groupList.find((g) => g.key === homeroom)?.label} ×
                    </Link>
                  )}
                </div>
              </div>
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
              ) : (
                <ul className="divide-y" data-testid="student-progress">
                  {filtered.slice(0, 300).map((s) => {
                    const cls = homeroomOf.get(s.id);
                    const sub = s.progress.submission;
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-testid="student-row">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{personName(s, locale)}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[cls ? pick(locale, cls.nameEn, cls.nameAr) : tg("label", gradeLevelValues(s.gradeLevel)), t("blocks", { chosen: s.progress.chosen, total: s.progress.blocks })].join(" · ")}
                            {sub?.onBehalf && sub.lastById ? ` · ${t("by", { name: nameOf(sub.lastById) })}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {sub?.afterClose && <Pill tone="warning">{t("afterClose")}</Pill>}
                          <StatusPill status={s.progress.status} />
                          <Link href={`/subjects?student=${s.id}&year=${yearParam}`} className="text-xs font-medium text-brand hover:underline">
                            {t("open")}
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel>
              <PanelHeader title={t("exceptions")} description={t("exceptionsBody")} icon={<Sparkles className="size-4" />} />
              {data.exceptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noExceptions")}</p>
              ) : (
                <ul className="divide-y" data-testid="active-exceptions">
                  {data.exceptions.map((e) => (
                    <li key={e.id} className="space-y-0.5 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{studentName.get(e.studentId)}</span>
                        <RevokeExceptionButton id={e.id} />
                      </div>
                      <div className="text-xs text-muted-foreground">{t("exceptionLine", { by: nameOf(e.grantedById), date: fmtDateTime(prefs, e.until) })}</div>
                      <div className="text-xs text-muted-foreground">{e.reason}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel>
              <PanelHeader title={t("assisted")} description={t("assistedBody")} icon={<HandHelping className="size-4" />} />
              {data.helpers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noAssisted")}</p>
              ) : (
                <ul className="divide-y" data-testid="active-helpers">
                  {data.helpers.map((h) => (
                    <li key={h.id} className="space-y-0.5 py-2.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{t("helperLine", { helper: nameOf(h.helperId), student: studentName.get(h.studentId) ?? "" })}</span>
                        <RevokeHelperButton id={h.id} name={nameOf(h.helperId)} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {h.byStudent ? t("grantedByStudent", { date: fmtDateTime(prefs, h.until) }) : t("grantedBy", { by: nameOf(h.grantedById), date: fmtDateTime(prefs, h.until) })}
                        {h.kind === "GUARDIAN" && <span> · {t("parent")}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel>
              <PanelHeader title={t("sessions")} description={t("sessionsBody")} icon={<School className="size-4" />} />
              {activeSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noSessions")}</p>
              ) : (
                <ul className="divide-y">
                  {activeSessions.map((s) => {
                    const cls = data.homerooms.find((h) => h.classId === s.classId)?.class;
                    return (
                      <li key={s.id} className="py-2.5 text-sm">
                        <Link href={`/subjects/session/${s.id}`} className="font-medium hover:text-brand">
                          {cls ? pick(locale, cls.nameEn, cls.nameAr) : ""}
                        </Link>
                        <div className="text-xs text-muted-foreground">{t("sessionLine", { by: nameOf(s.startedById), date: fmtDateTime(prefs, s.endsAt) })}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </PageBody>
  );
}
