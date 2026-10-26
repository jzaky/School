import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, HandHelping, Search, School, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { gradeLevelValues } from "@/lib/grade-levels";
import { currentYear, selectionYear } from "@/server/registration/service";
import { progressFor, selectionActorFromCtx, sessionClasses, studentsOf } from "@/server/registration/selection";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/registration/assist-controls";

export async function generateMetadata() {
  const t = await getTranslations("selection.helpPage");
  return { title: t("title") };
}

const LIMIT = 40;

/** "Help a student choose": students who asked this teacher for help, and a search over the teacher's own students. */
export default async function HelpStudentsChoosePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.isStaff || !(ctx.can("registration.assist") || ctx.can("registration.manage"))) notFound();
  const t = await getTranslations("selection.helpPage");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { orgId, locale } = ctx;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const now = new Date();
  const actor = selectionActorFromCtx(ctx);

  const data = await tenantTx(
    orgId,
    async (tx) => {
      const [mine, grants, homerooms, year, next] = await Promise.all([
        studentsOf(tx, orgId, actor, now),
        tx.courseSelectionHelper.findMany({ where: { orgId, helperId: ctx.membershipId, kind: "STAFF", revokedAt: null, until: { gt: now } }, orderBy: { until: "asc" } }),
        sessionClasses(tx, orgId, actor),
        currentYear(tx, orgId),
        selectionYear(tx, orgId),
      ]);
      const words = q.split(/\s+/).filter(Boolean);
      const where = {
        orgId,
        status: "ACTIVE" as const,
        ...(mine === null ? {} : { id: { in: mine } }),
        ...(words.length
          ? { AND: words.map((w) => ({ OR: [{ firstNameEn: { contains: w, mode: "insensitive" as const } }, { lastNameEn: { contains: w, mode: "insensitive" as const } }, { firstNameAr: { contains: w } }, { lastNameAr: { contains: w } }, { studentNo: { contains: w, mode: "insensitive" as const } }] })) }
          : {}),
      };
      const own = homerooms.filter((c) => c.teacherMembershipId === ctx.membershipId).map((c) => c.id);
      // Without a search: the teacher's own homeroom first, then everyone they teach or advise.
      const homeroomIds = own.length ? (await tx.enrollment.findMany({ where: { orgId, classId: { in: own } }, select: { studentId: true } })).map((e) => e.studentId) : [];
      const results = await tx.student.findMany({ where, orderBy: [{ gradeLevel: "asc" }, { section: "asc" }, { lastNameEn: "asc" }], take: words.length ? LIMIT : 400 });
      const ordered = words.length ? results : [...results.filter((s) => homeroomIds.includes(s.id)), ...results.filter((s) => !homeroomIds.includes(s.id))].slice(0, LIMIT);
      const asked = grants.length ? await tx.student.findMany({ where: { orgId, id: { in: grants.map((g) => g.studentId) } } }) : [];
      const all = [...ordered, ...asked.filter((a) => !ordered.some((o) => o.id === a.id))];
      // Status for next year's course selection where it applies, otherwise this year.
      const nextProgress = next ? await progressFor(tx, orgId, next.id, all) : new Map();
      const thisProgress = year ? await progressFor(tx, orgId, year.id, all.filter((s) => !nextProgress.has(s.id))) : new Map();
      const rooms = year ? await tx.enrollment.findMany({ where: { orgId, studentId: { in: all.map((s) => s.id) }, class: { academicYearId: year.id, isHomeroom: true } }, include: { class: true } }) : [];
      return { total: mine === null ? null : mine.length, results: ordered, asked, grants, homerooms: own.length, nextProgress, thisProgress, rooms, hasNext: !!next };
    },
    { timeout: 60_000 },
  );
  const room = new Map(data.rooms.map((r) => [r.studentId, pick(locale, r.class.nameEn, r.class.nameAr)]));
  const statusOf = (id: string) => (data.nextProgress.get(id) ?? data.thisProgress.get(id))?.status ?? null;
  const yearOf = (id: string) => (data.nextProgress.has(id) ? "next" : "current");
  const grantOf = (id: string) => data.grants.find((g) => g.studentId === id) ?? null;

  const row = (s: (typeof data.results)[number], highlight = false) => {
    const status = statusOf(s.id);
    const grant = grantOf(s.id);
    return (
      <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3" data-testid={highlight ? "asked-row" : "help-student"}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{personName(s, locale)}</div>
          <div className="text-xs text-muted-foreground">
            {[room.get(s.id) ?? tg("label", gradeLevelValues(s.gradeLevel)), grant ? t("canHelpUntil", { date: fmtDateTime(prefs, grant.until) }) : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          {status ? <StatusPill status={status} /> : <span />}
          <Button asChild size="sm" variant={grant || ctx.can("registration.manage") ? "default" : "outline"}>
            <Link href={`/subjects?student=${s.id}&year=${yearOf(s.id)}`} data-testid="help-open">
              {grant || ctx.can("registration.manage") ? t("helpChoose") : t("open")}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          </Button>
        </div>
      </li>
    );
  };

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          data.homerooms > 0 || ctx.can("registration.manage") ? (
            <Button asChild variant="outline">
              <Link href="/subjects/session" data-testid="open-sessions">
                <School className="size-4" />
                {t("classSession")}
              </Link>
            </Button>
          ) : null
        }
      />
      {data.asked.length > 0 && (
        <Panel>
          <PanelHeader title={t("askedTitle")} description={t("askedBody")} icon={<HandHelping className="size-4" />} />
          <ul className="divide-y" data-testid="asked-list">
            {data.asked.map((s) => row(s, true))}
          </ul>
        </Panel>
      )}
      <Panel>
        <PanelHeader title={t("studentsTitle")} description={data.total === null ? t("studentsAll") : t("studentsMine", { count: data.total })} icon={<Users className="size-4" />} />
        <form method="get" className="mb-3 flex gap-2" role="search">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} className="ps-9" aria-label={t("searchPlaceholder")} data-testid="help-search" />
          </div>
          <Button type="submit" variant="outline">
            {t("search")}
          </Button>
        </form>
        {data.results.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title={q ? t("noMatch") : t("noStudents")} body={q ? t("noMatchBody") : t("noStudentsBody")} />
        ) : (
          <>
            <ul className="divide-y" data-testid="help-results">
              {data.results.map((s) => row(s))}
            </ul>
            {!q && data.total !== null && data.total > LIMIT && <p className="mt-2 text-xs text-muted-foreground">{t("more", { shown: LIMIT, total: data.total })}</p>}
          </>
        )}
      </Panel>
    </PageBody>
  );
}
