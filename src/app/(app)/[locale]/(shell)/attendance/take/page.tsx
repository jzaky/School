import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowLeftRight, CalendarClock, CalendarOff, Check, Eye, Info, Lock, ShieldCheck } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtTime } from "@/lib/format";
import { initials, personName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { RegisterTaker } from "@/components/attendance/register-taker";
import { CloseRegisterButton } from "@/components/attendance/close-register-button";
import { attViewer, loadRegister, seesReasons } from "@/server/attendance/registers";
import { localClock, toMin } from "@/server/attendance/settings";
import { keyToDate } from "@/server/timetable/cover";
import { fromMinutes } from "@/server/timetable/bell";

export async function generateMetadata() {
  const t = await getTranslations("attendance.take");
  return { title: t("title") };
}

type SP = { class?: string; date?: string; period?: string };

export default async function TakeRegisterPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.isStaff || !sp.class) notFound();
  const t = await getTranslations("attendance.take");
  const prefs = await formatPrefs(ctx);
  const v = attViewer(ctx);
  const now = new Date();
  const clock = localClock(now, v.timezone);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : clock.dateKey;
  const periodNo = /^\d{1,2}$/.test(sp.period ?? "") ? Number(sp.period) : 0;
  const view = await loadRegister(v, { classId: sp.class, date, periodNo }, now);
  if (!view) notFound();
  const { locale } = ctx;
  const manager = view.role === "manager";
  const external = view.mode === "EXTERNAL";
  const canEdit = !external && !view.holiday && view.role !== null && view.window !== "future" && (view.window !== "closed" || manager);
  const lateAllowed = view.window === "open" || manager;
  const cutoff = fromMinutes(toMin(view.start) + view.lateCutoffMin);
  const takenBy = view.takenById ? await ctx.db.membership.findUnique({ where: { id: view.takenById }, select: { user: { select: { nameEn: true, nameAr: true } } } }) : null;
  const reasons = seesReasons(v);
  const codes = view.codes.map((c) => ({ code: c.code, label: pick(locale, c.labelEn, c.labelAr), countsAs: c.countsAs, late: c.late, authorised: c.authorised, quick: c.quick, active: c.active }));
  const subtitle = [
    view.kind === "DAILY" ? t("dailyRegister") : view.cls.subject ? pick(locale, view.cls.subject.nameEn, view.cls.subject.nameAr) : t("lesson"),
    fmtDate(prefs, keyToDate(date), "long"),
  ].join(" · ");

  return (
    <PageBody className="max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href={`/attendance?date=${date}`}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("back")}
        </Link>
      </Button>
      <PageHeader
        title={pick(locale, view.cls.nameEn, view.cls.nameAr)}
        description={subtitle}
        actions={manager && !external ? <CloseRegisterButton regRef={view.ref} closed={!!view.closedAt} /> : undefined}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="register-meta">
        <Pill tone="neutral">
          <CalendarClock className="size-3" />
          <span dir="ltr">{view.end ? `${view.start} - ${view.end}` : view.start}</span>
        </Pill>
        {view.cls.room && <Pill tone="neutral">{t("roomN", { room: view.cls.room })}</Pill>}
        {view.isCover && <Pill tone="violet">{t("coverBadge")}</Pill>}
        {view.takenAt ? (
          <Pill tone="success">
            <Check className="size-3" />
            {takenBy ? t("takenBy", { name: pick(locale, takenBy.user.nameEn, takenBy.user.nameAr), time: fmtTime(prefs, view.takenAt) }) : t("takenAt", { time: fmtTime(prefs, view.takenAt) })}
          </Pill>
        ) : (
          <Pill tone="warning">{t("notTakenYet")}</Pill>
        )}
        {view.closedAt && (
          <Pill tone="neutral">
            <Lock className="size-3" />
            {t("closedAt", { time: fmtTime(prefs, view.closedAt) })}
          </Pill>
        )}
        {reasons ? (
          <Pill tone="violet">
            <ShieldCheck className="size-3" />
            {t("youSeeReasons")}
          </Pill>
        ) : (
          <Pill tone="neutral">
            <Lock className="size-3" />
            {t("reasonsPrivate")}
          </Pill>
        )}
      </div>

      <Banner />

      {view.holiday ? (
        <EmptyState icon={<CalendarOff className="size-5" />} title={t("holidayTitle")} body={t("holidayBody")} />
      ) : view.students.length === 0 ? (
        <EmptyState icon={<Info className="size-5" />} title={t("noStudents")} body={t("noStudentsBody")} />
      ) : (
        <RegisterTaker
          queueKey={`att-queue:${ctx.orgId}:${view.ref.classId}:${date}:${periodNo}`}
          regRef={view.ref}
          students={view.students.map((s) => ({
            id: s.id,
            name: personName(s, locale),
            studentNo: s.studentNo,
            initials: initials(`${s.firstNameEn} ${s.lastNameEn}`),
            mark: s.mark ? { code: s.mark.code, minutesLate: s.mark.minutesLate, masked: s.mark.masked, fromReport: s.mark.fromReport } : null,
            prefill: s.prefill,
          }))}
          codes={codes}
          canEdit={canEdit}
          lateAllowed={lateAllowed}
          lateCutoff={cutoff}
          startMin={toMin(view.start)}
          timeZone={v.timezone}
          isToday={date === clock.dateKey}
          auditNotice={manager && view.window !== "open"}
          doneHref={
            <Button asChild size="sm" variant="outline" data-testid="done">
              <Link href={`/attendance?date=${date}`}>{t("done")}</Link>
            </Button>
          }
        />
      )}
    </PageBody>
  );

  function Banner() {
    const box = (icon: React.ReactNode, text: string, testId: string) => (
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground" data-testid={testId}>
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span>{text}</span>
      </div>
    );
    if (!view) return null;
    if (external) return box(<ArrowLeftRight className="size-4" />, t("externalBanner"), "banner-external");
    if (view.role === null) return box(<Eye className="size-4" />, t("viewOnlyBanner"), "banner-view-only");
    if (view.window === "future") return box(<CalendarClock className="size-4" />, t("futureBanner"), "banner-future");
    if (view.window === "closed" && !manager) return box(<Lock className="size-4" />, t("closedBanner", { time: view.closeTime }), "banner-closed");
    if (view.window === "closed" && manager) return box(<ShieldCheck className="size-4" />, t("closedManagerBanner"), "banner-closed-manager");
    if (view.window === "late_closed" && !manager) return box(<Info className="size-4" />, t("lateClosedBanner", { time: cutoff }), "banner-late-closed");
    if (view.window === "late_closed" && manager) return box(<ShieldCheck className="size-4" />, t("lateManagerBanner", { time: cutoff }), "banner-late-manager");
    return null;
  }
}
