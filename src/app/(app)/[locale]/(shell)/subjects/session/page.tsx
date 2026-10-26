import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, ChevronLeft, History, School } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { gradeLevelValues } from "@/lib/grade-levels";
import { SESSION_MINUTES, selectionActorFromCtx, sessionActive, sessionClasses, sessionYearFor } from "@/server/registration/selection";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { StartSessionForm } from "@/components/registration/session-live";

export async function generateMetadata() {
  const t = await getTranslations("selection.session");
  return { title: t("title") };
}

export default async function ClassSessionsPage() {
  const ctx = await getCtx();
  if (!ctx.isStaff || !(ctx.can("registration.assist") || ctx.can("registration.manage"))) notFound();
  const t = await getTranslations("selection.session");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { orgId, locale } = ctx;
  const now = new Date();
  const data = await tenantTx(orgId, async (tx) => {
    const classes = await sessionClasses(tx, orgId, selectionActorFromCtx(ctx));
    // Admins see every homeroom; keep the page short by listing only classes with students.
    const counts = await tx.enrollment.groupBy({ by: ["classId"], where: { orgId, classId: { in: classes.map((c) => c.id) } }, _count: { _all: true } });
    const sessions = await tx.courseSelectionSession.findMany({ where: { orgId, classId: { in: classes.map((c) => c.id) } }, orderBy: { startsAt: "desc" }, take: 40 });
    const years = new Map<number, { nameEn: string; nameAr: string } | null>();
    for (const g of [...new Set(classes.map((c) => c.gradeLevel))]) {
      const y = await sessionYearFor(tx, orgId, g);
      years.set(g, y ? { nameEn: y.nameEn, nameAr: y.nameAr } : null);
    }
    return { classes, counts: new Map(counts.map((c) => [c.classId, c._count._all])), sessions, years };
  });
  const list = data.classes.filter((c) => (data.counts.get(c.id) ?? 0) > 0);
  const history = data.sessions.filter((s) => !sessionActive(s, now) && s.startsAt <= now).slice(0, 8);

  return (
    <PageBody>
      <div>
        <Link href="/subjects/help" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {t("back")}
        </Link>
      </div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      {list.length === 0 ? (
        <EmptyState icon={<School className="size-5" />} title={t("noClasses")} body={t("noClassesBody")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((c) => {
            const live = data.sessions.find((s) => s.classId === c.id && sessionActive(s, now));
            const year = data.years.get(c.gradeLevel);
            return (
              <section key={c.id} className="space-y-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5" data-testid="session-class">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{pick(locale, c.nameEn, c.nameAr)}</h2>
                    <p className="text-xs text-muted-foreground">
                      {tg("label", gradeLevelValues(c.gradeLevel))} · {t("studentsN", { count: data.counts.get(c.id) ?? 0 })}
                      {year ? ` · ${t("forYear", { year: `⁦${pick(locale, year.nameEn, year.nameAr)}⁩` })}` : ""}
                    </p>
                  </div>
                  {live && (
                    <Pill tone="success" dot>
                      {t("live")}
                    </Pill>
                  )}
                </div>
                {live ? (
                  <Link href={`/subjects/session/${live.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success-soft/40 px-3 py-2.5 text-sm font-medium" data-testid="session-open-live">
                    <span>{t("liveUntil", { time: fmtTime(prefs, live.endsAt) })}</span>
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Link>
                ) : (
                  <StartSessionForm classId={c.id} minutes={SESSION_MINUTES} />
                )}
              </section>
            );
          })}
        </div>
      )}
      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4 text-muted-foreground" />
            {t("history")}
          </h2>
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {history.map((s) => {
              const c = data.classes.find((x) => x.id === s.classId);
              return (
                <li key={s.id}>
                  <Link href={`/subjects/session/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-muted/40">
                    <span className="font-medium">{c ? pick(locale, c.nameEn, c.nameAr) : ""}</span>
                    <span className="text-xs text-muted-foreground">{t("historyLine", { start: fmtDateTime(prefs, s.startsAt), end: fmtTime(prefs, s.endedAt ?? s.endsAt) })}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </PageBody>
  );
}
