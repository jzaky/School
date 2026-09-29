"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addSchoolCourseAction, updateSchoolCourseAction, type CourseOption } from "@/server/transcripts/actions";
import { CoursePickerDialog, useTxErr } from "./picker";

const GRADES = [9, 10, 11, 12];
type Opt = { value: string; label: string };
const NONE = "none";

function GradeToggles({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const t = useTranslations("transcripts.catalog");
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("grades")}>
      {GRADES.map((g) => {
        const on = value.includes(g);
        return (
          <button
            key={g}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== g) : [...value, g].sort((a, b) => a - b))}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}
            data-testid={`grade-toggle-${g}`}
          >
            {t("gradeN", { grade: g })}
          </button>
        );
      })}
    </div>
  );
}

type FormState = { gradeLevels: number[]; subjectId: string; notesEn: string; notesAr: string };

function CourseForm({ f, setF, subjects }: { f: FormState; setF: (f: FormState) => void; subjects: Opt[] }) {
  const t = useTranslations("transcripts.catalog");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>{t("grades")}</Label>
        <GradeToggles value={f.gradeLevels} onChange={(gradeLevels) => setF({ ...f, gradeLevels })} />
      </div>
      <div className="space-y-1.5">
        <Label>{t("subject")}</Label>
        <Select value={f.subjectId || NONE} onValueChange={(v) => setF({ ...f, subjectId: v === NONE ? "" : v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("noSubject")}</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("subjectHint")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("notesEn")}</Label>
          <Textarea value={f.notesEn} onChange={(e) => setF({ ...f, notesEn: e.target.value })} rows={2} dir="ltr" maxLength={500} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("notesAr")}</Label>
          <Textarea value={f.notesAr} onChange={(e) => setF({ ...f, notesAr: e.target.value })} rows={2} dir="rtl" maxLength={500} />
        </div>
      </div>
    </div>
  );
}

function useRun() {
  const err = useTxErr();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return err(res.error ?? "generic");
      toast.success(done);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

export function AddSchoolCourse({ subjects, curriculum }: { subjects: Opt[]; curriculum: string | null }) {
  const t = useTranslations("transcripts.catalog");
  const locale = useLocale();
  const { pending, run } = useRun();
  const [pick, setPick] = useState(false);
  const [course, setCourse] = useState<CourseOption | null>(null);
  const [f, setF] = useState<FormState>({ gradeLevels: [], subjectId: "", notesEn: "", notesAr: "" });
  const choose = (c: CourseOption) => {
    setCourse(c);
    setF({ gradeLevels: c.gradeLevel && c.gradeLevel >= 9 ? [c.gradeLevel] : [11, 12], subjectId: "", notesEn: "", notesAr: "" });
  };
  const close = () => setCourse(null);
  return (
    <>
      <Button onClick={() => setPick(true)} data-testid="catalog-add">
        <Plus className="size-4" />
        {t("add")}
      </Button>
      <CoursePickerDialog open={pick} onOpenChange={setPick} curriculum={curriculum} title={t("addTitle")} description={t("addDesc")} onPick={choose} />
      <Dialog open={!!course} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{course ? (locale === "ar" ? course.nameAr : course.nameEn) : ""}</DialogTitle>
            <DialogDescription dir="ltr" className="text-start">
              {course?.code}
            </DialogDescription>
          </DialogHeader>
          <CourseForm f={f} setF={setF} subjects={subjects} />
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending || !f.gradeLevels.length}
              onClick={() => course && run(() => addSchoolCourseAction({ courseId: course.id, gradeLevels: f.gradeLevels, subjectId: f.subjectId || null, notesEn: f.notesEn || null, notesAr: f.notesAr || null }), t("added"), close)}
              data-testid="catalog-save-new"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CatalogRowControls({ row, subjects }: { row: { id: string; name: string; active: boolean; gradeLevels: number[]; subjectId: string | null; notesEn: string | null; notesAr: string | null }; subjects: Opt[] }) {
  const t = useTranslations("transcripts.catalog");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormState>({ gradeLevels: row.gradeLevels, subjectId: row.subjectId ?? "", notesEn: row.notesEn ?? "", notesAr: row.notesAr ?? "" });
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={row.active} disabled={pending} onCheckedChange={(v) => run(() => updateSchoolCourseAction({ id: row.id, active: v }), v ? t("activated") : t("deactivated"))} aria-label={t("active")} data-testid="catalog-active" />
        <span className="hidden sm:inline">{row.active ? t("activeOn") : t("activeOff")}</span>
      </label>
      <Button size="icon" variant="ghost" className="size-8" aria-label={t("edit")} title={t("edit")} onClick={() => setOpen(true)} data-testid="catalog-edit">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{row.name}</DialogTitle>
            <DialogDescription>{t("editDesc")}</DialogDescription>
          </DialogHeader>
          <CourseForm f={f} setF={setF} subjects={subjects} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || !f.gradeLevels.length} onClick={() => run(() => updateSchoolCourseAction({ id: row.id, gradeLevels: f.gradeLevels, subjectId: f.subjectId || null, notesEn: f.notesEn || null, notesAr: f.notesAr || null }), t("saved"), () => setOpen(false))} data-testid="catalog-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

