import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, Clock, Download, FolderOpen, Inbox, MapPin, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtHijri, fmtTime } from "@/lib/format";
import { initials, personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { AppointmentStatusBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { MeetingActions } from "@/components/meetings/meeting-actions";
import { appointmentWhere } from "@/server/appointments/queries";
import { loadBookingSetup } from "@/server/appointments/booking-setup";
import { canViewCase } from "@/server/access/case-access";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("meetings");
  const prefs = await formatPrefs(ctx);
  const a = await ctx.db.appointment.findFirst({ where: { AND: [{ id }, appointmentWhere(ctx)] }, include: { type: true, attendees: true } });
  if (!a) notFound();
  const memberIds = [...new Set([a.hostId, ...a.attendees.map((x) => x.membershipId).filter(Boolean)])] as string[];
  const [members, student, theCase] = await Promise.all([
    ctx.db.membership.findMany({ where: { id: { in: memberIds } }, include: { user: true, staffProfile: true } }),
    a.studentId ? ctx.db.student.findUnique({ where: { id: a.studentId } }) : null,
    a.caseId && ctx.isStaff ? ctx.db.case.findUnique({ where: { id: a.caseId } }) : null,
  ]);
  const host = members.find((m) => m.id === a.hostId);
  const isHost = a.hostId === ctx.membershipId;
  const isPast = a.endsAt.getTime() < Date.now();
  const canChange = a.status === "CONFIRMED" || a.status === "SCHEDULED";
  const setup = canChange ? await loadBookingSetup(ctx, a.type.key, a.studentId) : null;
  const sameHostSetup = setup ? { ...setup, hosts: setup.hosts.filter((h) => h.id === a.hostId), type: { ...setup.type, hostMode: "SPECIFIC" as const } } : null;
  const caseVisible = theCase ? await canViewCase(ctx, theCase, { audit: false }) : false;
  return (
    <PageBody className="max-w-4xl">
      <Link href="/meetings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>
      <Panel className="overflow-hidden p-0">
        <div className="h-2" style={{ background: a.type.color }} />
        <div className="space-y-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <AppointmentStatusBadge status={a.status} />
              <h1 className="mt-2 text-2xl font-semibold tracking-tight" data-testid="meeting-title">
                {pick(ctx.locale, a.type.nameEn, a.type.nameAr)}
              </h1>
              {student && <p className="text-sm text-muted-foreground">{t("about", { name: personName(student, ctx.locale) })}</p>}
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/meetings/${a.id}/ics`}>
                <Download className="size-4" />
                {t("addToCalendar")}
              </a>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 size-5 text-brand" />
              <div>
                <div className="text-sm font-medium" data-testid="meeting-date">
                  {fmtDate(prefs, a.startsAt, "long")}
                </div>
                {prefs.hijri && <div className="text-xs text-muted-foreground">{fmtHijri(prefs, a.startsAt)}</div>}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 size-5 text-brand" />
              <div className="text-sm font-medium">
                {fmtTime(prefs, a.startsAt)} - {fmtTime(prefs, a.endsAt)}
              </div>
            </div>
            {a.locationEn && (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-5 text-brand" />
                <div className="text-sm font-medium">{pick(ctx.locale, a.locationEn, a.locationAr)}</div>
              </div>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Users className="size-3.5" />
              {t("attendees")}
            </div>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <span key={m.id} className="flex items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-sm">
                  <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{initials(m.user.nameEn)}</span>
                  {userName(m.user, ctx.locale)}
                  {m.id === host?.id && <span className="text-xs text-muted-foreground">· {t("host")}</span>}
                </span>
              ))}
            </div>
          </div>
          {a.cancelReason && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t("cancelNote", { reason: a.cancelReason })}</p>}
          <div className="flex flex-wrap items-center gap-3 border-t pt-5">
            <MeetingActions appointmentId={a.id} setup={sameHostSetup} studentId={a.studentId} caseId={a.caseId} isHost={isHost} canChange={canChange} isPast={isPast} />
            <div className="ms-auto flex gap-3 text-sm">
              {a.requestId && (
                <Link href={`/requests/${a.requestId}`} className="inline-flex items-center gap-1.5 text-brand hover:underline">
                  <Inbox className="size-4" />
                  {t("request")}
                </Link>
              )}
              {theCase && caseVisible && (
                <Link href={`/cases/${theCase.id}`} className="inline-flex items-center gap-1.5 text-brand hover:underline">
                  <FolderOpen className="size-4" />
                  {t("case")}
                </Link>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </PageBody>
  );
}
