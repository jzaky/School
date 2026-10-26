"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileCheck2, Loader2, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cancelWithdrawalAction, completeWithdrawalAction, planWithdrawalAction, searchStudentsAction } from "@/server/admissions/actions";
import { LEAVING_REASONS } from "@/server/admissions/config";
import { Field, selectClass } from "./ui";

/** Record a student who is leaving: date, reason and where they go. */
export function PlanWithdrawal() {
  const t = useTranslations("admissions.leavers");
  const tr = useTranslations("admissions.leavingReason");
  const tg = useTranslations("gradeLevel");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Array<{ id: string; label: string }>>([]);
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);
  const [v, setV] = useState({ leavingDate: new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10), reasonKey: "", destination: "", reasonNote: "" });
  const [pending, start] = useTransition();
  const search = (value: string) => {
    setQ(value);
    if (value.trim().length < 2) return setFound([]);
    start(async () => {
      const rows = await searchStudentsAction({ q: value });
      setFound(rows.map((r) => ({ id: r.id, label: `${locale === "ar" ? `${r.firstNameAr} ${r.lastNameAr}` : `${r.firstNameEn} ${r.lastNameEn}`} · ${tg("label", gradeLevelValues(r.gradeLevel))}${r.section ?? ""} · ${r.studentNo}` })));
    });
  };
  const save = () =>
    start(async () => {
      if (!student) return;
      const r = await planWithdrawalAction({ studentId: student.id, ...v });
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(t("planned_ok"));
      setOpen(false);
      setStudent(null);
      setQ("");
      router.refresh();
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="self-start" data-testid="plan-withdrawal">
          <Plus className="size-4" />
          {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
          <DialogDescription>{t("addBody")}</DialogDescription>
        </DialogHeader>
        {student ? (
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <span className="truncate">{student.label}</span>
            <Button size="sm" variant="ghost" onClick={() => setStudent(null)}>
              {t("changeStudent")}
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Input value={q} onChange={(e) => search(e.target.value)} placeholder={t("findStudent")} data-testid="withdraw-search" />
            {found.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
                {found.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="w-full rounded px-2 py-1.5 text-start text-sm hover:bg-muted" onClick={() => { setStudent(f); setFound([]); }}>
                      {f.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="wd" label={t("leavingDate")}>
            <Input id="wd" type="date" dir="ltr" value={v.leavingDate} onChange={(e) => setV({ ...v, leavingDate: e.target.value })} />
          </Field>
          <Field id="wr" label={t("reason")}>
            <select id="wr" className={selectClass} value={v.reasonKey} onChange={(e) => setV({ ...v, reasonKey: e.target.value })} data-testid="withdraw-reason">
              <option value="" disabled>
                {t("chooseReason")}
              </option>
              {LEAVING_REASONS.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="wdest" label={t("destination")} optional className="sm:col-span-2">
            <Input id="wdest" value={v.destination} maxLength={160} onChange={(e) => setV({ ...v, destination: e.target.value })} />
          </Field>
          <Field id="wn" label={t("note")} optional className="sm:col-span-2">
            <Textarea id="wn" rows={2} maxLength={500} value={v.reasonNote} onChange={(e) => setV({ ...v, reasonNote: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={pending || !student || !v.reasonKey} onClick={save} data-testid="withdraw-save">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawalActions({ id, canComplete, canCancel }: { id: string; canComplete: boolean; canCancel: boolean }) {
  const t = useTranslations("admissions.leavers");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      {canComplete && (
        <Button
          size="sm"
          className="h-8"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!window.confirm(t("completeConfirm"))) return;
              const r = await completeWithdrawalAction({ withdrawalId: id });
              if (!r.ok) return void toast.error(t("errors.generic"));
              toast.success(t("completed_ok", { tc: r.tcNumber }));
              router.refresh();
            })
          }
          data-testid="complete-withdrawal"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
          {t("complete")}
        </Button>
      )}
      {canCancel && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await cancelWithdrawalAction({ withdrawalId: id });
              if (!r.ok) return void toast.error(t("errors.generic"));
              router.refresh();
            })
          }
        >
          {t("cancel")}
        </Button>
      )}
    </div>
  );
}
