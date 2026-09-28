"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Loader2, UserX, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookingPicker, type BookingChoice } from "@/components/booking/booking-picker";
import { bookAppointmentAction, cancelAppointmentAction, completeAppointmentAction } from "@/server/appointments/actions";
import type { BookingSetup } from "@/server/appointments/booking-setup";

export function MeetingActions({ appointmentId, setup, studentId, caseId, isHost, canChange, isPast }: { appointmentId: string; setup: BookingSetup | null; studentId: string | null; caseId: string | null; isHost: boolean; canChange: boolean; isPast: boolean }) {
  const t = useTranslations("meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "reschedule" | "cancel">("none");
  const [choice, setChoice] = useState<BookingChoice | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const reschedule = () =>
    start(async () => {
      if (!setup || !choice) return;
      const res = await bookAppointmentAction({ typeId: setup.type.id, hostId: choice.hostId, start: choice.start, studentId, caseId, rescheduleOf: appointmentId });
      if (res.ok) {
        toast.success(t("rescheduled"));
        setMode("none");
        router.push(`/meetings/${res.appointmentId}`);
      } else toast.error(res.error === "SLOT_TAKEN" ? t("slotTaken") : tc("somethingWrong"));
    });
  const cancel = () =>
    start(async () => {
      const res = await cancelAppointmentAction({ appointmentId, reason });
      if (res.ok) {
        toast.success(t("cancelledToast"));
        setMode("none");
        router.refresh();
      } else toast.error(tc("somethingWrong"));
    });
  const complete = (status: "COMPLETED" | "NO_SHOW") =>
    start(async () => {
      await completeAppointmentAction({ appointmentId, status });
      router.refresh();
    });

  return (
    <div className="flex flex-wrap gap-2">
      {canChange && !isPast && setup && (
        <Button variant="outline" onClick={() => setMode("reschedule")} data-testid="reschedule">
          <CalendarClock className="size-4" />
          {t("reschedule")}
        </Button>
      )}
      {canChange && !isPast && (
        <Button variant="outline" className="text-danger hover:text-danger" onClick={() => setMode("cancel")} data-testid="cancel-meeting">
          <XCircle className="size-4" />
          {t("cancel")}
        </Button>
      )}
      {isHost && isPast && canChange && (
        <>
          <Button onClick={() => complete("COMPLETED")} disabled={pending}>
            <CheckCircle2 className="size-4" />
            {t("markHeld")}
          </Button>
          <Button variant="outline" onClick={() => complete("NO_SHOW")} disabled={pending}>
            <UserX className="size-4" />
            {t("markNoShow")}
          </Button>
        </>
      )}
      <Dialog open={mode === "reschedule"} onOpenChange={(o) => setMode(o ? "reschedule" : "none")}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("reschedule")}</DialogTitle>
            <DialogDescription>{t("rescheduleHint")}</DialogDescription>
          </DialogHeader>
          {setup && <BookingPicker setup={setup} value={choice} onChange={setChoice} rescheduleOf={appointmentId} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode("none")}>
              {tc("cancel")}
            </Button>
            <Button onClick={reschedule} disabled={!choice || pending} data-testid="confirm-reschedule">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("confirmNewTime")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={mode === "cancel"} onOpenChange={(o) => setMode(o ? "cancel" : "none")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
            <DialogDescription>{t("cancelHint")}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cancelReason")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode("none")}>
              {tc("back")}
            </Button>
            <Button variant="destructive" onClick={cancel} disabled={pending} data-testid="confirm-cancel">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
