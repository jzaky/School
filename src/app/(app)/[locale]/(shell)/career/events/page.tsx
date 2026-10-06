import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarClock, GraduationCap, MapPin, Users, Video } from "lucide-react";
import type { CareerEvent } from "@prisma/client";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtTime, type FormatPrefs } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader, SectionTitle } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { KIND_TONE, STATE_TONE } from "@/components/career-events/tones";
import { EventDialog, RegisterButton } from "@/components/career-events/event-forms";
import { actingStudents, canManageEvents } from "@/server/career-events/access";
import { closesAt, gradeEligible, registrationState } from "@/server/career-events/service";
import { addDays, dayKey } from "@/server/exams/schedule";

export async function generateMetadata() {
  const t = await getTranslations("careerEvents");
  return { title: t("title") };
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];

async function EventCard({ ev, prefs, locale, taken, footer }: { ev: CareerEvent; prefs: FormatPrefs; locale: string; taken: number; footer?: React.ReactNode }) {
  const t = await getTranslations("careerEvents");
  const state = registrationState(ev, taken, new Date());
  return (
    <Panel className="flex h-full flex-col gap-3" padded>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={KIND_TONE[ev.kind]}>{t(`kind.${ev.kind}`)}</Pill>
        <Pill tone={STATE_TONE[state]} dot>
          {t(`state.${state}`)}
        </Pill>
      </div>
      <Link href={`/career/events/${ev.id}`} className="font-semibold hover:text-brand" data-testid="event-card">
        {pick(locale, ev.titleEn, ev.titleAr)}
      </Link>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" />
          {fmtDateTime(prefs, ev.startsAt)} - {fmtTime(prefs, ev.endsAt)}
        </div>
        <div className="flex items-center gap-1.5">
          {ev.locationEn ? <MapPin className="size-3.5 shrink-0" /> : <Video className="size-3.5 shrink-0" />}
          <span className="truncate">{ev.locationEn ? pick(locale, ev.locationEn, ev.locationAr) : t("online")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <GraduationCap className="size-3.5 shrink-0" />
          {t("grades", { grades: ev.gradeLevels.join(", ") })}
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="size-3.5 shrink-0" />
          {ev.capacity != null ? t("places", { taken, capacity: ev.capacity }) : t("registeredCount", { count: taken })}
        </div>
        {state === "open" && ev.registrationDeadline && <div>{t("registerBy", { date: fmtDate(prefs, closesAt(ev)) })}</div>}
      </div>
      {footer && <div className="mt-auto border-t pt-3">{footer}</div>}
    </Panel>
  );
}

export default async function CareerEventsPage() {
  const ctx = await getCtx();
  const t = await getTranslations("careerEvents");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const now = new Date();
  const manager = canManageEvents(ctx);
  const family = ctx.isStudent || ctx.isParent;
  if (!family && !ctx.isStaff) notFound();

  const students = actingStudents(ctx);
  const grades = [...new Set(students.map((s) => s.gradeLevel))];
  const events = await db.careerEvent.findMany({
    where: family ? { OR: [{ gradeLevels: { hasSome: grades } }, { registrations: { some: { studentId: { in: students.map((s) => s.id) } } } }] } : {},
    orderBy: { startsAt: "asc" },
  });
  const counts = await db.careerEventRegistration.groupBy({ by: ["eventId"], where: { eventId: { in: events.map((e) => e.id) }, status: "REGISTERED" }, _count: { _all: true } });
  const taken = (id: string) => counts.find((c) => c.eventId === id)?._count._all ?? 0;
  const upcoming = events.filter((e) => e.endsAt > now && e.status === "PUBLISHED");
  const past = events.filter((e) => !upcoming.includes(e)).reverse();

  if (family) {
    const regs = await db.careerEventRegistration.findMany({ where: { studentId: { in: students.map((s) => s.id) }, eventId: { in: events.map((e) => e.id) } } });
    const reasonFor = (ev: CareerEvent, studentGrade: number) => {
      const st = registrationState(ev, taken(ev.id), now);
      if (!gradeEligible(ev, studentGrade)) return t("notEligible");
      if (st !== "open") return t(`state.${st}`);
      return null;
    };
    return (
      <PageBody>
        <PageHeader title={t("title")} description={ctx.isParent ? t("subtitleParent") : t("subtitleStudent")} />
        {students.length === 0 || (upcoming.length === 0 && past.length === 0) ? (
          <EmptyState icon={<GraduationCap className="size-5" />} title={t("empty")} body={t("emptyFamily")} />
        ) : (
          students.map((s) => {
            const mineUpcoming = upcoming.filter((e) => gradeEligible(e, s.gradeLevel) || regs.some((r) => r.eventId === e.id && r.studentId === s.id && r.status === "REGISTERED"));
            const minePast = past.filter((e) => regs.some((r) => r.eventId === e.id && r.studentId === s.id && r.status === "REGISTERED"));
            if (!mineUpcoming.length && !minePast.length) return null;
            return (
              <section key={s.id} className="space-y-4" data-testid="child-events">
                {ctx.isParent && <SectionTitle>{t("forChild", { name: personName(s, locale) })}</SectionTitle>}
                {mineUpcoming.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
                    {mineUpcoming.map((ev) => {
                      const reg = regs.find((r) => r.eventId === ev.id && r.studentId === s.id);
                      const registered = reg?.status === "REGISTERED";
                      const reason = reasonFor(ev, s.gradeLevel);
                      const canCancel = ev.startsAt > now;
                      return (
                        <EventCard
                          key={ev.id}
                          ev={ev}
                          prefs={prefs}
                          locale={locale}
                          taken={taken(ev.id)}
                          footer={
                            <div className="flex flex-wrap items-center gap-2">
                              {registered && <Pill tone="success">{t("registered")}</Pill>}
                              <span className="ms-auto">
                                <RegisterButton eventId={ev.id} studentId={s.id} registered={registered} canRegister={registered ? canCancel : !reason} blockedReason={registered ? null : reason} />
                              </span>
                            </div>
                          }
                        />
                      );
                    })}
                  </div>
                )}
                {minePast.length > 0 && (
                  <>
                    <SectionTitle>{t("past")}</SectionTitle>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
                      {minePast.map((ev) => {
                        const reg = regs.find((r) => r.eventId === ev.id && r.studentId === s.id);
                        return (
                          <EventCard
                            key={ev.id}
                            ev={ev}
                            prefs={prefs}
                            locale={locale}
                            taken={taken(ev.id)}
                            footer={reg?.attended != null ? <Pill tone={reg.attended ? "success" : "neutral"}>{reg.attended ? t("attended") : t("absent")}</Pill> : null}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            );
          })
        )}
      </PageBody>
    );
  }

  const universities = manager ? await db.university.findMany({ select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: "asc" } }) : [];
  const today = dayKey(now);
  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitleStaff")}
        actions={manager ? <EventDialog grades={GRADES} universities={universities.map((u) => ({ id: u.id, label: pick(locale, u.nameEn, u.nameAr) }))} defaults={{ date: addDays(today, 14), deadline: addDays(today, 12) }} /> : null}
      />
      <section className="space-y-3">
        <SectionTitle>{t("upcoming")}</SectionTitle>
        {upcoming.length === 0 ? (
          <EmptyState icon={<GraduationCap className="size-5" />} title={t("empty")} body={manager ? t("emptyStaff") : undefined} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {upcoming.map((ev) => (
              <EventCard key={ev.id} ev={ev} prefs={prefs} locale={locale} taken={taken(ev.id)} />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>{t("past")}</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {past.map((ev) => (
              <EventCard key={ev.id} ev={ev} prefs={prefs} locale={locale} taken={taken(ev.id)} />
            ))}
          </div>
        </section>
      )}
    </PageBody>
  );
}
