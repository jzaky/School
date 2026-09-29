"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2, Users, Wand2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { bulkEditTeachersAction, prefillTeacherSubjectsAction, saveTeacherSubjectsAction } from "@/server/timetable/actions";
import { useTtError } from "./lesson-dialog";

export type TeacherRow = { id: string; name: string; department: string; max: number; load: number; quals: Array<{ subjectId: string; subject: string; grades: number[] }> };
type Subject = { id: string; name: string };
const GRADES = [6, 7, 8, 9, 10, 11, 12];

function gradeRange(gs: number[]) {
  if (!gs.length) return "";
  const s = [...gs].sort((a, b) => a - b);
  const contiguous = s.every((g, i) => i === 0 || g === s[i - 1] + 1);
  return contiguous && s.length > 1 ? `${s[0]}-${s[s.length - 1]}` : s.join(", ");
}

function GradePicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {GRADES.map((g) => {
        const on = value.includes(g);
        return (
          <button key={g} type="button" onClick={() => onChange(on ? value.filter((x) => x !== g) : [...value, g])} className={cn("size-8 rounded-md border text-xs font-medium tabular-nums", on ? "border-brand bg-brand text-brand-foreground" : "bg-card text-muted-foreground")} aria-pressed={on}>
            {g}
          </button>
        );
      })}
    </div>
  );
}

