import { getTranslations } from "next-intl/server";
import { ListChecks } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { PlanDraftControls, PlanItemEditor, DraftPlanButton } from "./action-plan-client";

export async function ActionPlanPanel({ caseId, studentId, canManage }: { caseId: string; studentId: string; canManage: boolean }) {
  const ctx = await getCtx();
  const t = await getTranslations("plan");
  const prefs = await formatPrefs(ctx);
  const plans = await ctx.db.actionPlan.findMany({ where: { caseId, status: { in: ["DRAFT", "ACCEPTED"] } }, include: { items: { orderBy: { order: "asc" } } }, orderBy: { createdAt: "desc" }, take: 2 });
  const approvers = await ctx.db.membership.findMany({ where: { id: { in: plans.map((p) => p.approvedById).filter(Boolean) as string[] } }, include: { user: true } });
  const taskIds = plans.flatMap((p) => p.items.map((i) => i.taskId).filter(Boolean)) as string[];
  const tasks = taskIds.length ? await ctx.db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true } }) : [];
  const sensitive = (await ctx.db.case.findUnique({ where: { id: caseId }, select: { sensitivity: true } }))?.sensitivity;
  const canNotifyParents = sensitive !== "WELLBEING" && sensitive !== "SAFEGUARDING";
  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        icon={<ListChecks className="size-4" />}
        action={canManage && !plans.some((p) => p.status === "DRAFT") ? <DraftPlanButton caseId={caseId} /> : undefined}
      />
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="space-y-5">
          {plans.map((p) => {
            const approver = approvers.find((a) => a.id === p.approvedById);
            return (
              <div key={p.id} className="space-y-3" data-testid={`plan-${p.status.toLowerCase()}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" data-testid="plan-title">{pick(ctx.locale, p.titleEn, p.titleAr)}</span>
                  {p.status === "DRAFT" ? <Pill tone="warning">{p.fromAi ? t("aiDraft") : t("draft")}</Pill> : <Pill tone="success">{t("approved")}</Pill>}
                  {approver && p.approvedAt && (
                    <span className="text-xs text-muted-foreground">
                      {t("approvedBy", { name: userName(approver.user, ctx.locale), date: fmtDate(prefs, p.approvedAt) })}
                    </span>
                  )}
                </div>
                <ul className="space-y-2">
                  {p.items.map((it) => {
                    const task = tasks.find((x) => x.id === it.taskId);
                    return (
                      <li key={it.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm" data-testid="plan-item" data-owner={it.ownerRole}>
                        <Pill tone={it.ownerRole === "student" ? "brand" : it.ownerRole === "parent" ? "violet" : "neutral"} className="mt-0.5 shrink-0">
                          {t(`owner.${it.ownerRole}`)}
                        </Pill>
                        <div className="min-w-0 flex-1">
                          {p.status === "DRAFT" && canManage ? <PlanItemEditor itemId={it.id} text={pick(ctx.locale, it.textEn, it.textAr)} /> : <span className={task?.status === "DONE" ? "text-muted-foreground line-through" : ""} data-testid="plan-item-text">{pick(ctx.locale, it.textEn, it.textAr)}</span>}
                          {it.dueAt && <div className="mt-0.5 text-xs text-muted-foreground">{t("due", { date: fmtDate(prefs, it.dueAt) })}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {p.status === "DRAFT" && canManage && <PlanDraftControls planId={p.id} canNotifyParents={canNotifyParents} />}
              </div>
            );
          })}
        </div>
      )}
      <span className="sr-only">{studentId}</span>
    </Panel>
  );
}
