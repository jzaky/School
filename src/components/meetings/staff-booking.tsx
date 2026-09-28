"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BookingPicker, type BookingChoice } from "@/components/booking/booking-picker";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import { bookAppointmentAction } from "@/server/appointments/actions";
import type { BookingSetup } from "@/server/appointments/booking-setup";

export function StaffBooking({ setup, studentId, students, caseId, guardians, defaultInvite, sensitive }: { setup: BookingSetup; studentId: string | null; students: PickerOption[]; caseId: string | null; guardians: Array<{ id: string; name: string }>; defaultInvite: boolean; sensitive: boolean }) {
  const t = useTranslations("meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [choice, setChoice] = useState<BookingChoice | null>(null);
  const [invite, setInvite] = useState<string | null>(defaultInvite ? (guardians[0]?.id ?? null) : null);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const book = () =>
    start(async () => {
      if (!choice) return;
      const res = await bookAppointmentAction({ typeId: setup.type.id, hostId: choice.hostId, start: choice.start, studentId, caseId, notes, inviteGuardianId: invite });
      if (res.ok) {
        toast.success(t("booked"));
        router.push(`/meetings/${res.appointmentId}`);
      } else toast.error(res.error === "SLOT_TAKEN" ? t("slotTaken") : tc("somethingWrong"));
    });
  return (
    <div className="space-y-6">
      {students.length > 0 && (
        <div className="max-w-sm space-y-1.5">
          <Label>{tc("student")}</Label>
          <PickerCombobox
            options={students}
            value={studentId ?? ""}
            placeholder={t("chooseStudent")}
            onChange={(v) => {
              const next = new URLSearchParams(sp.toString());
              next.set("student", v);
              router.replace(`${pathname}?${next.toString()}`);
            }}
            testId="book-student"
          />
        </div>
      )}
      <BookingPicker setup={setup} value={choice} onChange={setChoice} />
      {studentId && guardians.length > 0 && (
        <div className="space-y-2 rounded-lg border p-4">
          <div className="text-sm font-medium">{t("inviteFamily")}</div>
          {sensitive && (
            <p className="flex items-center gap-1.5 text-xs text-violet-700">
              <Lock className="size-3.5" />
              {t("sensitiveInvite")}
            </p>
          )}
          {guardians.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={invite === g.id} onCheckedChange={(c) => setInvite(c ? g.id : null)} data-testid="invite-guardian" />
              {g.name}
            </label>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{t("notes")}</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      <div className="flex justify-end border-t pt-5">
        <Button onClick={book} disabled={!choice || pending} data-testid="confirm-booking">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("confirmBooking")}
        </Button>
      </div>
    </div>
  );
}
