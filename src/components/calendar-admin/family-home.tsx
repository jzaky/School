import { getTranslations } from "next-intl/server";
import { Bus, GraduationCap } from "lucide-react";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { fmtDate, fmtTime } from "@/lib/format";
import { firstName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { CONSENT_TONE } from "@/components/trips/tones";

/** Home panel for students and parents: next exams and upcoming trips (with consent still needed). */
export async function SchoolDatesPanel({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("exams");
  const tt = await getTranslations("trips");
  const kids = ctx.isStudent ? (ctx.membership.student ? [ctx.membership.student] : []) : (ctx.membership.guardian?.links.map((l) => l.student) ?? []);
  if (!kids.length) return null;
  const now = new Date();
  const grades = [...new Set(kids.map((k) => k.gradeLevel))];
  const [exams, trips] = await Promise.all([
    ctx.db.examSitting.findMany({ where: { status: "PUBLISHED", gradeLevel: { in: grades }, endsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 4 }),
    ctx.db.tripParticipant.findMany({ where: { studentId: { in: kids.map((k) => k.id) }, trip: { status: "PUBLISHED", endsAt: { gt: now } } }, include: { trip: true }, orderBy: { trip: { startsAt: "asc" } }, take: 4 }),
  ]);
  if (!exams.length && !trips.length) return null;
  return (
    <Panel>
      {trips.length > 0 && (
        <>
          <PanelHeader title={tt("homeTitle")} icon={<Bus className="size-4" />} action={<Link href="/trips" className="text-xs font-medium text-brand">{tt("viewAll")}</Link>} />
          <ul className="mb-4 space-y-2">
            {trips.map((p) => {
              const kid = kids.find((k) => k.id === p.studentId);
              return (
                <li key={p.id}>
                  <Link href={`/trips/${p.tripId}`} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm hover:bg-muted/40" data-testid="home-trip">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{pick(ctx.locale, p.trip.titleEn, p.trip.titleAr)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {fmtDate(prefs, p.trip.startsAt)}
                        {ctx.isParent && kid && ` · ${firstName(kid, ctx.locale)}`}
                      </span>
                    </span>
                    <Pill tone={CONSENT_TONE[p.consent]}>{tt(`consent.${p.consent}`)}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {exams.length > 0 && (
        <>
          <PanelHeader title={t("homeTitle")} icon={<GraduationCap className="size-4" />} action={<Link href="/exams" className="text-xs font-medium text-brand">{t("viewAll")}</Link>} />
          <ul className="space-y-1.5">
            {exams.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {pick(ctx.locale, e.titleEn, e.titleAr)}
                  {grades.length > 1 && <span className="ms-1 text-xs text-muted-foreground">({t("gradeN", { grade: e.gradeLevel })})</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {fmtDate(prefs, e.startsAt, "short")} · {fmtTime(prefs, e.startsAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
