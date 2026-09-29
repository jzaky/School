"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, MapPin, MoreHorizontal, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { addCourseRowAction, deleteCourseRowAction, setCourseMappingAction, updateCourseRowAction, applyCurrentAverageAction, type CourseOption } from "@/server/transcripts/actions";
import { CoursePickerDialog, useTxErr } from "./picker";

const GRADES = [6, 7, 8, 9, 10, 11, 12];
const STATUSES = ["COMPLETED", "IN_PROGRESS", "PLANNED"] as const;
type Status = (typeof STATUSES)[number];

export type RecordRowProps = {
  id: string;
  name: string;
  status: Status;
  gradeLevel: number;
  schoolYear: string | null;
  finalGrade: string | null;
  predictedGrade: string | null;
  mappingStatus: string;
  hasCourse: boolean;
  curriculum: string | null;
};

function useRun() {
  const err = useTxErr();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return err(res.error ?? "generic");
      if (done) toast.success(done);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

/** "Use current average": copies the Grades module suggestion into the prediction, only when asked. */
export function UseAverageButton({ id, suggestion }: { id: string; suggestion: string }) {
  const t = useTranslations("transcripts.record");
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pending} onClick={() => run(() => applyCurrentAverageAction(id), t("averageUsed", { grade: suggestion }))} data-testid="use-average">
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
      {t("useAverage", { grade: suggestion })}
    </Button>
  );
}

