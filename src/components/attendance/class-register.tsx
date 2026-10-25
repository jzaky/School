// A class register for one school week: each student's mark per day. Excused absences reported by the family
// show only that they are excused and who reported them; the reason is visible only to the attendance team
// (src/server/access/absence-access.ts), with a link to the report.
import { getTranslations } from "next-intl/server";
import { CalendarCheck, ChevronLeft, ChevronRight, ClipboardList, Lock, ShieldCheck } from "lucide-react";
import type { AttendanceSource, AttendanceStatus } from "@prisma/client";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { fmtDate, fmtWeekday } from "@/lib/format";
import { personName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { excusedLabelKey, seesStudentAbsenceReasons } from "@/server/access/absence-access";
import { addDays, keyToDate, weekdayOfKey } from "@/server/timetable/cover";
import { dubaiDateKey } from "@/server/appointments/slots";

type Student = { id: string; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string };

const CELL: Record<AttendanceStatus, string> = {
  PRESENT: "bg-success-soft text-success",
  LATE: "bg-warning-soft text-[oklch(0.5_0.13_65)]",
  ABSENT: "bg-danger-soft text-danger",
  EXCUSED: "bg-info-soft text-info",
};

export async function ClassRegister({ ctx, prefs, classId, students, anchor }: { ctx: Ctx; prefs: FormatPrefs; classId: string; students: Student[]; anchor?: string }) {
  const t = await getTranslations("attendance");
  const { db, locale } = ctx;
  const weekDays = ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5];
  const today = dubaiDateKey(new Date());
  // Default: the current school week, or the last one at the weekend.
  let a = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? anchor : today;
  if (!anchor) while (!weekDays.includes(weekdayOfKey(a))) a = addDays(a, -1);
  const monday = addDays(a, -((weekdayOfKey(a) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => weekDays.includes(weekdayOfKey(d)));
  const ids = students.map((s) => s.id);
  const records = ids.length && days.length ? await db.attendanceRecord.findMany({ where: { studentId: { in: ids }, date: { gte: keyToDate(days[0]), lte: keyToDate(days[days.length - 1]) } } }) : [];
  const key = (sid: string, d: string) => `${sid}|${d}`;
  const byKey = new Map(records.map((r) => [key(r.studentId, r.date.toISOString().slice(0, 10)), r]));
  const reasons = seesStudentAbsenceReasons(ctx);
  const reportIds = [...new Set(records.map((r) => r.requestId).filter(Boolean) as string[])];
  const reports = reasons && reportIds.length ? await db.request.findMany({ where: { id: { in: reportIds } }, select: { id: true, number: true, submission: { select: { data: true } } } }) : [];
  const reportOf = new Map(reports.map((r) => [r.id, { number: r.number, type: String((r.submission?.data as Record<string, unknown> | null)?.absenceType ?? "") }]));
  const away = records
    .filter((r) => r.status === "EXCUSED" || r.status === "ABSENT")
    .sort((x, y) => x.date.getTime() - y.date.getTime())
    .map((r) => ({ r, s: students.find((s) => s.id === r.studentId)! }))
    .filter((x) => x.s);
  const label = (status: AttendanceStatus, source: AttendanceSource) => (status === "EXCUSED" ? t(excusedLabelKey(source)) : t(`status.${status}`));
  const short = (status: AttendanceStatus) => t(`short.${status}`);
  const qs = (k: string) => `/classes/${classId}?date=${k}#register`;

  return (
    <Panel>
      <div id="register" className="scroll-mt-24" />
      <PanelHeader
        title={t("registerTitle")}
        description={t("weekOf", { date: fmtDate(prefs, keyToDate(monday), "long") })}
        icon={<ClipboardList className="size-4" />}
        action={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" asChild>
              <Link href={qs(addDays(monday, -7))} aria-label={t("previousWeek")}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
            <Button variant="outline" size="icon" asChild>
              <Link href={qs(addDays(monday, 7))} aria-label={t("nextWeek")}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-separate border-spacing-0 text-sm" data-testid="register">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="sticky start-0 bg-card pb-2 text-start font-medium">{t("student")}</th>
              {days.map((d) => (
                <th key={d} className={cn("w-11 pb-2 text-center font-medium sm:w-16", d === today && "text-brand")}>
                  <div>{fmtWeekday(prefs, keyToDate(d))}</div>
                  <div className="text-[10px] font-normal tabular-nums">{fmtDate(prefs, keyToDate(d), "short")}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="[&>td]:border-t">
                <td className="sticky start-0 max-w-[9rem] truncate bg-card py-1.5 pe-2 text-sm sm:max-w-none">{personName(s, locale)}</td>
                {days.map((d) => {
                  const r = byKey.get(key(s.id, d));
                  if (!r) return <td key={d} className="py-1.5 text-center text-muted-foreground/50">·</td>;
                  const text = label(r.status, r.source);
                  return (
                    <td key={d} className="py-1.5 text-center">
                      <span
                        title={`${personName(s, locale)}, ${fmtDate(prefs, keyToDate(d))}: ${text}${r.minutesLate ? ` (${t("minutesLate", { n: r.minutesLate })})` : ""}`}
                        aria-label={text}
                        className={cn("relative inline-grid size-7 place-items-center rounded-md text-[11px] font-semibold", CELL[r.status])}
                        data-testid="register-cell"
                        data-status={r.status}
                        data-source={r.source}
                      >
                        {short(r.status)}
                        {r.status === "EXCUSED" && r.source !== "REGISTER" && <span className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-info ring-2 ring-card" />}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {(["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("grid size-4 place-items-center rounded text-[9px] font-semibold", CELL[k])}>{short(k)}</span>
            {t(`status.${k}`)}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="relative grid size-4 place-items-center rounded bg-info-soft text-[9px] font-semibold text-info">
            {short("EXCUSED")}
            <span className="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-info" />
          </span>
          {t("legendFamily")}
        </span>
      </div>

      <div className="mt-5 border-t pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">{t("awayThisWeek")}</h3>
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
        {away.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nobodyAway")}</p>
        ) : (
          <ul className="space-y-2" data-testid="away-list">
            {away.map(({ r, s }) => {
              const report = r.requestId ? reportOf.get(r.requestId) : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm" data-testid="away-row">
                  <CalendarCheck className={cn("size-4 shrink-0", r.status === "EXCUSED" ? "text-info" : "text-danger")} />
                  <span className="font-medium">{personName(s, locale)}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(prefs, r.date, "long")}</span>
                  <span className="text-xs" data-testid="away-label">{label(r.status, r.source)}</span>
                  {reasons && report ? (
                    <Link href={`/requests/${r.requestId}`} className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline" data-testid="away-reason">
                      {report.type && t.has(`reasonType.${report.type}`) ? t(`reasonType.${report.type}`) : t("seeReport")} · <span dir="ltr">{report.number}</span>
                    </Link>
                  ) : r.requestId ? (
                    <span className="ms-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="size-3" />
                      {t("reasonPrivateShort")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** Teacher home: who is away from the homeroom on the latest school day, without any reason. */
export async function HomeroomToday({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const { db, locale } = ctx;
  const homeroom = await db.schoolClass.findFirst({ where: { teacherMembershipId: ctx.membershipId, isHomeroom: true }, include: { enrollments: { include: { student: true } } } });
  if (!homeroom || !homeroom.enrollments.length) return null;
  const t = await getTranslations("attendance");
  const weekDays = ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5];
  let day = dubaiDateKey(new Date());
  for (let i = 0; i < 10 && !weekDays.includes(weekdayOfKey(day)); i++) day = addDays(day, -1);
  const ids = homeroom.enrollments.map((e) => e.studentId);
  let records = await db.attendanceRecord.findMany({ where: { studentId: { in: ids }, date: keyToDate(day) } });
  if (!records.length) {
    // The register for today is not taken yet: show the latest school day with marks.
    const last = await db.attendanceRecord.findFirst({ where: { studentId: { in: ids }, date: { lte: keyToDate(day) } }, orderBy: { date: "desc" }, select: { date: true } });
    if (last) {
      day = last.date.toISOString().slice(0, 10);
      records = await db.attendanceRecord.findMany({ where: { studentId: { in: ids }, date: last.date } });
    }
  }
  const away = records.filter((r) => r.status === "EXCUSED" || r.status === "ABSENT");
  const present = records.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
  const nameOf = (sid: string) => {
    const e = homeroom.enrollments.find((x) => x.studentId === sid);
    return e ? personName(e.student, locale) : "";
  };
  return (
    <Panel>
      <PanelHeader
        title={t("homeroomTitle", { name: locale === "ar" ? homeroom.nameAr : homeroom.nameEn })}
        description={fmtDate(prefs, keyToDate(day), "long")}
        icon={<ClipboardList className="size-4" />}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/classes/${homeroom.id}?date=${day}#register`} data-testid="open-register">
              {t("openRegister")}
            </Link>
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Pill tone="success">{t("presentN", { n: present })}</Pill>
        <Pill tone={away.length ? "info" : "neutral"}>{t("awayN", { n: away.length })}</Pill>
      </div>
      {away.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("nobodyAwayDay")}</p>
      ) : (
        <ul className="space-y-1.5" data-testid="homeroom-away">
          {away.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <CalendarCheck className={cn("size-4 shrink-0", r.status === "EXCUSED" ? "text-info" : "text-danger")} />
              <span className="font-medium">{nameOf(r.studentId)}</span>
              <span className="text-xs text-muted-foreground" data-testid="homeroom-away-label">
                {r.status === "EXCUSED" ? t(excusedLabelKey(r.source)) : t("status.ABSENT")}
              </span>
              {r.requestId && !seesStudentAbsenceReasons(ctx) && <Lock className="size-3 text-muted-foreground" aria-label={t("reasonPrivateShort")} />}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
