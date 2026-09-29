import { getTranslations } from "next-intl/server";
import { Download, GraduationCap, MapPin, ShieldCheck } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtTime } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { publishedSittings, timetableStudents } from "@/server/exams/queries";
import { dayKey } from "@/server/exams/schedule";

export async function generateMetadata() {
  const t = await getTranslations("exams");
  return { title: t("title") };
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ student?: string; grade?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("exams");
  const prefs = await formatPrefs(ctx);
  const { locale } = ctx;
  const students = timetableStudents(ctx);
  const chosen = students ? (students.find((s) => s.id === sp.student) ?? students[0] ?? null) : null;
  const grade = students ? (chosen?.gradeLevel ?? null) : sp.grade && /^\d{1,2}$/.test(sp.grade) ? Number(sp.grade) : 9;
  const now = new Date();
  const sittings = grade !== null ? await publishedSittings(ctx, grade) : [];
  const upcoming = sittings.filter((s) => s.endsAt > now);
  const past = sittings.filter((s) => s.endsAt <= now);
  const duties = ctx.isStaff ? await ctx.db.examSitting.findMany({ where: { status: "PUBLISHED", invigilatorIds: { has: ctx.membershipId }, endsAt: { gt: now } }, orderBy: { startsAt: "asc" } }) : [];
  const pdfHref = students ? `/api/exams/timetable?student=${chosen?.id ?? ""}` : `/api/exams/timetable?grade=${grade}`;
  const byDay = new Map<string, typeof upcoming>();
  for (const s of upcoming) byDay.set(dayKey(s.startsAt), [...(byDay.get(dayKey(s.startsAt)) ?? []), s]);

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={ctx.isParent ? t("subtitleParent") : ctx.isStudent ? t("subtitleStudent") : t("subtitleStaff")}
        actions={
          sittings.length > 0 ? (
            <Button asChild variant="outline">
              <a href={pdfHref} target="_blank" rel="noopener" data-testid="exam-pdf">
                <Download className="size-4" />
                {t("downloadPdf")}
              </a>
            </Button>
          ) : null
        }
      />
      {students && students.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {students.map((s) => (
            <Link key={s.id} href={`/exams?student=${s.id}`} className={cn("rounded-full border px-3 py-1 text-sm font-medium", s.id === chosen?.id ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")} data-testid="exam-child">
              {personName(s, locale)} · {t("gradeN", { grade: s.gradeLevel })}
            </Link>
          ))}
        </div>
      )}
      {!students && (
        <div className="flex flex-wrap gap-1.5">
          {GRADES.map((g) => (
            <Link key={g} href={`/exams?grade=${g}`} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", grade === g ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground")}>
              {t("gradeN", { grade: g })}
            </Link>
          ))}
        </div>
      )}

      {duties.length > 0 && (
        <Panel>
          <PanelHeader title={t("myDuties")} icon={<ShieldCheck className="size-4" />} description={t("myDutiesBody")} />
          <ul className="divide-y" data-testid="duties">
            {duties.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-40 text-xs tabular-nums text-muted-foreground">{fmtDate(prefs, d.startsAt)} · {fmtTime(prefs, d.startsAt)}</span>
                <span className="font-medium">{pick(locale, d.titleEn, d.titleAr)}</span>
                <Pill tone="brand">{t("gradeN", { grade: d.gradeLevel })}</Pill>
                {d.room && <span className="text-xs text-muted-foreground">{d.room}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {upcoming.length === 0 ? (
        <EmptyState icon={<GraduationCap className="size-5" />} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <div className="space-y-3" data-testid="exam-timetable">
          {[...byDay.entries()].map(([k, list]) => (
            <Panel key={k} padded={false} className="overflow-hidden">
              <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">{fmtDate(prefs, list[0].startsAt, "long")}</div>
              <ul className="divide-y">
                {list.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3" data-testid="exam-row">
                    <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtTime(prefs, s.startsAt)} - {fmtTime(prefs, s.endsAt)}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{pick(locale, s.titleEn, s.titleAr)}</span>
                    {s.room && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" />
                        {s.room}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
      {past.length > 0 && <p className="text-xs text-muted-foreground">{t("pastCount", { count: past.length })}</p>}
    </PageBody>
  );
}
