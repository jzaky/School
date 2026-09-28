"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, PenLine, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { decideApprovalAction } from "@/server/requests/actions";

export function ApprovalPanel({ assigneeRowId, label, requireSignature, signerName, compact }: { assigneeRowId: string; label: string; requireSignature: boolean; signerName: string; compact?: boolean }) {
  const t = useTranslations("approvals");
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState("");
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"APPROVED" | "REJECTED" | null>(null);

  const decide = (decision: "APPROVED" | "REJECTED") => {
    if (decision === "REJECTED" && !comment.trim()) {
      toast.error(t("reasonNeeded"));
      return;
    }
    if (decision === "APPROVED" && requireSignature && !signature.trim()) {
      toast.error(t("signatureNeeded"));
      return;
    }
    setWhich(decision);
    start(async () => {
      const res = await decideApprovalAction({ assigneeRowId, decision, comment, signatureName: requireSignature ? signature : undefined });
      if (res.ok) {
        toast.success(decision === "APPROVED" ? t("approvedToast") : t("rejectedToast"));
        router.refresh();
      } else {
        toast.error(res.error === "ALREADY_DECIDED" ? t("alreadyDecided") : t("failed"));
      }
      setWhich(null);
    });
  };

  return (
    <div className="space-y-3" data-testid="approval-panel">
      {!compact && <div className="text-sm font-semibold">{t("yourDecision", { step: label })}</div>}
      <div className="space-y-1.5">
        <Label htmlFor={`c-${assigneeRowId}`} className="text-xs text-muted-foreground">
          {t("comment")}
        </Label>
        <Textarea id={`c-${assigneeRowId}`} value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder={t("commentPlaceholder")} data-testid="approval-comment" />
      </div>
      {requireSignature && (
        <div className="space-y-1.5 rounded-lg border border-brand/20 bg-brand-soft/40 p-3">
          <Label htmlFor={`s-${assigneeRowId}`} className="flex items-center gap-1.5 text-xs">
            <PenLine className="size-3.5" />
            {t("signLabel")}
          </Label>
          <Input id={`s-${assigneeRowId}`} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={signerName} className="bg-card font-[cursive] text-lg" data-testid="approval-signature" />
          <p className="text-[11px] text-muted-foreground">{t("signHint")}</p>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={() => decide("APPROVED")} disabled={pending} className="flex-1 bg-success text-white hover:bg-success/90" data-testid="approve">
          {pending && which === "APPROVED" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("approve")}
        </Button>
        <Button onClick={() => decide("REJECTED")} disabled={pending} variant="outline" className="flex-1 text-danger hover:text-danger" data-testid="reject">
          {pending && which === "REJECTED" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          {t("reject")}
        </Button>
      </div>
    </div>
  );
}
