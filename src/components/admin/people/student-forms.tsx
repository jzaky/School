"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Lock, UserPlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import { cn } from "@/lib/utils";
import { MAX_GRADE, MIN_GRADE, RELATIONSHIPS } from "@/lib/people-csv";
import { addStudentAction } from "@/server/admin/people-actions";
import { usePeopleError } from "./staff-forms";

type GuardianMode = "none" | "existing" | "new";
const GRADES = Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, i) => MIN_GRADE + i);

function Field({ id, label, children, hint }: { id?: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RelationshipSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("adminPeople");
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" data-testid="guardian-relationship">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.keys(RELATIONSHIPS).map((k) => (
          <SelectItem key={k} value={k}>
            {t(`relationship.${k}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AddStudentDialog({ guardians }: { guardians: PickerOption[] }) {
  const t = useTranslations("adminPeople");
  const err = usePeopleError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const empty = { studentNo: "", firstNameEn: "", lastNameEn: "", firstNameAr: "", lastNameAr: "", section: "", dateOfBirth: "", emiratesId: "", passportNo: "" };
  const [f, setF] = useState(empty);
  const [grade, setGrade] = useState("");
  const [mode, setMode] = useState<GuardianMode>("none");
  const [guardianId, setGuardianId] = useState("");
  const [relationship, setRelationship] = useState("mother");
  const emptyGuardian = { firstNameEn: "", lastNameEn: "", firstNameAr: "", lastNameAr: "", email: "", phone: "" };
  const [g, setG] = useState(emptyGuardian);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setGuardian = (k: keyof typeof emptyGuardian) => (e: React.ChangeEvent<HTMLInputElement>) => setG((p) => ({ ...p, [k]: e.target.value }));

  const guardianOk = mode === "none" || (mode === "existing" && !!guardianId) || (mode === "new" && !!g.firstNameEn.trim() && !!g.lastNameEn.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(g.email.trim()));
  const valid = !!f.studentNo.trim() && !!f.firstNameEn.trim() && !!f.lastNameEn.trim() && !!grade && guardianOk;

  const reset = () => {
    setF(empty);
    setGrade("");
    setMode("none");
    setGuardianId("");
    setRelationship("mother");
    setG(emptyGuardian);
  };

  const submit = () =>
    start(async () => {
      const guardian =
        mode === "existing" ? { mode, guardianId, relationship } : mode === "new" ? { mode, relationship, ...g } : { mode: "none" as const };
      const res = await addStudentAction({ ...f, gradeLevel: Number(grade), guardian });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("studentAdded", { name: `${f.firstNameEn.trim()} ${f.lastNameEn.trim()}` }));
      setOpen(false);
      reset();
      router.refresh();
    });

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="add-student">
        <UserPlus className="size-4" />
        {t("addStudent")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("addStudentTitle")}</DialogTitle>
            <DialogDescription>{t("addStudentBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="st-no" label={t("fieldStudentNo")}>
                <Input id="st-no" value={f.studentNo} onChange={set("studentNo")} dir="ltr" data-testid="student-no" />
              </Field>
              <Field label={t("fieldGrade")}>
                <Select value={grade} onValueChange={setGrade}>
                  <SelectTrigger className="w-full" data-testid="student-grade">
                    <SelectValue placeholder={t("chooseGrade")} />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {t("gradeN", { grade: n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="st-section" label={t("fieldSection")}>
                <Input id="st-section" value={f.section} onChange={set("section")} maxLength={3} dir="ltr" placeholder={t("optional")} data-testid="student-section" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="st-fn-en" label={t("fieldFirstNameEn")}>
                <Input id="st-fn-en" value={f.firstNameEn} onChange={set("firstNameEn")} dir="ltr" data-testid="student-first-en" />
              </Field>
              <Field id="st-ln-en" label={t("fieldLastNameEn")}>
                <Input id="st-ln-en" value={f.lastNameEn} onChange={set("lastNameEn")} dir="ltr" data-testid="student-last-en" />
              </Field>
              <Field id="st-fn-ar" label={t("fieldFirstNameAr")}>
                <Input id="st-fn-ar" value={f.firstNameAr} onChange={set("firstNameAr")} dir="rtl" data-testid="student-first-ar" />
              </Field>
              <Field id="st-ln-ar" label={t("fieldLastNameAr")}>
                <Input id="st-ln-ar" value={f.lastNameAr} onChange={set("lastNameAr")} dir="rtl" data-testid="student-last-ar" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="st-dob" label={t("fieldDob")}>
                <Input id="st-dob" type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} data-testid="student-dob" />
              </Field>
              <Field id="st-eid" label={t("fieldEmiratesId")}>
                <Input id="st-eid" value={f.emiratesId} onChange={set("emiratesId")} dir="ltr" placeholder="784-XXXX-XXXXXXX-X" autoComplete="off" />
              </Field>
              <Field id="st-passport" label={t("fieldPassport")}>
                <Input id="st-passport" value={f.passportNo} onChange={set("passportNo")} dir="ltr" placeholder={t("optional")} autoComplete="off" />
              </Field>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0" />
              {t("idsEncrypted")}
            </p>

            <div className="space-y-3 rounded-xl border p-3">
              <div className="text-sm font-medium">{t("guardianSection")}</div>
              <div className="flex gap-1 rounded-lg bg-muted p-1" role="radiogroup">
                {(["none", "existing", "new"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    data-testid={`guardian-mode-${m}`}
                    className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition sm:text-sm", mode === m ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
                  >
                    {t(`guardianMode.${m}`)}
                  </button>
                ))}
              </div>
              {mode === "existing" && (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <Field label={t("fieldGuardian")}>
                    <PickerCombobox options={guardians} value={guardianId} onChange={setGuardianId} placeholder={t("chooseGuardian")} testId="guardian-picker" />
                  </Field>
                  <Field label={t("fieldRelationship")}>
                    <RelationshipSelect value={relationship} onChange={setRelationship} />
                  </Field>
                </div>
              )}
              {mode === "new" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="g-fn-en" label={t("fieldFirstNameEn")}>
                    <Input id="g-fn-en" value={g.firstNameEn} onChange={setGuardian("firstNameEn")} dir="ltr" data-testid="guardian-first-en" />
                  </Field>
                  <Field id="g-ln-en" label={t("fieldLastNameEn")}>
                    <Input id="g-ln-en" value={g.lastNameEn} onChange={setGuardian("lastNameEn")} dir="ltr" data-testid="guardian-last-en" />
                  </Field>
                  <Field id="g-fn-ar" label={t("fieldFirstNameAr")}>
                    <Input id="g-fn-ar" value={g.firstNameAr} onChange={setGuardian("firstNameAr")} dir="rtl" />
                  </Field>
                  <Field id="g-ln-ar" label={t("fieldLastNameAr")}>
                    <Input id="g-ln-ar" value={g.lastNameAr} onChange={setGuardian("lastNameAr")} dir="rtl" />
                  </Field>
                  <Field id="g-email" label={t("fieldEmail")}>
                    <Input id="g-email" type="email" value={g.email} onChange={setGuardian("email")} dir="ltr" data-testid="guardian-email" />
                  </Field>
                  <Field id="g-phone" label={t("fieldPhone")}>
                    <Input id="g-phone" type="tel" value={g.phone} onChange={setGuardian("phone")} dir="ltr" placeholder={t("optional")} />
                  </Field>
                  <Field label={t("fieldRelationship")}>
                    <RelationshipSelect value={relationship} onChange={setRelationship} />
                  </Field>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !valid} data-testid="student-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("addStudent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
