import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarClock, CheckCircle2, Clock, FileText, MapPin, UserRound, Wallet, XCircle } from "lucide-react";
import type { TripConsent } from "@prisma/client";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { CONSENT_TONE, STATUS_TONE } from "@/components/trips/tones";
import { ConsentButtons, TripDialog, TripOrganiserActions } from "@/components/trips/trip-forms";
import { canManageTrip } from "@/server/trips/access";
import { tripDates } from "@/server/trips/service";
import { applyMerge, type MergeData } from "@/server/documents/merge";
import { dayKey } from "@/server/exams/schedule";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const trip = await ctx.db.trip.findUnique({ where: { id }, select: { titleEn: true, titleAr: true } });
  const t = await getTranslations("trips");
  return { title: trip ? pick(ctx.locale, trip.titleEn, trip.titleAr) : t("title") };
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];
const CONSENTS: TripConsent[] = ["GRANTED", "DECLINED", "PENDING"];

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ consent?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("trips");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const trip = await db.trip.findUnique({ where: { id } });
  if (!trip) notFound();
  const manage = canManageTrip(ctx, trip);
  const kids = ctx.isStudent ? (ctx.membership.student ? [ctx.membership.student] : []) : ctx.isParent ? (ctx.membership.guardian?.links.map((l) => l.student) ?? []) : [];
  if (!ctx.isStaff && trip.status === "DRAFT") notFound();
  if (ctx.isStaff && trip.status === "DRAFT" && !manage) notFound();
  const familyParts = ctx.isStaff ? [] : await db.tripParticipant.findMany({ where: { tripId: trip.id, studentId: { in: kids.map((k) => k.id) } } });
  if (!ctx.isStaff && familyParts.length === 0) notFound();

  const now = new Date();
  const ended = trip.endsAt <= now;
  const organiser = await db.membership.findUnique({ where: { id: trip.organizerId }, include: { user: true } });
  const template = trip.templateKey ? await db.documentTemplate.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: trip.templateKey } } }) : null;
  const deadlinePassed = trip.consentDeadline ? trip.consentDeadline < now : false;

  const info = (
    <Panel>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{pick(locale, trip.destinationEn, trip.destinationAr)}</span>
        </div>
        <div className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{tripDates(trip, locale === "ar" ? "ar" : "en")}</span>
        </div>
        <div className="flex items-start gap-2">
          <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{trip.costAed ? t("costAed", { amount: fmtNumber(prefs, trip.costAed) }) : t("free")}</span>
        </div>
        {trip.consentDeadline && (
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className={cn(deadlinePassed && trip.status === "PUBLISHED" && "text-danger")}>{t("deadline", { date: fmtDate(prefs, trip.consentDeadline) })}</span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{t("organiser", { name: userName(organiser?.user, locale) })}</span>
        </div>
        {(trip.gradeLevels.length > 0 || trip.classIds.length > 0) && ctx.isStaff && (
          <div className="text-muted-foreground">
            {trip.gradeLevels.map((g) => t("gradeN", { grade: g })).join(", ")}
            {trip.classIds.length > 0 && ` ${t("plusClasses", { count: trip.classIds.length })}`}
          </div>
        )}
      </div>
      {pick(locale, trip.descEn, trip.descAr) && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{pick(locale, trip.descEn, trip.descAr)}</p>}
    </Panel>
  );

  const header = (
    <>
      <Link href="/trips" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("back")}
      </Link>
      <PageHeader
        title={pick(locale, trip.titleEn, trip.titleAr)}
        eyebrow={
          <Pill tone={STATUS_TONE[trip.status]} dot>
            {t(`status.${trip.status}`)}
          </Pill>
        }
        actions={
          manage ? (
            <>
              {trip.status === "DRAFT" && (
                <TripDialog
                  grades={GRADES}
                  classes={(await db.schoolClass.findMany({ where: { academicYear: { isCurrent: true } }, orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }] })).map((c) => ({ value: c.id, label: pick(locale, c.nameEn, c.nameAr), grade: c.gradeLevel }))}
                  defaults={{ date: dayKey(trip.startsAt), deadline: dayKey(trip.consentDeadline ?? trip.startsAt) }}
                  initial={{
                    id: trip.id,
                    titleEn: trip.titleEn,
                    titleAr: trip.titleAr,
                    descEn: trip.descEn ?? "",
                    descAr: trip.descAr ?? "",
                    destinationEn: trip.destinationEn,
                    destinationAr: trip.destinationAr,
                    date: dayKey(trip.startsAt),
                    endDate: dayKey(trip.endsAt),
                    startTime: new Date(trip.startsAt.getTime() + 4 * 3600_000).toISOString().slice(11, 16),
                    endTime: new Date(trip.endsAt.getTime() + 4 * 3600_000).toISOString().slice(11, 16),
                    costAed: trip.costAed,
                    consentDeadline: dayKey(trip.consentDeadline ?? trip.startsAt),
                    gradeLevels: trip.gradeLevels,
                    classIds: trip.classIds,
                  }}
                />
              )}
            </>
          ) : null
        }
      />
    </>
  );

  // Families: the letter and a one-tap decision per child.
  if (!ctx.isStaff) {
    const docs = await db.document.findMany({ where: { id: { in: familyParts.map((p) => p.documentId).filter(Boolean) as string[] } }, include: { versions: true } });
    const deciders = await db.membership.findMany({ where: { id: { in: familyParts.map((p) => p.decidedById).filter(Boolean) as string[] } }, include: { user: true } });
    const canDecide = ctx.isParent && ctx.can("trips.consent") && trip.status === "PUBLISHED" && trip.startsAt > now;
    return (
      <PageBody className="max-w-4xl">
        {header}
        {trip.status === "CANCELLED" && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm font-medium text-danger">{t("cancelledBanner")}</div>
        )}
        {info}
        {familyParts.map((p) => {
          const kid = kids.find((k) => k.id === p.studentId)!;
          const doc = docs.find((d) => d.id === p.documentId);
          const version = doc?.versions.find((v) => v.id === doc.currentVersionId);
          const merge = (version?.renderData ?? null) as MergeData | null;
          const letter = template && merge ? applyMerge(locale === "ar" ? template.bodyAr : template.bodyEn, locale === "ar" ? merge.ar : merge.en) : null;
          const decider = deciders.find((m) => m.id === p.decidedById);
          const link = ctx.membership.guardian?.links.find((l) => l.studentId === p.studentId);
          return (
            <Panel key={p.id} className="space-y-4" >
              <div className="flex flex-wrap items-center justify-between gap-2" data-testid="consent-card">
                <div>
                  <div className="font-semibold">{personName(kid, locale)}</div>
                  <div className="text-xs text-muted-foreground">{t("gradeN", { grade: kid.gradeLevel })}</div>
                </div>
                <Pill tone={CONSENT_TONE[p.consent]} dot>
                  <span data-testid="consent-status">{t(`consent.${p.consent}`)}</span>
                </Pill>
              </div>
              {p.decidedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("decidedBy", { name: userName(decider?.user, locale), when: fmtDateTime(prefs, p.decidedAt) })}
                  {p.noteEn && ` · "${p.noteEn}"`}
                </p>
              )}
              {letter && (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <FileText className="size-4" />
                      {t("letter")}
                    </span>
                    <Button asChild variant="outline" size="sm">
                      <a href={`/api/documents/${doc!.id}/download?inline=1`} target="_blank" rel="noopener" data-testid="letter-pdf">
                        {t("letterPdf")}
                      </a>
                    </Button>
                  </div>
                  <div className="max-h-72 overflow-y-auto whitespace-pre-line text-sm leading-relaxed" data-testid="letter-text">
                    {letter}
                  </div>
                </div>
              )}
              {canDecide && link && !link.canApprove && <p className="text-sm text-muted-foreground">{t("cannotApprove")}</p>}
              {canDecide && link?.canApprove && <ConsentButtons participantId={p.id} current={p.consent} childName={locale === "ar" ? kid.firstNameAr : kid.firstNameEn} />}
              {ctx.isParent && !canDecide && trip.status === "PUBLISHED" && <p className="text-xs text-muted-foreground">{t("closedForDecisions")}</p>}
            </Panel>
          );
        })}
      </PageBody>
    );
  }

  // Staff view: consent board for organisers, a summary for everyone else.
  const participants = await db.tripParticipant.findMany({ where: { tripId: trip.id } });
  const students = await db.student.findMany({ where: { id: { in: participants.map((p) => p.studentId) } } });
  const deciders = await db.membership.findMany({ where: { id: { in: participants.map((p) => p.decidedById).filter(Boolean) as string[] } }, include: { user: true } });
  const n = (c: TripConsent) => participants.filter((p) => p.consent === c).length;
  const filter = CONSENTS.includes(sp.consent as TripConsent) ? (sp.consent as TripConsent) : null;
  const rows = participants
    .filter((p) => !filter || p.consent === filter)
    .map((p) => ({ p, s: students.find((s) => s.id === p.studentId)! }))
    .filter((r) => r.s)
    .sort((a, b) => a.s.gradeLevel - b.s.gradeLevel || (a.s.section ?? "").localeCompare(b.s.section ?? "") || a.s.lastNameEn.localeCompare(b.s.lastNameEn));

  return (
    <PageBody>
      {header}
      {manage && <TripOrganiserActions id={trip.id} status={trip.status} ended={ended} pending={n("PENDING")} participants={participants.length} />}
      {info}
      {trip.status === "DRAFT" ? (
        <EmptyState icon={<FileText className="size-5" />} title={t("draftBoardTitle")} body={t("draftBoardBody")} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3" data-testid="consent-board">
            <StatCard label={t("consent.GRANTED")} value={fmtNumber(prefs, n("GRANTED"))} icon={<CheckCircle2 className="size-5" />} tone="success" href={manage ? `/trips/${trip.id}?consent=GRANTED` : undefined} testId="count-granted" />
            <StatCard label={t("consent.DECLINED")} value={fmtNumber(prefs, n("DECLINED"))} icon={<XCircle className="size-5" />} tone="danger" href={manage ? `/trips/${trip.id}?consent=DECLINED` : undefined} testId="count-declined" />
            <StatCard label={t("consent.PENDING")} value={fmtNumber(prefs, n("PENDING"))} icon={<Clock className="size-5" />} tone="warning" href={manage ? `/trips/${trip.id}?consent=PENDING` : undefined} testId="count-pending" />
          </div>
          {manage && (
            <Panel padded={false} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-1.5 border-b p-3">
                <Link href={`/trips/${trip.id}`} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !filter ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground")}>
                  {t("allStudents", { count: participants.length })}
                </Link>
                {CONSENTS.map((c) => (
                  <Link key={c} href={`/trips/${trip.id}?consent=${c}`} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", filter === c ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground")}>
                    {t(`consent.${c}`)}
                  </Link>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{t("noneInFilter")}</p>
              ) : (
                <ul className="divide-y" data-testid="participant-list">
                  {rows.map(({ p, s }) => {
                    const d = deciders.find((m) => m.id === p.decidedById);
                    return (
                      <li key={p.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/students/${s.id}`} className="font-medium hover:underline">
                            {personName(s, locale)}
                          </Link>
                          <span className="ms-2 text-xs text-muted-foreground">
                            {s.gradeLevel}
                            {s.section ?? ""}
                          </span>
                          {p.noteEn && <div className="text-xs text-muted-foreground">&ldquo;{p.noteEn}&rdquo;</div>}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.decidedAt ? t("decidedBy", { name: userName(d?.user, locale), when: fmtDateTime(prefs, p.decidedAt) }) : p.letterSentAt ? t("letterSent", { when: fmtDate(prefs, p.letterSentAt) }) : ""}</div>
                        <Pill tone={CONSENT_TONE[p.consent]} dot>
                          {t(`consent.${p.consent}`)}
                        </Pill>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}
      {manage && <p className="text-xs text-muted-foreground">{t("auditNote")}</p>}
    </PageBody>
  );
}
