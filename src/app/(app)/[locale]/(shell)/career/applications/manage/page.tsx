import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarClock, GraduationCap, Send, Trophy } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber } from "@/lib/format";
import { userName } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { PathwayFilters } from "@/components/pathways/pathway-client";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { Board, GenerateTasksButton, type BoardCard } from "@/components/applications/app-client";
import { viewerOf } from "@/server/applications/access";
import { loadCards, PRE_SUBMISSION_STAGES } from "@/server/applications/page-data";
import { APP_ROUTES, CLOSED_STAGES, intakeYearFor, type Stage } from "@/server/applications/types";

export async function generateMetadata() {
  const t = await getTranslations("applications");
  return { title: t("manageTitle") };
}

type SP = { grade?: string; counselor?: string; country?: string; route?: string; due?: string; missing?: string };
const DUE_OPTIONS = [7, 14, 30, 60, 90];

export default async function ApplicationBoardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (viewerOf(ctx) !== "manager") notFound();
  const t = await getTranslations("applications");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const now = new Date();
  // The board is about the coming intake (Grade 12 this year); older intakes stay reachable through each student.
  const intake = intakeYearFor(12, now);
  const all = await loadCards(ctx, prefs, { intakeYear: { gte: intake } }, now);

  const grade = Number(sp.grade) || null;
  const due = Number(sp.due) || null;
  const cards = all.filter((c) => {
    if (grade && c.grade !== grade) return false;
    if (sp.counselor && (sp.counselor === "none" ? c.counselorId : c.counselorId !== sp.counselor)) return false;
    if (sp.country && c.countryCode !== sp.country) return false;
    if (sp.route && c.route !== sp.route) return false;
    if (due && !(c.next && c.next.days !== null && c.next.days >= 0 && c.next.days <= due)) return false;
    if (sp.missing === "yes" && c.dueSoon === 0) return false;
    return true;
  });

  const counselorIds = [...new Set(all.map((c) => c.counselorId).filter(Boolean))] as string[];
  const counselors = counselorIds.length ? await db.membership.findMany({ where: { orgId, id: { in: counselorIds } }, include: { user: true } }) : [];
  const filters = [
    { param: "grade", label: t("filter.grade"), all: t("filter.allGrades"), options: [...new Set(all.map((c) => c.grade))].sort((a, b) => b - a).map((g) => ({ value: String(g), label: t("filter.gradeN", { n: g }) })) },
    { param: "counselor", label: t("filter.counselor"), all: t("filter.allCounselors"), options: [...counselors.map((m) => ({ value: m.id, label: userName(m.user, locale) })), { value: "none", label: t("unassigned") }] },
    { param: "country", label: t("filter.country"), all: t("filter.allCountries"), options: [...new Set(all.map((c) => c.countryCode))].map((c) => ({ value: c, label: countryLabel(c, locale) })).sort((a, b) => a.label.localeCompare(b.label)) },
    { param: "route", label: t("filter.route"), all: t("filter.allRoutes"), options: APP_ROUTES.filter((r) => all.some((c) => c.route === r)).map((r) => ({ value: r, label: t(`route.${r}`) })) },
    { param: "due", label: t("filter.due"), all: t("filter.anyDue"), options: DUE_OPTIONS.map((n) => ({ value: String(n), label: t("filter.dueN", { n }) })) },
    { param: "missing", label: t("filter.missing"), all: t("filter.anyMissing"), options: [{ value: "yes", label: t("filter.missingYes") }] },
  ];
  const boardCards: BoardCard[] = cards.map((c) => ({
    id: c.id,
    stage: c.stage as Stage,
    student: c.studentName,
    grade: c.grade,
    university: c.university,
    program: c.program,
    route: c.route,
    counselor: c.counselorName,
    deadline: c.next ? { date: c.next.date, bucket: c.next.bucket, days: c.next.days } : null,
    done: c.done,
    total: c.total,
    dueSoon: c.dueSoon,
  }));
  const openIds = cards.filter((c) => !CLOSED_STAGES.includes(c.stage as Stage)).map((c) => c.id);
  const n = (x: number) => fmtNumber(prefs, x);

  return (
    <PageBody className="max-w-[1600px]">
      <PageHeader
        title={t("manageTitle")}
        description={t("manageSubtitle")}
        actions={openIds.length > 0 && <GenerateTasksButton applicationIds={openIds} label={t("generateAll", { n: openIds.length })} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("stats.total")} value={n(cards.length)} icon={<Send className="size-4" />} />
        <StatCard label={t("stats.students")} value={n(new Set(cards.map((c) => c.studentId)).size)} icon={<GraduationCap className="size-4" />} />
        <StatCard label={t("stats.dueSoon")} value={n(cards.filter((c) => PRE_SUBMISSION_STAGES.includes(c.stage) && c.next && c.next.days !== null && c.next.days <= 30).length)} icon={<CalendarClock className="size-4" />} />
        <StatCard label={t("stats.offers")} value={n(cards.filter((c) => ["OFFER", "ACCEPTED", "ENROLLED"].includes(c.stage)).length)} icon={<Trophy className="size-4" />} />
      </div>
      <PathwayFilters filters={filters} />
      {cards.length === 0 ? <EmptyState icon={<Send className="size-5" />} title={t("boardEmptyTitle")} body={t("boardEmptyBody")} /> : <Board cards={boardCards} />}
    </PageBody>
  );
}
