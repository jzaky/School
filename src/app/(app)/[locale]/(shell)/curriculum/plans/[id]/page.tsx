import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, CalendarDays, Clock, FileDown, GraduationCap, History, MessageSquareWarning, Pencil, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { AiDraftedBadge, PlanStatusBadge } from "@/components/curriculum/badges";
import { SessionPlan } from "@/components/curriculum/session-plan";
import { DeletePlanButton, ReviewPanel, SubmitPlanButton } from "@/components/curriculum/plan-actions";
import { canEditPlan, canSeePlan, inScope, reviewScope } from "@/server/curriculum/access";
import { pickBi, readActivities, readBilingualText, readMaterials } from "@/server/curriculum/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const plan = await ctx.db.lessonPlan.findUnique({ where: { id } });
  const t = await getTranslations("curriculum");
  return { title: plan && canSeePlan(ctx, plan) ? pick(ctx.locale, plan.titleEn, plan.titleAr) : t("plans.title") };
}

const ACTION_KEYS: Record<string, string> = {
  "lesson_plan.create": "created",
  "lesson_plan.update": "updated",
  "lesson_plan.submit": "submitted",
  "lesson_plan.approve": "approved",
  "lesson_plan.request_changes": "changesRequested",
};

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("curriculum");
  const { db, locale } = ctx;
  const plan = await db.lessonPlan.findUnique({ where: { id }, include: { standards: { include: { standard: { include: { framework: true } } } } } });
  if (!plan || !canSeePlan(ctx, plan)) notFound();
  const prefs = await formatPrefs(ctx);
  const [subject, cls, term, events, scope] = await Promise.all([
    db.subject.findUnique({ where: { id: plan.subjectId } }),
    plan.classId ? db.schoolClass.findUnique({ where: { id: plan.classId } }) : Promise.resolve(null),
    plan.termId ? db.term.findUnique({ where: { id: plan.termId } }) : Promise.resolve(null),
    db.auditEvent.findMany({ where: { entityType: "LessonPlan", entityId: plan.id }, orderBy: { createdAt: "asc" } }),
    reviewScope(ctx),
  ]);
  const people = await db.membership.findMany({ where: { id: { in: [plan.authorId, plan.reviewerId, ...events.map((e) => e.actorId)].filter(Boolean) as string[] } }, include: { user: true } });
  const who = (mid: string | null) => userName(people.find((p) => p.id === mid)?.user, locale);
  const activities = readActivities(plan.activities);
  const materials = readMaterials(plan.materials);
  const diff = readBilingualText(plan.differentiation);
  const objectives = pickBi(locale, plan.objectivesEn, plan.objectivesAr);
  const mine = plan.authorId === ctx.membershipId;
  const editable = canEditPlan(ctx, plan);
  const canReview = plan.status === "SUBMITTED" && !mine && ctx.can("curriculum.review") && inScope(scope, plan.subjectId);
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <PageBody className="max-w-5xl">
      <Link href="/curriculum/plans" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Back className="size-4" />
        {t("plans.title")}
      </Link>
      <PageHeader
        eyebrow={`${subject ? pick(locale, subject.nameEn, subject.nameAr) : ""} · ${t("gradeN", { grade: plan.gradeLevel })}`}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {pick(locale, plan.titleEn, plan.titleAr)}
            <PlanStatusBadge status={plan.status} />
            {plan.aiDrafted && <AiDraftedBadge />}
          </span>
        }
        description={t("plan.byline", { name: who(plan.authorId), date: fmtDate(prefs, plan.updatedAt) })}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/curriculum/plans/${plan.id}/pdf?locale=${locale}`} target="_blank" rel="noreferrer" data-testid="plan-pdf">
                <FileDown className="size-4" />
                {t("plan.pdf")}
              </a>
            </Button>
            {editable && (
              <>
                <DeletePlanButton planId={plan.id} />
                <Button variant="outline" asChild>
                  <Link href={`/curriculum/plans/${plan.id}/edit`} data-testid="plan-edit">
                    <Pencil className="size-4" />
                    {t("edit")}
                  </Link>
                </Button>
                <SubmitPlanButton planId={plan.id} blockedReason={plan.standards.length === 0 ? t("review.needStandards") : null} />
              </>
            )}
          </>
        }
      />

      {plan.aiDrafted && plan.status === "DRAFT" && mine && <p className="rounded-lg bg-violet-50 px-4 py-2.5 text-sm text-violet-800">{t("plan.aiNotice")}</p>}
      {plan.reviewComment && plan.reviewedAt && (plan.status === "CHANGES_REQUESTED" || plan.status === "APPROVED") && (
        <div className={plan.status === "APPROVED" ? "rounded-xl border border-success/25 bg-success-soft/50 p-4" : "rounded-xl border border-warning/30 bg-warning-soft/60 p-4"} data-testid="review-comment-box">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareWarning className="size-4" />
            {plan.status === "APPROVED" ? t("review.approvedBy", { name: who(plan.reviewerId) }) : t("review.changesBy", { name: who(plan.reviewerId) })}
            <span className="text-xs font-normal text-muted-foreground">{fmtDateTime(prefs, plan.reviewedAt)}</span>
          </div>
          <p className="mt-1 text-sm">{plan.reviewComment}</p>
        </div>
      )}
      {canReview && <ReviewPanel planId={plan.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Meta icon={<Users className="size-4" />} label={t("plan.class")} value={cls ? pick(locale, cls.nameEn, cls.nameAr) : t("plan.noClass")} />
        <Meta icon={<CalendarDays className="size-4" />} label={t("plan.when")} value={[term ? pick(locale, term.nameEn, term.nameAr) : null, plan.weekNo ? t("plan.weekN", { week: plan.weekNo }) : null].filter(Boolean).join(" · ") || t("plan.notScheduled")} />
        <Meta icon={<CalendarDays className="size-4" />} label={t("plan.date")} value={plan.plannedFor ? fmtDate(prefs, plan.plannedFor) : t("plan.notScheduled")} />
        <Meta icon={<Clock className="size-4" />} label={t("plan.duration")} value={t("plan.minutesN", { count: plan.durationMin })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t("plan.objectives")} />
            {objectives ? (
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {objectives.split("\n").filter((l) => l.trim()).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("plan.none")}</p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title={t("plan.session")} description={t("plan.sessionBody")} />
            <SessionPlan activities={activities} durationMin={plan.durationMin} locale={locale} />
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t("plan.standards")} icon={<GraduationCap className="size-4" />} />
            {plan.standards.length ? (
              <ul className="space-y-2">
                {plan.standards.map(({ standard: s }) => (
                  <li key={s.id} className="text-sm">
                    <Link href={`/curriculum?fw=${s.frameworkId}`} className="me-1.5 font-mono text-xs text-brand hover:underline" dir="ltr">
                      {s.code}
                    </Link>
                    {pick(locale, s.descEn, s.descAr)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("plan.noStandards")}</p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title={t("plan.materials")} />
            {materials.length ? (
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {materials.map((m, i) => (
                  <li key={i}>{pickBi(locale, m.en, m.ar)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("plan.none")}</p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title={t("plan.assessment")} />
            <p className="whitespace-pre-line text-sm">{pickBi(locale, plan.assessmentEn, plan.assessmentAr) || <span className="text-muted-foreground">{t("plan.none")}</span>}</p>
            <h3 className="mt-4 mb-1 text-sm font-semibold">{t("plan.differentiation")}</h3>
            <p className="whitespace-pre-line text-sm">{pickBi(locale, diff.en, diff.ar) || <span className="text-muted-foreground">{t("plan.none")}</span>}</p>
          </Panel>
          <Panel>
            <PanelHeader title={t("plan.history")} icon={<History className="size-4" />} />
            <ol className="space-y-2.5" data-testid="plan-history">
              {events.map((e) => (
                <li key={e.id} className="text-sm">
                  <div>{t(`history.${ACTION_KEYS[e.action] ?? "updated"}`, { name: who(e.actorId) })}</div>
                  <div className="text-xs text-muted-foreground">{fmtDateTime(prefs, e.createdAt)}</div>
                  {e.reason && <div className="mt-0.5 text-xs italic text-muted-foreground">{e.reason}</div>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}
