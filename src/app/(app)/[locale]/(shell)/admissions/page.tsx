import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ClipboardList, FileClock, Hourglass, Inbox, Link2, UserPlus } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { canManageAdmissions, canViewAdmissions } from "@/server/admissions/access";
import { loadBoard } from "@/server/admissions/queries";
import { authorityNames, filterOptions, filtersFrom, type SP } from "@/server/admissions/page-data";
import { AdmissionsBoard } from "@/components/admissions/board";
import { AdmissionFilters } from "@/components/admissions/filters";
import { CopyLink } from "@/components/admissions/copy-link";

export async function generateMetadata() {
  const t = await getTranslations("admissions.board");
  return { title: t("title") };
}

export default async function AdmissionsBoardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.board");
  const { filters, years } = await filtersFrom(ctx, sp);
  const opts = await filterOptions(ctx, years);
  if (!filters.yearId) {
    return (
      <PageBody>
        <PageHeader title={t("title")} />
        <EmptyState icon={<ClipboardList className="size-5" />} title={t("noYearTitle")} body={t("noYearBody")} action={<Button asChild variant="outline"><Link href="/admin/calendar">{t("noYearAction")}</Link></Button>} />
      </PageBody>
    );
  }
  const board = await loadBoard(ctx, filters);
  const authority = await authorityNames(ctx, board.settings);
  const count = (k: string) => board.columns.find((c) => c.stage.key === k)?.total ?? 0;
  const total = board.columns.reduce((s, c) => s + c.total, 0);
  const year = board.year;
  const manage = canManageAdmissions(ctx);
  const publicPath = `/apply/${ctx.org.slug}`;
  const ts = await getTranslations("admissions.stage");
  const label = (s: { key: string; labelEn: string | null; labelAr: string | null }) => pick(ctx.locale, s.labelEn, s.labelAr) || (ts.has(s.key) ? ts(s.key) : s.key);

  return (
    <PageBody className="max-w-[1600px]">
      <PageHeader
        title={t("title")}
        description={t("subtitle", { year: year ? pick(ctx.locale, year.nameEn, year.nameAr) : "" })}
        actions={
          <>
            {board.settings.publicOpen ? <CopyLink path={publicPath} label={t("copyLink")} /> : manage ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admissions/settings">
                  <Link2 className="size-4" />
                  {t("openOnline")}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/admissions/applications">{t("listView")}</Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statTotal")} value={total} hint={t("statDrafts", { n: board.drafts })} icon={<Inbox className="size-5" />} />
        <StatCard label={t("statNew")} value={count("NEW") + count("DOCUMENTS_PENDING")} hint={t("statNewHint")} icon={<FileClock className="size-5" />} tone="info" />
        <StatCard label={t("statOffers")} value={count("OFFER_MADE")} hint={t("statAccepted", { n: count("OFFER_ACCEPTED") + count("SEAT_PAID") })} icon={<UserPlus className="size-5" />} tone="gold" href="/admissions/applications?stage=OFFER_MADE" />
        <StatCard label={t("statWaitlist")} value={count("WAITLISTED")} hint={t("statEnrolled", { n: count("ENROLLED") })} icon={<Hourglass className="size-5" />} tone="warning" href="/admissions/waitlist" />
      </div>
      <AdmissionFilters year={filters.yearId} years={opts.years} grades={opts.grades} flags={opts.flags} />
      {total === 0 && !filters.q && !filters.flag && filters.grade === null ? (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title={t("emptyTitle")}
          body={board.settings.publicOpen ? t("emptyBodyOpen") : t("emptyBodyClosed")}
          action={manage && !board.settings.publicOpen ? <Button asChild><Link href="/admissions/settings">{t("openOnline")}</Link></Button> : undefined}
        />
      ) : (
        <AdmissionsBoard
          filters={filters}
          manage={manage}
          authorityShort={authority.short}
          stagesCfg={board.settings.stages}
          columns={board.columns.map((c) => ({ key: c.stage.key, label: label(c.stage), total: c.total, cards: c.cards }))}
        />
      )}
    </PageBody>
  );
}
