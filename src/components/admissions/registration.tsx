"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill, type Tone } from "@/components/app/badges";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { updateRegistrationAction } from "@/server/admissions/actions";
import { Field, selectClass } from "./ui";

const TONE: Record<string, Tone> = { NOT_SUBMITTED: "warning", SUBMITTED: "info", APPROVED: "success", REJECTED: "danger" };

/** "Awaiting SPEA approval", "Approved by SPEA" and so on, with the school's authority name. */
export function RegistrationBadge({ status, authority }: { status: string; authority: string }) {
  const t = useTranslations("admissions.registration");
  return (
    <Pill tone={TONE[status] ?? "neutral"} dot>
      {t(`badge.${status}`, { authority })}
    </Pill>
  );
}

const NEXT: Record<string, string[]> = { NOT_SUBMITTED: ["SUBMITTED"], SUBMITTED: ["APPROVED", "REJECTED", "NOT_SUBMITTED"], REJECTED: ["SUBMITTED"], APPROVED: ["APPROVED"] };

/** Record the authority's decision: submitted, approved (reference and date) or rejected (note). */
export function RegistrationUpdate({ id, status, reference, authority, studentName }: { id: string; status: string; reference: string | null; authority: string; studentName: string }) {
  const t = useTranslations("admissions.registration");
  const router = useRouter();
  const options = NEXT[status] ?? [];
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(options[0] ?? "SUBMITTED");
  const [ref, setRef] = useState(reference ?? "");
  const [date, setDate] = useState(new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  if (!options.length) return null;
  const save = () =>
    start(async () => {
      const r = await updateRegistrationAction({ registrationId: id, status: to, reference: ref.trim() || null, date: to === "NOT_SUBMITTED" ? null : date || null, note: note.trim() || null });
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8" data-testid="reg-update">
          {status === "APPROVED" ? t("correct") : t("update")}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="reg-dialog">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle", { name: studentName })}</DialogTitle>
          <DialogDescription>{t("dialogBody", { authority })}</DialogDescription>
        </DialogHeader>
        <Field id="reg-status" label={t("status.label")}>
          <select id="reg-status" className={selectClass} value={to} onChange={(e) => setTo(e.target.value)} data-testid="reg-status">
            {options.map((o) => (
              <option key={o} value={o}>
                {t(`status.${o}`)}
              </option>
            ))}
          </select>
        </Field>
        {to !== "NOT_SUBMITTED" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="reg-ref" label={t("reference", { authority })} optional={to !== "APPROVED"}>
              <Input id="reg-ref" dir="ltr" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} data-testid="reg-ref" />
            </Field>
            <Field id="reg-date" label={to === "SUBMITTED" ? t("submittedOn") : to === "APPROVED" ? t("approvedOn") : t("decidedOn")}>
              <Input id="reg-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} data-testid="reg-date" />
            </Field>
          </div>
        )}
        {(to === "REJECTED" || to === "SUBMITTED") && (
          <Field id="reg-note" label={t("note")} optional={to !== "REJECTED"}>
            <Textarea id="reg-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="reg-note" />
          </Field>
        )}
        <DialogFooter>
          <Button disabled={pending || (to === "APPROVED" && (!ref.trim() || !date)) || (to === "REJECTED" && !note.trim())} onClick={save} data-testid="reg-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
