"use client";

// Attendance office actions on one unexplained absence: log a call or a note, message the family (with a recorded
// reason when automatic messages are held for this family), and explain the absence with a code.
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MessageSquare, Phone, Send } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { explainAbsenceAction, logContactAction, messageFamilyAction, runFollowUpNowAction } from "@/server/attendance/actions";

type Code = { code: string; label: string };

export function OfficeRowActions({ followUpId, studentName, held, canMessage, explainCodes, explained }: { followUpId: string; studentName: string; held: boolean; canMessage: boolean; explainCodes: Code[]; explained: boolean }) {
  const t = useTranslations("attendance.office");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<"call" | "message" | "explain" | null>(null);
  const [outcome, setOutcome] = useState<"REACHED" | "NO_ANSWER" | "VOICEMAIL">("REACHED");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const done = (ok: string) => {
    toast.success(ok);
    setOpen(null);
    setNote("");
    setMessage("");
    setReason("");
    setCode("");
    setError(null);
    router.refresh();
  };
  const err = (e: string) => setError(t.has(`error.${e}`) ? t(`error.${e}`) : t("error.generic"));

  const submitCall = () =>
    start(async () => {
      const res = await logContactAction({ followUpId, kind: "CALL", outcome, note: note.trim() || null });
      if (!res.ok) return err(res.error);
      done(t("callLogged"));
    });
  const submitMessage = () =>
    start(async () => {
      const res = await messageFamilyAction({ followUpId, message, reason: held ? reason : null });
      if (!res.ok) return err(res.error);
      done(t("messageSent"));
    });
  const submitExplain = () =>
    start(async () => {
      if (!code) return err("code");
      const res = await explainAbsenceAction({ followUpId, code });
      if (!res.ok) return err(res.error);
      done(t("explainedToast"));
    });

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" onClick={() => setOpen("call")} data-testid="log-call">
        <Phone className="size-3.5" />
        {t("logCall")}
      </Button>
      {canMessage && (
        <Button size="sm" variant="outline" onClick={() => setOpen("message")} data-testid="message-family">
          <MessageSquare className="size-3.5" />
          {t("messageFamily")}
        </Button>
      )}
      {!explained && (
        <Button size="sm" onClick={() => setOpen("explain")} data-testid="mark-explained">
          <CheckCircle2 className="size-3.5" />
          {t("markExplained")}
        </Button>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && (setOpen(null), setError(null))}>
        <DialogContent className="sm:max-w-md">
          {open === "call" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("logCallTitle", { name: studentName })}</DialogTitle>
                <DialogDescription>{t("logCallBody")}</DialogDescription>
              </DialogHeader>
              <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)} className="gap-2">
                {(["REACHED", "NO_ANSWER", "VOICEMAIL"] as const).map((o) => (
                  <Label key={o} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal">
                    <RadioGroupItem value={o} />
                    {t(`outcome.${o}`)}
                  </Label>
                ))}
              </RadioGroup>
              <div className="space-y-1.5">
                <Label htmlFor="call-note">{t("noteLabel")}</Label>
                <Textarea id="call-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t("notePlaceholder")} />
                <p className="text-xs text-muted-foreground">{t("notePrivacy")}</p>
              </div>
            </>
          )}
          {open === "message" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("messageTitle", { name: studentName })}</DialogTitle>
                <DialogDescription>{held ? t("messageHeldBody") : t("messageBody")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="msg">{t("messageLabel")}</Label>
                <Textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={4} placeholder={t("messagePlaceholder")} data-testid="message-text" />
              </div>
              {held && (
                <div className="space-y-1.5">
                  <Label htmlFor="reason">{t("reasonLabel")}</Label>
                  <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} placeholder={t("reasonPlaceholder")} data-testid="message-reason" />
                </div>
              )}
            </>
          )}
          {open === "explain" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("explainTitle", { name: studentName })}</DialogTitle>
                <DialogDescription>{t("explainBody")}</DialogDescription>
              </DialogHeader>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger className="w-full" aria-label={t("codeLabel")} data-testid="explain-code">
                  <SelectValue placeholder={t("codePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {explainCodes.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      <span className="font-semibold" dir="ltr">
                        {c.code}
                      </span>{" "}
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={open === "call" ? submitCall : open === "message" ? submitMessage : submitExplain}
              disabled={pending || (open === "message" && (message.trim().length < 5 || (held && !reason.trim()))) || (open === "explain" && !code)}
              data-testid="office-confirm"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : open === "message" ? <Send className="size-4" /> : null}
              {open === "call" ? t("saveCall") : open === "message" ? t("send") : t("confirmExplain")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RunFollowUpButton({ disabledReason }: { disabledReason: string | null }) {
  const t = useTranslations("attendance.office");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || !!disabledReason}
      title={disabledReason ?? undefined}
      data-testid="run-followup"
      onClick={() =>
        start(async () => {
          const res = await runFollowUpNowAction();
          if (!res.ok) return void toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
          if (res.skipped === "weekend" || res.skipped === "holiday") return void toast.info(t("noSchoolToday"));
          toast.success(t("followUpRan", { sent: res.notified, held: res.held }));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      {t("runNow")}
    </Button>
  );
}