export function TeacherSubjectsTable({ rows, subjects }: { rows: TeacherRow[]; subjects: Subject[] }) {
  const t = useTranslations("timetable");
  const err = useTtError();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<TeacherRow | null>(null);
  const [bulk, setBulk] = useState(false);
  const [pending, start] = useTransition();

  const prefill = () =>
    start(async () => {
      const r = await prefillTeacherSubjectsAction();
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(t("prefilled", { created: r.created, updated: r.updated }));
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("teachersHelp")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={prefill} disabled={pending} data-testid="prefill">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {t("prefill")}
          </Button>
          <Button onClick={() => setBulk(true)} disabled={selected.length === 0} data-testid="bulk-edit">
            <Users className="size-4" />
            {t("bulkEdit", { n: selected.length })}
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title={t("noTeachers")} body={t("noTeachersBody")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[32px_minmax(0,1.2fr)_minmax(0,2fr)_130px_90px] gap-3 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
            <Checkbox checked={selected.length === rows.length} onCheckedChange={(c) => setSelected(c ? rows.map((r) => r.id) : [])} aria-label={t("selectAll")} />
            <span>{t("colTeacher")}</span>
            <span>{t("colQualified")}</span>
            <span>{t("colLoad")}</span>
            <span className="text-end">{t("colActions")}</span>
          </div>
          <ul className="divide-y">
            {rows.map((r) => {
              const pct = Math.min(100, Math.round((r.load / Math.max(1, r.max)) * 100));
              return (
                <li key={r.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] gap-3 px-4 py-3 lg:grid-cols-[32px_minmax(0,1.2fr)_minmax(0,2fr)_130px_90px] lg:items-center" data-testid="teacher-row">
                  <Checkbox checked={selected.includes(r.id)} onCheckedChange={(c) => setSelected(c ? [...selected, r.id] : selected.filter((x) => x !== r.id))} aria-label={r.name} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.department || t("noDepartment")}</div>
                  </div>
                  <div className="col-span-2 col-start-2 flex flex-wrap gap-1 lg:col-span-1 lg:col-start-auto">
                    {r.quals.length === 0 ? <span className="text-xs text-muted-foreground">{t("noQuals")}</span> : r.quals.map((q) => <Pill key={q.subjectId}>{t("qualChip", { subject: q.subject, grades: gradeRange(q.grades) })}</Pill>)}
                  </div>
                  <div className="col-span-2 col-start-2 lg:col-span-1 lg:col-start-auto">
                    <div className="text-xs tabular-nums">{t("loadOf", { load: r.load, max: r.max })}</div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                      <div className={cn("h-1.5 rounded-full", r.load > r.max ? "bg-danger" : "bg-brand")} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="col-start-3 row-start-1 lg:col-start-auto lg:row-start-auto lg:text-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} data-testid="edit-teacher">
                      <Pencil className="size-4" />
                      <span className="sr-only lg:not-sr-only">{t("edit")}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {editing && <EditDialog row={editing} subjects={subjects} onClose={() => setEditing(null)} />}
      {bulk && <BulkDialog ids={selected} subjects={subjects} onClose={() => setBulk(false)} onDone={() => setSelected([])} />}
    </div>
  );
}

function EditDialog({ row, subjects, onClose }: { row: TeacherRow; subjects: Subject[]; onClose: () => void }) {
  const t = useTranslations("timetable");
  const err = useTtError();
  const router = useRouter();
  const [quals, setQuals] = useState(row.quals.map((q) => ({ subjectId: q.subjectId, grades: q.grades })));
  const [max, setMax] = useState(String(row.max));
  const [add, setAdd] = useState<string>("");
  const [pending, start] = useTransition();
  const free = subjects.filter((s) => !quals.some((q) => q.subjectId === s.id));
  const valid = Number(max) >= 1 && Number(max) <= 45;
  const save = () =>
    start(async () => {
      const r = await saveTeacherSubjectsAction({ membershipId: row.id, rows: quals.map((q) => ({ subjectId: q.subjectId, gradeLevels: q.grades })), maxPeriodsPerWeek: Number(max) });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(t("saved"));
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>{t("editTeacherBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="max-periods">{t("maxPeriods")}</Label>
            <Input id="max-periods" type="number" min={1} max={45} value={max} onChange={(e) => setMax(e.target.value)} className="w-28" data-testid="max-periods" />
          </div>
          <div className="space-y-2">
            {quals.map((q) => (
              <div key={q.subjectId} className="rounded-lg border p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{subjects.find((s) => s.id === q.subjectId)?.name}</span>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => setQuals(quals.filter((x) => x.subjectId !== q.subjectId))} aria-label={t("remove")}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <GradePicker value={q.grades} onChange={(g) => setQuals(quals.map((x) => (x.subjectId === q.subjectId ? { ...x, grades: g } : x)))} />
              </div>
            ))}
            {quals.length === 0 && <p className="text-sm text-muted-foreground">{t("noQuals")}</p>}
          </div>
          <div className="flex gap-2">
            <Select value={add} onValueChange={setAdd}>
              <SelectTrigger className="flex-1" data-testid="add-subject">
                <SelectValue placeholder={t("addSubject")} />
              </SelectTrigger>
              <SelectContent>
                {free.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!add} onClick={() => (setQuals([...quals, { subjectId: add, grades: [] }]), setAdd(""))}>
              <Plus className="size-4" />
              {t("add")}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending || !valid} data-testid="save-teacher">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkDialog({ ids, subjects, onClose, onDone }: { ids: string[]; subjects: Subject[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("timetable");
  const err = useTtError();
  const router = useRouter();
  const [max, setMax] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [grades, setGrades] = useState<number[]>([]);
  const [pending, start] = useTransition();
  const valid = (max !== "" && Number(max) >= 1 && Number(max) <= 45) || (subjectId && grades.length > 0);
  const save = () =>
    start(async () => {
      const r = await bulkEditTeachersAction({ membershipIds: ids, maxPeriodsPerWeek: max ? Number(max) : null, addSubjectId: subjectId || null, addGrades: grades });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(t("bulkSaved", { n: r.updated }));
      onDone();
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bulkTitle", { n: ids.length })}</DialogTitle>
          <DialogDescription>{t("bulkBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-max">{t("maxPeriods")}</Label>
            <Input id="bulk-max" type="number" min={1} max={45} value={max} onChange={(e) => setMax(e.target.value)} placeholder={t("leaveAsIs")} className="w-40" data-testid="bulk-max" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("addSubject")}</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("leaveAsIs")} />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subjectId && <GradePicker value={grades} onChange={setGrades} />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending || !valid} data-testid="save-bulk">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
