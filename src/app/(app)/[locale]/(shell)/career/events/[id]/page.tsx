import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, Download, ExternalLink, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { AttendanceButtons, CancelEventButton, EventDialog, RegisterButton } from "@/components/career-events/event-forms";
import { KIND_TONE, STATE_TONE } from "@/components/career-events/tones";
import { actingStudents, canManageEvents } from "@/server/career-events/access";
import { closesAt, gradeEligible, registrationState } from "@/server/career-events/service";
import { dubaiDayKey } from "@/server/inspection/range";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("careerEvents");
  const ev = await ctx.db.careerEvent.findFirst({ where: { orgId: ctx.orgId, id }, select: { titleEn: true, titleAr: true } });
  return { title: ev ? pick(ctx.locale, ev.titleEn, ev.titleAr) : t("title") };
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];
const timeKey = (d: Date) => new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(11, 16);

export default async function CareerEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("careerEvents");
  const tc = await getTranslations("common");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const now = new Date();
  const ev = await db.careerEvent.findFirst({ where: { orgId: ctx.orgId, id } });
  if (!ev) notFound();
  const manager = canManageEvents(ctx);
  const family = ctx.isStudent || ctx.isParent;
  const students = actingStudents(ctx);
  const regs = await db.careerEventRegistration.findMany({ where: { eventId: ev.id }, orderBy: { registeredAt: "asc" } });
  const active = regs.filter((r) => r.status === "REGISTERED");
  if (family && !students.some((s) => gradeEligible(ev, s.gradeLevel) || active.some((r) => r.studentId === s.id))) notFound();
  if (!family && !ctx.isStaff) notFound();

  const state = registrationState(ev, active.length, now);
  const [unis, organizer] = await Promise.all([
    ev.universityIds.length ? db.university.findMany({ where: { id: { in: ev.universityIds } }, select: { id: true, nameEn: true, nameAr: true, website: true } }) : Promise.resolve([]),
    db.membership.findUnique({ where: { id: ev.organizerId }, include: { user: true } }),
  ]);
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const attendanceOpen = ev.status === "PUBLISHED" && ev.startsAt.getTime() - now.getTime() <= 3_600_000;
  const attendees = manager ? await db.student.findMany({ where: { id: { in: active.map((r) => r.studentId) } } }) : [];
  const universities = manager && ev.status === "PUBLISHED" && ev.startsAt > now ? await db.university.findMany({ select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: "asc" } }) : [];

  return (
    <PageBody>
      <Link href="/career/events" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <Back className="size-4" />
        {t("back")}
      </Link>
      <PageHeader
        eyebrow={t(`kind.${ev.kind}`)}
        title={pick(locale, ev.titleEn, ev.titleAr)}
        actions={
          manager && ev.status === "PUBLISHED" ? (
            <>
              {ev.startsAt > now && (
                <EventDialog
                  grades={GRADES}
                  universities={universities.map((u) => ({ id: u.id, label: pick(locale, u.nameEn, u.nameAr) }))}
                  defaults={{ date: dubaiDayKey(ev.startsAt), deadline: "" }}
                  initial={{
                    id: ev.id,
                    kind: ev.kind,
                    titleEn: ev.titleEn,
                    titleAr: ev.titleAr,
                    descEn: ev.descEn ?? "",
                    descAr: ev.descAr ?? "",
                    universityIds: ev.universityIds,
                    otherUniversities: ev.otherUniversities.join(", "),
                    date: dubaiDayKey(ev.startsAt),
                    startTime: timeKey(ev.startsAt),
                    endTime: timeKey(ev.endsAt),
                    locationEn: ev.locationEn ?? "",
                    locationAr: ev.locationAr ?? "",
                    onlineUrl: ev.onlineUrl ?? "",
                    gradeLevels: ev.gradeLevels,
                    capacity: ev.capacity,
                    deadline: ev.registrationDeadline ? dubaiDayKey(ev.registrationDeadline) : "",
                  }}
                />
              )}
              {ev.endsAt > now && <CancelEventButton eventId={ev.id} />}
            </>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={KIND_TONE[ev.kind]}>{t(`kind.${ev.kind}`)}</Pill>
        <Pill tone={STATE_TONE[state]} dot>
          {t(`state.${state}`)}
        </Pill>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel className="space-y-4 lg:col-span-2">
          <PanelHeader title={t("details")} />
          {(ev.descEn || ev.descAr) && <p className="text-sm leading-relaxed whitespace-pre-line">{pick(locale, ev.descEn, ev.descAr)}</p>}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t("when")}</dt>
              <dd>
                {fmtDateTime(prefs, ev.startsAt)} - {fmtTime(prefs, ev.endsAt)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("where")}</dt>
              <dd className="break-words">
                {ev.locationEn ? pick(locale, ev.locationEn, ev.locationAr) : t("online")}
                {ev.onlineUrl && ev.status === "PUBLISHED" && (family ? active.some((r) => students.some((s) => s.id === r.studentId)) : true) && (
                  <a href={ev.onlineUrl} target="_blank" rel="noopener noreferrer" className="ms-2 inline-flex items-center gap-1 text-brand hover:underline">
                    {t("joinOnline")}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("field.grades")}</dt>
              <dd>{t("grades", { grades: ev.gradeLevels.join(", ") })}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("capacity")}</dt>
              <dd>{ev.capacity != null ? t("places", { taken: active.length, capacity: ev.capacity }) : `${t("unlimited")} (${t("registeredCount", { count: active.length })})`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("deadline")}</dt>
              <dd>{ev.registrationDeadline ? fmtDate(prefs, closesAt(ev)) : t("noDeadline")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("organizer")}</dt>
              <dd>{userName(organizer?.user, locale)}</dd>
            </div>
          </dl>
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">{t("universities")}</div>
            {unis.length + ev.otherUniversities.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noUniversities")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="event-universities">
                {unis.map((u) => (
                  <Pill key={u.id} tone="brand">
                    {pick(locale, u.nameEn, u.nameAr)}
                  </Pill>
                ))}
                {ev.otherUniversities.map((n) => (
                  <Pill key={n} tone="neutral">
                    {n}
                  </Pill>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {family && (
          <Panel className="space-y-3">
            <PanelHeader title={t("register")} />
            {students.map((s) => {
              const reg = regs.find((r) => r.studentId === s.id);
              const registered = reg?.status === "REGISTERED";
              const reason = !gradeEligible(ev, s.gradeLevel) ? t("notEligible") : state !== "open" ? t(`state.${state}`) : null;
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3" data-testid="family-registration">
                  <span className="min-w-0 flex-1 text-sm font-medium">{personName(s, locale)}</span>
                  {registered && <Pill tone="success">{t("registered")}</Pill>}
                  {reg?.attended != null && <Pill tone={reg.attended ? "success" : "neutral"}>{reg.attended ? t("attended") : t("absent")}</Pill>}
                  <RegisterButton eventId={ev.id} studentId={s.id} registered={registered} canRegister={registered ? ev.startsAt > now && ev.status === "PUBLISHED" : !reason} blockedReason={registered ? null : reason} />
                </div>
              );
            })}
          </Panel>
        )}
      </div>

      {manager && (
        <Panel padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">
                {t("attendees")} ({active.length})
              </h2>
              <p className="text-xs text-muted-foreground">{attendanceOpen ? t("attendeesHint") : t("attendanceLocked")}</p>
            </div>
            {active.length > 0 && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/career/events/${ev.id}/export`} data-testid="event-export">
                  <Download className="size-4" />
                  {t("exportList")}
                </a>
              </Button>
            )}
          </div>
          {active.length === 0 ? (
            <EmptyState icon={<Users className="size-5" />} title={t("noAttendees")} className="border-0" />
          ) : (
            <ul className="divide-y" data-testid="attendee-list">
              {active
                .map((r) => ({ r, s: attendees.find((s) => s.id === r.studentId) }))
                .filter((x) => x.s)
                .sort((a, b) => a.s!.gradeLevel - b.s!.gradeLevel || a.s!.lastNameEn.localeCompare(b.s!.lastNameEn))
                .map(({ r, s }) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{personName(s!, locale)}</span>
                      <span className="text-xs text-muted-foreground">
                        {tc("gradeN", { grade: `${s!.gradeLevel}${s!.section ?? ""}` })} · {fmtDate(prefs, r.registeredAt)}
                      </span>
                    </span>
                    {r.attended != null && <Pill tone={r.attended ? "success" : "neutral"}>{r.attended ? t("attended") : t("absent")}</Pill>}
                    {attendanceOpen ? <AttendanceButtons eventId={ev.id} studentId={s!.id} attended={r.attended} /> : r.attended == null ? <Pill tone="neutral">{t("notMarked")}</Pill> : null}
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      )}
    </PageBody>
  );
}
