"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, MessageSquareWarning, Send, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deletePlanAction, reviewPlanAction, submitPlanAction } from "@/server/curriculum/actions";
import { useCurriculumError } from "./fields";

export function SubmitPlanButton({ planId, blockedReason }: { planId: string; blockedReason?: string | null }) {
  const t = useTranslations("curriculum.review");
  const err = useCurriculumError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const button = (
    <Button
      onClick={() =>
        start(async () => {
          const res = await submitPlanAction(planId);
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(t("submitted"));
          router.refresh();
        })
      }
      disabled={pending || Boolean(blockedReason)}
      data-testid="plan-submit"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      {t("submit")}
    </Button>
  );
  if (!blockedReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{blockedReason}</TooltipContent>
    </Tooltip>
  );
}

export function DeletePlanButton({ planId }: { planId: string }) {
  const t = useTranslations("curriculum");
  const err = useCurriculumError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="plan-delete">
        <Trash2 className="size-4" />
        {t("delete")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("plan.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("plan.deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deletePlanAction(planId);
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("plan.deleted"));
                  router.push("/curriculum/plans");
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Approve or request changes. A comment is required when asking for changes. */
export function ReviewPanel({ planId }: { planId: string }) {
  const t = useTranslations("curriculum.review");
  const err = useCurriculumError();
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const decide = (decision: "APPROVED" | "CHANGES_REQUESTED") =>
    start(async () => {
      if (decision === "CHANGES_REQUESTED" && !comment.trim()) return void toast.error(err("COMMENT_REQUIRED"));
      const res = await reviewPlanAction({ id: planId, decision, comment });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(decision === "APPROVED" ? t("approvedToast") : t("changesToast"));
      setComment("");
      router.refresh();
    });
  return (
    <div className="space-y-3 rounded-xl border border-info/30 bg-info-soft/40 p-4" data-testid="review-panel">
      <div>
        <h2 className="text-sm font-semibold">{t("panelTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("panelBody")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-comment">{t("comment")}</Label>
        <Textarea id="review-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("commentPlaceholder")} data-testid="review-comment" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => decide("APPROVED")} disabled={pending} data-testid="review-approve">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("approve")}
        </Button>
        <Button variant="outline" onClick={() => decide("CHANGES_REQUESTED")} disabled={pending} data-testid="review-changes">
          <MessageSquareWarning className="size-4" />
          {t("requestChanges")}
        </Button>
      </div>
    </div>
  );
}