export function RecordRowMenu({ row, canManage, isStudent }: { row: RecordRowProps; canManage: boolean; isStudent: boolean }) {
  const t = useTranslations("transcripts.record");
  const ts = useTranslations("transcripts.courseStatus");
  const { pending, run } = useRun();
  const [edit, setEdit] = useState(false);
  const [pick, setPick] = useState(false);
  const [del, setDel] = useState(false);
  const [f, setF] = useState({ name: row.name, gradeLevel: row.gradeLevel, schoolYear: row.schoolYear ?? "", status: row.status, finalGrade: row.finalGrade ?? "", predictedGrade: row.predictedGrade ?? "" });
  const studentEdits = isStudent && row.status !== "COMPLETED";
  if (!canManage && !isStudent) return null;
  const save = () =>
    run(
      () => updateCourseRowAction({ id: row.id, patch: canManage ? { localName: f.name, gradeLevel: f.gradeLevel, schoolYear: f.schoolYear || null, status: f.status, finalGrade: f.finalGrade || null, predictedGrade: f.predictedGrade || null } : { predictedGrade: f.predictedGrade || null } }),
      t("saved"),
      () => setEdit(false),
    );
  const pickCourse = (c: CourseOption) => run(() => setCourseMappingAction({ id: row.id, courseId: c.id }), canManage ? t("mapped") : t("suggested"));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8" aria-label={t("actions")} disabled={pending} data-testid="record-menu">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(canManage || studentEdits) && (
            <DropdownMenuItem onSelect={() => setEdit(true)} data-testid="record-edit">
              <Pencil className="size-4" />
              {canManage ? t("edit") : t("editPrediction")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPick(true)} data-testid="record-map">
            <Search className="size-4" />
            {canManage ? t("fixMapping") : t("suggestMapping")}
          </DropdownMenuItem>
          {canManage && row.hasCourse && row.mappingStatus !== "CONFIRMED" && (
            <DropdownMenuItem onSelect={() => run(() => setCourseMappingAction({ id: row.id, confirm: true }), t("mapped"))} data-testid="record-confirm">
              <Check className="size-4" />
              {t("confirmMapping")}
            </DropdownMenuItem>
          )}
          {canManage && row.hasCourse && (
            <DropdownMenuItem onSelect={() => run(() => setCourseMappingAction({ id: row.id, local: true }), t("mapped"))}>
              <MapPin className="size-4" />
              {t("keepLocal")}
            </DropdownMenuItem>
          )}
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDel(true)} className="text-danger focus:text-danger">
                <Trash2 className="size-4" />
                {t("delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CoursePickerDialog open={pick} onOpenChange={setPick} curriculum={row.curriculum} title={canManage ? t("fixMapping") : t("suggestMapping")} description={canManage ? t("fixMappingDesc") : t("suggestMappingDesc")} onPick={pickCourse} />

      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{canManage ? t("edit") : t("editPrediction")}</DialogTitle>
            <DialogDescription>{row.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {canManage && (
              <>
                <div className="space-y-1 sm:col-span-2">
                  <Label>{t("field.name")}</Label>
                  <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t("field.grade")}</Label>
                  <Select value={String(f.gradeLevel)} onValueChange={(v) => setF({ ...f, gradeLevel: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADES.map((g) => (
                        <SelectItem key={g} value={String(g)}>
                          {t("gradeN", { grade: g })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("field.year")}</Label>
                  <Input value={f.schoolYear} onChange={(e) => setF({ ...f, schoolYear: e.target.value })} placeholder="2025-2026" dir="ltr" />
                </div>
                <div className="space-y-1">
                  <Label>{t("field.status")}</Label>
                  <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as Status })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ts(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("field.final")}</Label>
                  <Input value={f.finalGrade} onChange={(e) => setF({ ...f, finalGrade: e.target.value })} maxLength={8} dir="ltr" />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label>{t("field.predicted")}</Label>
              <Input value={f.predictedGrade} onChange={(e) => setF({ ...f, predictedGrade: e.target.value })} maxLength={8} dir="ltr" data-testid="edit-predicted" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending} data-testid="save-row">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={del} onOpenChange={setDel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody", { name: row.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDel(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteCourseRowAction(row.id), t("deleted"), () => setDel(false))}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AddCourseButton({ studentId, curriculum, defaultGrade }: { studentId: string; curriculum: string; defaultGrade: number }) {
  const t = useTranslations("transcripts.record");
  const ts = useTranslations("transcripts.courseStatus");
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const [course, setCourse] = useState<CourseOption | null>(null);
  const [f, setF] = useState({ name: "", gradeLevel: defaultGrade, status: "IN_PROGRESS" as Status, finalGrade: "", predictedGrade: "", schoolYear: "" });
  const submit = () =>
    run(
      () => addCourseRowAction({ studentId, courseId: course?.id ?? null, localName: f.name || course?.nameEn || "", gradeLevel: f.gradeLevel, status: f.status, schoolYear: f.schoolYear || null, finalGrade: f.finalGrade || null, predictedGrade: f.predictedGrade || null }),
      t("added"),
      () => {
        setOpen(false);
        setCourse(null);
        setF({ ...f, name: "", finalGrade: "", predictedGrade: "" });
      },
    );
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="add-course">
        <Plus className="size-4" />
        {t("add")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{t("addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>{t("field.course")}</Label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-sm">{course ? `${course.code} · ${course.nameEn}` : <span className="text-muted-foreground">{t("noCourse")}</span>}</div>
                <Button type="button" variant="outline" size="sm" onClick={() => setPick(true)}>
                  <Search className="size-4" />
                  {t("pick")}
                </Button>
              </div>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>{t("field.name")}</Label>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={course?.nameEn ?? t("namePlaceholder")} />
            </div>
            <div className="space-y-1">
              <Label>{t("field.grade")}</Label>
              <Select value={String(f.gradeLevel)} onValueChange={(v) => setF({ ...f, gradeLevel: Number(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRADES.map((g) => (
                    <SelectItem key={g} value={String(g)}>
                      {t("gradeN", { grade: g })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("field.status")}</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as Status })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {ts(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("field.final")}</Label>
              <Input value={f.finalGrade} onChange={(e) => setF({ ...f, finalGrade: e.target.value })} maxLength={8} dir="ltr" />
            </div>
            <div className="space-y-1">
              <Label>{t("field.predicted")}</Label>
              <Input value={f.predictedGrade} onChange={(e) => setF({ ...f, predictedGrade: e.target.value })} maxLength={8} dir="ltr" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || (!course && !f.name.trim())} data-testid="save-new-course">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CoursePickerDialog open={pick} onOpenChange={setPick} curriculum={curriculum} title={t("pick")} onPick={setCourse} />
    </>
  );
}
