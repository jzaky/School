"use client";

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarCheck, Pencil } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FormRenderer, type RendererOptions } from "@/components/forms/form-renderer";
import { BookingPicker, type BookingChoice } from "@/components/booking/booking-picker";
import { fmtDateTime } from "@/lib/format";
import { saveDraftAction, submitServiceAction } from "@/server/requests/actions";
import { bookAppointmentAction } from "@/server/appointments/actions";
import type { FormSchema } from "@/server/forms/schema";
import type { BookingSetup } from "@/server/appointments/booking-setup";
import type { FormValues } from "@/server/forms/logic";

export function ServiceRequestClient({
  serviceId,
  formVersionId,
  schema,
  initialValues,
  initialStep,
  options,
  studentId,
  lockedFields,
  booking,
}: {
  serviceId: string;
  formVersionId: string | null;
  schema: FormSchema | null;
  initialValues: FormValues;
  initialStep: number;
  options: RendererOptions;
  studentId: string | null;
  lockedFields: string[];
  booking: BookingSetup | null;
}) {
  const t = useTranslations("services");
  const tb = useTranslations("booking");
  const locale = useLocale() as "en" | "ar";
  const router = useRouter();
  const [choice, setChoice] = useState<BookingChoice | null>(null);
  const [phase, setPhase] = useState<"book" | "form">(booking ? "book" : "form");

  const onDraft = useCallback(
    async (values: FormValues, step: number) => {
      if (!formVersionId) return;
      await saveDraftAction({ serviceId, formVersionId, data: values, step, studentId });
    },
    [serviceId, formVersionId, studentId],
  );

  const submit = async (values: FormValues) => {
    const sid = studentId ?? (typeof values.student === "string" ? values.student : null);
    let appointmentId: string | null = null;
    if (booking && choice) {
      const b = await bookAppointmentAction({ typeId: booking.type.id, hostId: choice.hostId, start: choice.start, studentId: sid });
      if (!b.ok) {
        toast.error(b.error === "SLOT_TAKEN" ? tb("slotTaken") : t("somethingWrong"));
        setChoice(null);
        setPhase("book");
        return { ok: false };
      }
      appointmentId = b.appointmentId;
    }
    const res = await submitServiceAction({ serviceId, studentId: sid, data: values, appointmentId });
    if (!res.ok) {
      if (!("fieldErrors" in res) || !res.fieldErrors?.length) toast.error(t("somethingWrong"));
      return { ok: false, fieldErrors: "fieldErrors" in res ? res.fieldErrors : undefined };
    }
    const danger = values.level === "IMMEDIATE_DANGER";
    router.push(`/requests/${res.requestId}?submitted=1${danger ? "&danger=1" : ""}`);
    return { ok: true };
  };

  if (phase === "book" && booking) {
    return (
      <div className="space-y-6">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("bookFirst")}</div>
          <h2 className="mt-1 text-lg font-semibold">{booking.type.name}</h2>
        </div>
        <BookingPicker setup={booking} value={choice} onChange={setChoice} />
        <div className="flex justify-end border-t pt-5">
          <Button onClick={() => setPhase("form")} disabled={!choice} data-testid="booking-continue">
            {t("thenDetails")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {booking && choice && (
        <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand-soft/50 p-3">
          <span className="grid size-9 place-items-center rounded-lg bg-brand text-brand-foreground">
            <CalendarCheck className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{fmtDateTime({ locale }, choice.start)}</div>
            <div className="text-muted-foreground">{choice.hostName}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setPhase("book")}>
            <Pencil className="size-3.5" />
            {tb("change")}
          </Button>
        </div>
      )}
      {schema ? (
        <FormRenderer
          schema={schema}
          initialValues={initialValues}
          initialStep={initialStep}
          options={options}
          lockedFields={lockedFields}
          onSubmit={submit}
          onDraft={onDraft}
          submitLabel={booking ? tb("confirmBooking") : undefined}
        />
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => submit({})} data-testid="form-submit">
            {booking ? tb("confirmBooking") : t("submitted")}
          </Button>
        </div>
      )}
    </div>
  );
}
