import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckCheck, FileText, Hourglass, Send, Settings2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { personName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { AccessTabs } from "@/components/access/access-tabs";
import { Button } from "@/components/ui/button";
import { PublishList, PublishModeForm, ReportCardList, type QueueRow } from "@/components/grades/publish-queue";
import { viewerFromCtx } from "@/server/grades/queries";
import { canPublish, publishModeOf, publishQueue, reportCardQueue } from "@/server/grades/publishing";

export async function generateMetadata() {
  const t = await getTranslations("grades.publishing");
  return { title: t("title") };
}

type SP = { tab?: string; class?: string; teacher?: string; page?: string };

export default async function GradePublishingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const v = viewerFromCtx(ctx);
  const publisher = canPublish(v);
  const manager = ctx.isStaff && ctx.can("school.manage");
  if (!publisher && !manager) notFound();
  const t = await getTranslations("grades.publishing");
  const tk = await getTranslations("grades.kind");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { locale } = ctx;
  const mode = await publishModeOf(ctx.db);
  const publishers = manager ? await ctx.db.membership.count({ where: { status: "ACTIVE", roles: { some: { role: { permissions: { has: "grades.publish" } } } } } }) : 0;
  const tab = ["ready", "published", "waiting", "cards"].includes(sp.tab ?? "") ? sp.tab! : "ready";
  const page = Math.max(1, Number(sp.page) || 1);
  const filter = { classId: sp.class ?? null, teacherId: sp.teacher ?? null };

  const modePanel = manager ? (
    <Panel className="max-w-2xl">
      <PanelHeader title={t("modeTitle")} description={t("modeBody")} icon={<Settings2 className="size-4" />} />
      <PublishModeForm mode={mode} publishers={publishers} />
    </Panel>
  ) : null;

  if (mode === "TEACHER" || !publisher) {
    return (
      <PageBody>
        <PageHeader title={t("title")} description={mode === "TEACHER" ? t("subtitleTeacherMode") : t("subtitlePublisherMode")} />
        {modePanel}
        {!publisher && mode === "PUBLISHER" && <EmptyState icon={<Send className="size-5" />} title={t("notPublisherTitle")} body={t("notPublisherBody")} />}
        {mode === "TEACHER" && publisher && <EmptyState icon={<Send className="size-5" />} title={t("teacherModeTitle")} body={t("teacherModeBody")} />}
      </PageBody>
    );
  }

  const queue = tab === "cards" ? null : await publishQueue(v, { status: tab as "ready" | "published" | "waiting", classId: filter.classId, teacherId: filter.teacherId, page });
  const cards = await reportCardQueue(v, tab === "cards" ? page : 1);
  if (!cards) notFound();
  const counts = queue ?? (await publishQueue(v, { status: "ready", page: 1 }))!;
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { tab: tab === "ready" ? null : tab, class: filter.classId, teacher: filter.teacherId, page: null as string | null, ...patch };
    for (const [k, val] of Object.entries(merged)) if (val) p.set(k, val);
    const s = p.toString();
    return `/grades/publish${s ? `?${s}` : ""}`;
  };
  const rows: QueueRow[] = (queue?.rows ?? []).map((r) => ({
    id: r.id,
    title: pick(locale, r.titleEn, r.titleAr),
    kind: tk(r.kind),
    cls: `${pick(locale, r.cls.en, r.cls.ar)} (${tg("label", gradeLevelValues(r.cls.gradeLevel))})`,
    subject: r.cls.subject ? pick(locale, r.cls.subject.en, r.cls.subject.ar) : null,
    teacher: r.teacher ? pick(locale, r.teacher.en, r.teacher.ar) : null,
    when: tab === "published" ? (r.publishedAt ? fmtDate(prefs, r.publishedAt, "short") : null) : r.readyAt ? fmtDate(prefs, r.readyAt, "short") : null,
    by: tab === "published" ? (r.publishedBy ? pick(locale, r.publishedBy.en, r.publishedBy.ar) : null) : r.readyBy ? pick(locale, r.readyBy.en, r.readyBy.ar) : null,
    marked: r.marked,
    students: r.students,
  }));

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitlePublisherMode")}
        actions={
          manager ? (
            <Button variant="outline" asChild>
              <Link href="#mode">{t("modeTitle")}</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("statReady")} value={fmtNumber(prefs, counts.readyCount)} hint={t("statReadyHint")} icon={<Send className="size-4" />} tone={counts.readyCount ? "brand" : "success"} testId="stat-ready" />
        <StatCard label={t("statWaiting")} value={fmtNumber(prefs, counts.waitingCount)} hint={t("statWaitingHint")} icon={<Hourglass className="size-4" />} tone="info" />
        <StatCard label={t("statCards")} value={fmtNumber(prefs, cards.total)} hint={t("statCardsHint")} icon={<FileText className="size-4" />} tone={cards.total ? "warning" : "success"} />
      </div>
      <AccessTabs
        current={tab}
        label={t("title")}
        tabs={[
          { value: "ready", label: t("tabReady"), href: href({ tab: null }), count: counts.readyCount },
          { value: "published", label: t("tabPublished"), href: href({ tab: "published" }) },
          { value: "waiting", label: t("tabWaiting"), href: href({ tab: "waiting" }) },
          { value: "cards", label: t("tabCards"), href: href({ tab: "cards", class: null, teacher: null }), count: cards.total },
        ]}
      />
      {tab !== "cards" && queue && (queue.classOptions.length > 0 || queue.teacherOptions.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="queue-filters">
          <span className="me-1 text-muted-foreground">{t("filterBy")}</span>
          <Link href={href({ class: null, teacher: null })} className={`rounded-full border px-3 py-1 font-medium ${!filter.classId && !filter.teacherId ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground"}`}>
            {t("allReady")}
          </Link>
          {queue.teacherOptions.map((o) => (
            <Link key={o.id} href={href({ teacher: o.id, class: null })} className={`rounded-full border px-3 py-1 font-medium ${filter.teacherId === o.id ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground"}`}>
              {pick(locale, o.name.en, o.name.ar)}
            </Link>
          ))}
          {queue.classOptions.map((o) => (
            <Link key={o.id} href={href({ class: o.id, teacher: null })} className={`rounded-full border px-3 py-1 font-medium ${filter.classId === o.id ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground"}`}>
              {pick(locale, o.en, o.ar)} · {o.ready}
            </Link>
          ))}
        </div>
      )}
      {tab === "cards" ? (
        cards.rows.length === 0 ? (
          <EmptyState icon={<CheckCheck className="size-5" />} title={t("noCards")} body={t("noCardsBody")} />
        ) : (
          <ReportCardList
            total={cards.total}
            rows={cards.rows.map((r) => ({
              id: r.id,
              student: r.student ? personName(r.student, locale) : "",
              detail: r.student ? `${tg("label", gradeLevelValues(r.student.gradeLevel))}${r.student.section ?? ""}` : "",
              title: pick(locale, r.titleEn, r.titleAr),
              when: fmtDate(prefs, r.updatedAt, "short"),
            }))}
          />
        )
      ) : rows.length === 0 ? (
        <EmptyState icon={<CheckCheck className="size-5" />} title={t(`empty.${tab}`)} />
      ) : (
        <PublishList key={`${tab}:${filter.classId}:${filter.teacherId}:${page}`} rows={rows} mode={tab as "ready" | "published" | "waiting"} total={queue!.total} filter={filter} />
      )}
      {((tab === "cards" ? cards.pages : queue?.pages ?? 1) > 1) && (
        <div className="flex items-center justify-between text-sm" data-testid="pager">
          <span className="text-muted-foreground">{t("pageOf", { page, pages: tab === "cards" ? cards.pages : queue!.pages })}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={href({ page: String(page - 1) })}>{t("previousPage")}</Link>
              </Button>
            )}
            {page < (tab === "cards" ? cards.pages : queue!.pages) && (
              <Button variant="outline" size="sm" asChild>
                <Link href={href({ page: String(page + 1) })}>{t("nextPage")}</Link>
              </Button>
            )}
          </div>
        </div>
      )}
      {modePanel && (
        <div id="mode" className="scroll-mt-24 pt-4">
          {modePanel}
        </div>
      )}
    </PageBody>
  );
}
