import { getTranslations } from "next-intl/server";
import { CalendarClock, CalendarPlus, MapPin } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtTime, fmtWeekday } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader, SectionTitle } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { AppointmentStatusBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { appointmentWhere } from "@/server/appointments/queries";

export async function generateMetadata() {
  const t = await getTranslations("meetings");
  return { title: t("title") };
}

export default async function MeetingsPage() {
  const ctx = await getCtx();
  const t = await getTranslations("meetings");
  const prefs = await formatPrefs(ctx);
  const now = new Date();
  const scope = await appointmentWhere(ctx);
  const [upcoming, past] = await Promise.all([
    ctx.db.appointment.findMany({ where: { AND: [scope, { endsAt: { gte: now }, status: { in: ["CONFIRMED", "SCHEDULED"] } }] }, include: { type: true }, orderBy: { startsAt: "asc" }, take: 30 }),
    ctx.db.appointment.findMany({ where: { AND: [scope, { OR: [{ endsAt: { lt: now } }, { status: { in: ["CANCELLED", "COMPLETED", "NO_SHOW"] } }] }] }, include: { type: true }, orderBy: { startsAt: "desc" }, take: 15 }),
  ]);
  const ids = [...upcoming, ...past];
  const [members, students] = await Promise.all([
    ctx.db.membership.findMany({ where: { id: { in: [...new Set(ids.map((a) => a.hostId))] } }, include: { user: true } }),
    ctx.db.student.findMany({ where: { id: { in: [...new Set(ids.map((a) => a.studentId).filter(Boolean) as string[])] } } }),
  ]);
  const Row = ({ a }: { a: (typeof upcoming)[number] }) => {
    const host = members.find((m) => m.id === a.hostId);
    const student = students.find((s) => s.id === a.studentId);
    const hosting = a.hostId === ctx.membershipId;
    return (
      <li>
        <Link href={`/meetings/${a.id}`} className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-muted/40 sm:px-5" data-testid="meeting-row">
          <div className="flex w-16 shrink-0 flex-col items-center rounded-lg border bg-card py-1.5">
            <span className="text-[10px] font-medium uppercase text-muted-foreground">{fmtWeekday(prefs, a.startsAt)}</span>
            <span className="text-lg font-semibold leading-none tabular-nums">{fmtDate(prefs, a.startsAt, "short").split(" ")[0]}</span>
            <span className="text-[10px] text-muted-foreground">{fmtDate(prefs, a.startsAt, "short").split(" ").slice(1).join(" ")}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{pick(ctx.locale, a.type.nameEn, a.type.nameAr)}</div>
            <div className="truncate text-xs text-muted-foreground">
              {fmtTime(prefs, a.startsAt)} · {hosting ? (student ? personName(student, ctx.locale) : "") : host ? userName(host.user, ctx.locale) : ""}
              {!hosting && student && !ctx.isStudent ? ` · ${personName(student, ctx.locale)}` : ""}
            </div>
            {a.locationEn && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="size-3" />
                {pick(ctx.locale, a.locationEn, a.locationAr)}
              </div>
            )}
          </div>
          <AppointmentStatusBadge status={a.status} />
        </Link>
      </li>
    );
  };
  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button asChild data-testid="book-meeting">
            <Link href={ctx.isParent ? "/services/parent_meeting" : ctx.isStudent ? "/services/counselor_meeting" : "/book"}>
              <CalendarPlus className="size-4" />
              {t("book")}
            </Link>
          </Button>
        }
      />
      <section>
        <SectionTitle>{t("upcoming")}</SectionTitle>
        {upcoming.length === 0 ? (
          <EmptyState icon={<CalendarClock className="size-5" />} title={t("noUpcoming")} body={t("noUpcomingBody")} />
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {upcoming.map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </ul>
        )}
      </section>
      {past.length > 0 && (
        <section>
          <SectionTitle>{t("past")}</SectionTitle>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card opacity-90 shadow-xs">
            {past.map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}
    </PageBody>
  );
}
