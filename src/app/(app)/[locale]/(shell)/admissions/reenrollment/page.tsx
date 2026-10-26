import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, Repeat } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { BarList } from "@/components/charts/bar-list";
import { FilterBar } from "@/components/app/filter-bar";
import { Button } from "@/components/ui/button";
import { canManageAdmissions, canViewAdmissions } from "@/server/admissions/access";
import { leavingReasons, windowState, windowStudents, windowSummary, type ResponseFilter } from "@/server/admissions/reenrollment";
import { admissionYears, asTx } from "@/server/admissions/settings";
import { OpenWindowForm, RecordAnswer, WindowActions } from "@/components/admissions/reenrollment";
import { Pager } from "@/components/admissions/filters";

const PER_PAGE = 50;

export async function generateMetadata() {
  const t = await getTranslations("admissions.reenroll");
  return { title: t("title") };
}

export default async function ReenrollmentAdminPage({ searchParams }: { searchParams: Promise<{ window?: string; tab?: string; grade?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.reenroll");
  const tg = await getTranslations("gradeLevel");
  const tr = await getTranslations("admissions.leavingReason");
  const tx = asTx(ctx.db);
  const manage = canManageAdmissions(ctx);
  const now = new Date();
  const [windows, years] = await Promise.all([ctx.db.reenrollmentWindow.findMany({ where: { orgId: ctx.orgId }, orderBy: { opensAt: "desc" }, take: 20 }), admissionYears(tx, ctx.orgId)]);
  const future = years.filter((y) => !y.isCurrent);
  const yearName = (id: string) => {
    const y = years.find((x) => x.id === id);
    return y ? pick(ctx.locale, y.nameEn, y.nameAr) : "";
  };
  const fmt = (d: Date) => new Intl.DateTimeFormat(ctx.locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(d);
  const w = windows.find((x) => x.id === sp.window) ?? windows[0];
  const openForm = manage && future.length > 0 && !windows.some((x) => windowState(x, now) !== "closed") ? <OpenWindowForm years={future.map((y) => ({ value: y.id, label: pick(ctx.locale, y.nameEn, y.nameAr) }))} /> : null;

  if (!w) {
    return (
      <PageBody className="max-w-5xl">
        <PageHeader title={t("title")} description={t("subtitle")} />
        <EmptyState icon={<Repeat className="size-5" />} title={t("emptyTitle")} body={future.length ? t("emptyBody") : t("noNextYear")} action={!future.length && manage ? <Button asChild variant="outline"><Link href="/admin/calendar">{t("addYear")}</Link></Button> : undefined} />
        {openForm}
      </PageBody>
    );
  }

  const tab = (["pending", "returning", "leaving", "all"] as const).includes(sp.tab as ResponseFilter) ? (sp.tab as ResponseFilter) : "pending";
  const page = Math.max(1, Number(sp.page) || 1);
  const grade = sp.grade !== undefined && sp.grade !== "" && Number.isInteger(Number(sp.grade)) ? Number(sp.grade) : null;
  const [summary, reasons, students] = await Promise.all([
    windowSummary(tx, ctx.orgId, w.id),
    leavingReasons(tx, ctx.orgId, w.id),
    windowStudents(tx, ctx.orgId, w.id, tab, { grade, q: sp.q?.trim().slice(0, 60) || null, page, perPage: PER_PAGE }),
  ]);
  const tot = summary.reduce((a, r) => ({ eligible: a.eligible + r.eligible, returning: a.returning + r.returning, leaving: a.leaving + r.leaving, pending: a.pending + r.pending }), { eligible: 0, returning: 0, leaving: 0, pending: 0 });
  const state = windowState(w, now);
  const responded = tot.eligible ? Math.round(((tot.returning + tot.leaving) / tot.eligible) * 100) : 0;

  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("windowLine", { year: yearName(w.academicYearId), opens: fmt(w.opensAt), closes: fmt(w.closesAt) })}
        actions={
          <>
            <Pill tone={state === "open" ? "success" : state === "scheduled" ? "info" : "neutral"} dot>
              {t(`state.${state}`)}
            </Pill>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/admissions/export?kind=reenrollment&window=${w.id}&format=xlsx`}>
                <Download className="size-4" />
                {t("export")}
              </a>
            </Button>
          </>
        }
      />
      {windows.length > 1 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {windows.map((x) => (
            <Link key={x.id} href={`/admissions/reenrollment?window=${x.id}`} className={`rounded-full border px-3 py-1 ${x.id === w.id ? "border-brand bg-brand text-brand-foreground" : "bg-card"}`}>
              {yearName(x.academicYearId)} · {fmt(x.opensAt)}
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statResponded")} value={`${responded}%`} hint={t("statOf", { n: tot.returning + tot.leaving, total: tot.eligible })} tone="brand" />
        <StatCard label={t("statReturning")} value={tot.returning} tone="success" href="/admissions/reenrollment?tab=returning" />
        <StatCard label={t("statLeaving")} value={tot.leaving} tone="danger" href="/admissions/reenrollment?tab=leaving" />
        <StatCard label={t("statPending")} value={tot.pending} tone="warning" href="/admissions/reenrollment?tab=pending" />
      </div>
      {manage && state !== "closed" && <WindowActions windowId={w.id} state={state} closes={new Date(w.closesAt.getTime() + 4 * 3600_000).toISOString().slice(0, 10)} pending={tot.pending} />}
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("byGrade")} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm" data-testid="reenroll-summary">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-start font-medium">{t("grade")}</th>
                  <th className="py-1.5 text-end font-medium">{t("eligible")}</th>
                  <th className="py-1.5 text-end font-medium">{t("returning")}</th>
                  <th className="py-1.5 text-end font-medium">{t("leaving")}</th>
                  <th className="py-1.5 text-end font-medium">{t("pending")}</th>
                  <th className="w-1/3 py-1.5 ps-3 text-start font-medium">{t("progress")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.map((r) => (
                  <tr key={r.grade}>
                    <td className="py-1.5 font-medium">{tg("label", gradeLevelValues(r.grade))}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.eligible}</td>
                    <td className="py-1.5 text-end tabular-nums text-success">{r.returning}</td>
                    <td className="py-1.5 text-end tabular-nums text-danger">{r.leaving}</td>
                    <td className="py-1.5 text-end tabular-nums">{r.pending}</td>
                    <td className="py-1.5 ps-3">
                      <div className="flex h-2 overflow-hidden rounded-full bg-muted" title={`${r.returning} / ${r.leaving} / ${r.pending}`}>
                        <div className="bg-success" style={{ width: `${(r.returning / Math.max(1, r.eligible)) * 100}%` }} />
                        <div className="bg-danger" style={{ width: `${(r.leaving / Math.max(1, r.eligible)) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("reasons")} description={t("reasonsHint")} />
          <BarList rows={reasons.map((r) => ({ label: tr(r.reason), value: r.n }))} empty={t("noLeavers")} />
        </Panel>
      </div>
      <Panel>
        <PanelHeader title={t("students")} />
        <FilterBar
          tabs={[
            { value: "pending", label: t("pending"), count: tot.pending },
            { value: "returning", label: t("returning"), count: tot.returning },
            { value: "leaving", label: t("leaving"), count: tot.leaving },
            { value: "all", label: t("all"), count: tot.eligible },
          ]}
          chipParam="grade"
          chips={[{ value: "", label: t("allGrades") }, ...summary.map((r) => ({ value: String(r.grade), label: tg("label", gradeLevelValues(r.grade)) }))]}
          searchPlaceholder={t("search")}
        />
        <ul className="mt-3 divide-y" data-testid="reenroll-students">
          {students.rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <Link href={`/students/${s.id}`} className="block truncate text-sm font-medium hover:text-brand">
                  {pick(ctx.locale, `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`)}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {tg("label", gradeLevelValues(s.gradeLevel))}
                  {s.section ?? ""} · {s.studentNo}
                  {s.response?.reasonKey ? ` · ${tr(s.response.reasonKey)}` : ""}
                </span>
              </span>
              {s.response ? <Pill tone={s.response.intent === "RETURNING" ? "success" : "danger"}>{t(s.response.intent === "RETURNING" ? "answerReturning" : "answerLeaving")}</Pill> : <Pill tone="warning">{t("noAnswer")}</Pill>}
              {manage && state !== "closed" && <RecordAnswer windowId={w.id} studentId={s.id} current={s.response?.intent ?? null} />}
            </li>
          ))}
          {students.rows.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{t("noStudents")}</li>}
        </ul>
        <Pager page={page} total={students.total} perPage={PER_PAGE} />
      </Panel>
      {openForm}
    </PageBody>
  );
}
