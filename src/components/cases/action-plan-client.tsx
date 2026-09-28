"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { approvePlanAction, discardPlanAction, draftActionPlanAction, updatePlanItemAction } from "@/server/ai/features";

export function DraftPlanButton({ caseId }: { caseId: string }) {
  const t = useTranslations("plan");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="border-violet-200 text-violet-700 hover:bg-violet-50"
      disabled={pending}
      data-testid="draft-plan"
      onClick={() =>
        start(async () => {
          const res = await draftActionPlanAction(caseId);
          if (res.status === "ok") router.refresh();
          else toast.error(res.status === "blocked" ? t("blocked") : t("failed"));
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {t("draftWithAi")}
    </Button>
  );
}

export function PlanItemEditor({ itemId, text }: { itemId: string; text: string }) {
  const router = useRouter();
  const [value, setValue] = useState(text);
  const [, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <Input value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== text && start(async () => { await updatePlanItemAction({ itemId, text: value }); router.refresh(); })} className="h-8" />
      <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => start(async () => { await updatePlanItemAction({ itemId, remove: true }); router.refresh(); })}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

export function PlanDraftControls({ planId, canNotifyParents }: { planId: string; canNotifyParents: boolean }) {
  const t = useTranslations("plan");
  const router = useRouter();
  const [notify, setNotify] = useState(canNotifyParents);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-center">
      <p className="text-xs text-muted-foreground">{t("reviewHint")}</p>
      {canNotifyParents ? (
        <label className="flex items-center gap-2 text-sm sm:ms-auto">
          <Checkbox checked={notify} onCheckedChange={(c) => setNotify(c === true)} data-testid="plan-notify-parents" />
          {t("notifyParents")}
        </label>
      ) : (
        <span className="text-xs text-violet-700 sm:ms-auto">{t("noAutoParents")}</span>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await discardPlanAction(planId); router.refresh(); })}>
          {t("discard")}
        </Button>
        <Button
          size="sm"
          disabled={pending}
          data-testid="approve-plan"
          onClick={() =>
            start(async () => {
              const res = await approvePlanAction({ planId, notifyParents: notify });
              if (res.ok) {
                toast.success(t("approvedToast"));
                router.refresh();
              }
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("approve")}
        </Button>
      </div>
    </div>
  );
}
