import { getTranslations } from "next-intl/server";
import { Bus, CalendarClock, MapPin, Wallet } from "lucide-react";
import type { TripConsent, TripStatus } from "@prisma/client";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtNumber, type FormatPrefs } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader, SectionTitle } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { CONSENT_TONE, STATUS_TONE } from "@/components/trips/tones";
import { TripDialog } from "@/components/trips/trip-forms";
import { dayKey, addDays } from "@/server/exams/schedule";

export async function generateMetadata() {
  const t = await getTranslations("trips");
  return { title: t("title") };
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];

type TripRow = { id: string; titleEn: string; titleAr: string; destinationEn: string; destinationAr: string; startsAt: Date; costAed: number | null; consentDeadline: Date | null; status: TripStatus };

async function TripCard({ trip, prefs, locale, footer }: { trip: TripRow; prefs: FormatPrefs; locale: string; footer?: React.ReactNode }) {
  const t = await getTranslations("trips");
  return (
    <Link href={`/trips/${trip.id}`} className="block" data-testid="trip-card">
      <Panel className="h-full transition hover:border-brand/25 hover:shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold">{pick(locale, trip.titleEn, trip.titleAr)}</div>
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{pick(locale, trip.destinationEn, trip.destinationAr)}</span>
            </div>
          </div>
          <Pill tone={STATUS_TONE[trip.status]} dot>
            {t(`status.${trip.status}`)}
          </Pill>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3" />
            {fmtDateTime(prefs, trip.startsAt)}
          </span>
          <span className="flex items-center gap-1">
            <Wallet className="size-3" />
            {trip.costAed ? t("costAed", { amount: fmtNumber(prefs, trip.costAed) }) : t("free")}
          </span>
        </div>
        {footer && <div className="mt-3">{footer}</div>}
      </Panel>
    </Link>
  );
}

export default async function TripsPage() {
  const ctx = await getCtx();
  const t = await getTranslations("trips");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const now = new Date();

  // Families: trips per child.
  if (!ctx.isStaff) {
    const kids = ctx.isStudent ? (ctx.membership.student ? [ctx.membership.student] : []) : (ctx.membership.guardian?.links.map((l) => l.student) ?? []);
    const parts = await db.tripParticipant.findMany({ where: { studentId: { in: kids.map((k) => k.id) }, trip: { status: { in: ["PUBLISHED", "COMPLETED", "CANCELLED"] } } }, include: { trip: true }, orderBy: { trip: { startsAt: "asc" } } });
    return (
      <PageBody>
        <PageHeader title={t("title")} description={ctx.isParent ? t("subtitleParent") : t("subtitleStudent")} />
        {parts.length === 0 ? (
          <EmptyState icon={<Bus className="size-5" />} title={t("emptyFamily")} body={t("emptyFamilyBody")} />
        ) : (
          kids.map((k) => {
            const mine = parts.filter((p) => p.studentId === k.id);
            const upcoming = mine.filter((p) => p.trip.endsAt > now && p.trip.status === "PUBLISHED");
            const other = mine.filter((p) => !upcoming.includes(p));
            if (!mine.length) return null;
            return (
              <section key={k.id} className="space-y-3" data-testid="child-trips">
                {ctx.isParent && <SectionTitle>{t("forChild", { name: personName(k, locale) })}</SectionTitle>}
                <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
                  {[...upcoming, ...other].map((p) => (
                    <TripCard
                      key={p.id}
                      trip={p.trip}
                      prefs={prefs}
                      locale={locale}
                      footer={
                        p.trip.status === "PUBLISHED" ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={CONSENT_TONE[p.consent]}>{t(`consent.${p.consent}`)}</Pill>
                            {p.consent === "PENDING" && p.trip.consentDeadline && <span className="text-xs text-muted-foreground">{t("respondBy", { date: fmtDate(prefs, p.trip.consentDeadline) })}</span>}
                            {ctx.isParent && p.consent === "PENDING" && p.trip.endsAt > now && <span className="ms-auto text-xs font-semibold text-brand">{t("respond")}</span>}
                          </div>
                        ) : null
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </PageBody>
    );
  }

  // Staff: every published trip, plus their own drafts (leaders see all drafts).
  const canCreate = ctx.can("trips.manage");
  const trips = await db.trip.findMany({
    where: ctx.can("calendar.manage") ? {} : { OR: [{ status: { not: "DRAFT" } }, { organizerId: ctx.membershipId }] },
    orderBy: { startsAt: "asc" },
  });
  const counts = await db.tripParticipant.groupBy({ by: ["tripId", "consent"], where: { tripId: { in: trips.map((x) => x.id) } }, _count: { _all: true } });
  const organisers = await db.membership.findMany({ where: { id: { in: [...new Set(trips.map((x) => x.organizerId))] } }, include: { user: true } });
  const classes = canCreate ? await db.schoolClass.findMany({ where: { academicYear: { isCurrent: true } }, orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }] }) : [];
  const upcoming = trips.filter((x) => x.endsAt > now && x.status !== "CANCELLED" && x.status !== "COMPLETED");
  const past = trips.filter((x) => !upcoming.includes(x)).reverse();
  const today = dayKey(now);
  const count = (id: string, c: TripConsent) => counts.find((x) => x.tripId === id && x.consent === c)?._count._all ?? 0;

  const board = (x: (typeof trips)[number]) => {
    const g = count(x.id, "GRANTED");
    const d = count(x.id, "DECLINED");
    const p = count(x.id, "PENDING");
    const total = g + d + p;
    if (!total) return <span className="text-xs text-muted-foreground">{x.status === "DRAFT" ? t("draftHint") : t("noParticipants")}</span>;
    return (
      <div className="space-y-1.5">
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="bg-success" style={{ width: `${(g / total) * 100}%` }} />
          <div className="bg-danger" style={{ width: `${(d / total) * 100}%` }} />
          <div className="bg-warning" style={{ width: `${(p / total) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{t("countGranted", { count: g })}</span>
          <span>{t("countDeclined", { count: d })}</span>
          <span>{t("countPending", { count: p })}</span>
          <span className="ms-auto">{userName(organisers.find((m) => m.id === x.organizerId)?.user, locale)}</span>
        </div>
      </div>
    );
  };

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitleStaff")}
        actions={canCreate ? <TripDialog grades={GRADES} classes={classes.map((c) => ({ value: c.id, label: pick(locale, c.nameEn, c.nameAr), grade: c.gradeLevel }))} defaults={{ date: addDays(today, 21), deadline: addDays(today, 14) }} /> : null}
      />
      <section className="space-y-3">
        <SectionTitle>{t("upcoming")}</SectionTitle>
        {upcoming.length === 0 ? (
          <EmptyState icon={<Bus className="size-5" />} title={t("emptyUpcoming")} body={canCreate ? t("emptyUpcomingBody") : undefined} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
            {upcoming.map((x) => (
              <TripCard key={x.id} trip={x} prefs={prefs} locale={locale} footer={board(x)} />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>{t("past")}</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
            {past.map((x) => (
              <TripCard key={x.id} trip={x} prefs={prefs} locale={locale} footer={board(x)} />
            ))}
          </div>
        </section>
      )}
    </PageBody>
  );
}
