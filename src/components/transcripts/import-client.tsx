"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Download, FileUp, Keyboard, Loader2, MapPin, Plus, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { commitImportAction, manualTranscriptAction, setRowDecisionAction, uploadTranscriptAction } from "@/server/transcripts/actions";
import { CURRICULA } from "@/server/pathway-engine/types";
import { TEMPLATE_CSV } from "@/server/transcripts/types";
import { CoursePickerDialog, useTxErr } from "./picker";

type StudentOpt = { id: string; label: string; grade: number; curriculum: string };
const GRADES = [6, 7, 8, 9, 10, 11, 12];
const STATUSES = ["COMPLETED", "IN_PROGRESS", "PLANNED"] as const;

function downloadTemplate() {
  const blob = new Blob(["﻿" + TEMPLATE_CSV + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transcript-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Student search for staff: type a name, pick from the matches. */
function StudentField({ students, value, onChange }: { students: StudentOpt[]; value: string; onChange: (id: string) => void }) {
  const t = useTranslations("transcripts.new");
  const [q, setQ] = useState("");
  const chosen = students.find((s) => s.id === value);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (n ? students.filter((s) => s.label.toLowerCase().includes(n)) : students).slice(0, 6);
  }, [q, students]);
  if (chosen)
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm" data-testid="chosen-student">
        <span className="min-w-0 truncate">
          {chosen.label} <span className="text-muted-foreground">{t("gradeShort", { grade: chosen.grade })}</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
          {t("change")}
        </Button>
      </div>
    );
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchStudent")} className="ps-9" data-testid="student-search" />
      </div>
      <ul className="divide-y rounded-lg border">
        {matches.map((s) => (
          <li key={s.id}>
            <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-muted/50" onClick={() => onChange(s.id)} data-testid="student-option">
              <span className="min-w-0 truncate">{s.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t("gradeShort", { grade: s.grade })}</span>
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{t("noStudents")}</li>}
      </ul>
    </div>
  );
}

type ManualRow = { name: string; gradeLevel: number; status: (typeof STATUSES)[number]; finalGrade: string; predictedGrade: string };

export function NewImportForm({ students, self, initialStudentId }: { students: StudentOpt[] | null; self: StudentOpt | null; initialStudentId?: string | null }) {
  const t = useTranslations("transcripts.new");
  const tc = useTranslations("engine.curriculum");
  const ts = useTranslations("transcripts.courseStatus");
  const err = useTxErr();
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "manual">("file");
  const [studentId, setStudentId] = useState(self?.id ?? initialStudentId ?? "");
  const student = self ?? students?.find((s) => s.id === studentId) ?? null;
  const [curriculum, setCurriculum] = useState<string>(student?.curriculum ?? "BRITISH");
  const [grade, setGrade] = useState<number>(student ? Math.max(6, student.grade - 1) : 10);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ManualRow[]>([{ name: "", gradeLevel: 10, status: "COMPLETED", finalGrade: "", predictedGrade: "" }]);
  const [pending, start] = useTransition();

  const pickStudent = (id: string) => {
    setStudentId(id);
    const s = students?.find((x) => x.id === id);
    if (s) {
      setCurriculum(s.curriculum);
      setGrade(Math.max(6, s.grade - 1));
    }
  };

  const opened = (res: { id: string; rows: number; needsReview: number }) => {
    toast.success(t("created", { rows: res.rows, review: res.needsReview }));
    router.push(`/career/pathways/imports/${res.id}`);
  };

  const submitFile = () =>
    start(async () => {
      if (!file) return;
      const fd = new FormData();
      fd.set("file", file);
      fd.set("studentId", studentId);
      fd.set("curriculum", curriculum);
      fd.set("defaultGradeLevel", String(grade));
      const res = await uploadTranscriptAction(fd);
      if (!res.ok) return err(res.error);
      if (res.warnings) toast.warning(t("warnings", { n: res.warnings }));
      opened(res);
    });

  const submitManual = () =>
    start(async () => {
      const clean = rows.filter((r) => r.name.trim());
      const res = await manualTranscriptAction({ studentId, curriculum: curriculum as (typeof CURRICULA)[number], rows: clean.map((r) => ({ name: r.name, gradeLevel: r.gradeLevel, status: r.status, finalGrade: r.finalGrade || null, predictedGrade: r.predictedGrade || null })) });
      if (!res.ok) return err(res.error);
      opened(res);
    });

  const setRow = (i: number, patch: Partial<ManualRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const manualReady = rows.some((r) => r.name.trim());

  return (
    <div className="space-y-4" data-testid="new-import">
      {students && (
        <div className="space-y-1.5">
          <Label>{t("student")}</Label>
          <StudentField students={students} value={studentId} onChange={pickStudent} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("curriculum")}</Label>
          <Select value={curriculum} onValueChange={setCurriculum}>
            <SelectTrigger data-testid="import-curriculum">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRICULA.map((c) => (
                <SelectItem key={c} value={c}>
                  {tc(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("curriculumHint")}</p>
        </div>
        {mode === "file" && (
          <div className="space-y-1.5">
            <Label>{t("defaultGrade")}</Label>
            <Select value={String(grade)} onValueChange={(v) => setGrade(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADES.map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    {t("gradeShort", { grade: g })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("defaultGradeHint")}</p>
          </div>
        )}
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(["file", "manual"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", mode === m ? "bg-card shadow-xs" : "text-muted-foreground")} data-testid={`mode-${m}`}>
            {m === "file" ? <FileUp className="size-4" /> : <Keyboard className="size-4" />}
            {t(`mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center hover:bg-muted/50">
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : t("chooseFile")}</span>
            <span className="text-xs text-muted-foreground">{t("fileHint")}</span>
            <input type="file" accept=".csv,.xlsx,.pdf,text/csv,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="import-file" />
          </label>
          <p className="text-xs text-muted-foreground">{t("scannedHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={submitFile} disabled={pending || !file || !studentId} data-testid="upload-import">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {t("upload")}
            </Button>
            <Button type="button" variant="outline" onClick={downloadTemplate} data-testid="download-template">
              <Download className="size-4" />
              {t("template")}
            </Button>
          </div>
          {!studentId && <p className="text-xs text-muted-foreground">{t("pickStudentFirst")}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_9rem_5rem_5rem_auto] sm:items-end">
                <div className="space-y-1">
                  <Label className="text-xs">{t("row.name")}</Label>
                  <Input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder={t("row.namePlaceholder")} data-testid="manual-name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("row.grade")}</Label>
                  <Select value={String(r.gradeLevel)} onValueChange={(v) => setRow(i, { gradeLevel: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADES.map((g) => (
                        <SelectItem key={g} value={String(g)}>
                          {t("gradeShort", { grade: g })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("row.status")}</Label>
                  <Select value={r.status} onValueChange={(v) => setRow(i, { status: v as ManualRow["status"] })}>
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
                  <Label className="text-xs">{t("row.final")}</Label>
                  <Input value={r.finalGrade} onChange={(e) => setRow(i, { finalGrade: e.target.value })} maxLength={8} dir="ltr" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("row.predicted")}</Label>
                  <Input value={r.predictedGrade} onChange={(e) => setRow(i, { predictedGrade: e.target.value })} maxLength={8} dir="ltr" />
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label={t("row.remove")} title={t("row.remove")} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setRows((rs) => [...rs, { ...rs[rs.length - 1], name: "", finalGrade: "", predictedGrade: "" }])} disabled={rows.length >= 40}>
              <Plus className="size-4" />
              {t("row.add")}
            </Button>
            <Button type="button" onClick={submitManual} disabled={pending || !manualReady || !studentId} data-testid="submit-manual">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("reviewRows")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Review

export function RowActions({ importId, row, curriculum, hasSuggestion, decision, alternatives }: { importId: string; row: number; curriculum: string; hasSuggestion: boolean; decision: string; alternatives: Array<{ id: string; label: string; confidence: number }> }) {
  const t = useTranslations("transcripts.review");
  const err = useTxErr();
  const router = useRouter();
  const [pick, setPick] = useState(false);
  const [pending, start] = useTransition();
  const act = (action: Parameters<typeof setRowDecisionAction>[0]["action"]) =>
    start(async () => {
      const res = await setRowDecisionAction({ importId, row, action });
      if (!res.ok) return err(res.error);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="row-actions">
      {hasSuggestion && decision !== "CONFIRMED" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act({ type: "confirm" })} data-testid="confirm-row">
          <Check className="size-3.5" />
          {t("confirm")}
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setPick(true)} data-testid="choose-row">
        <Search className="size-3.5" />
        {hasSuggestion ? t("change") : t("choose")}
      </Button>
      {decision !== "LOCAL" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act({ type: "local" })} data-testid="local-row">
          <MapPin className="size-3.5" />
          {t("local")}
        </Button>
      )}
      {(decision === "CONFIRMED" || decision === "LOCAL") && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act({ type: "reset" })} title={t("resetHint")}>
          <RotateCcw className="size-3.5" />
          {t("reset")}
        </Button>
      )}
      {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {alternatives.length > 0 && decision === "NEEDS_REVIEW" && (
        <div className="flex w-full flex-wrap items-center gap-1.5 pt-1 text-xs">
          <span className="text-muted-foreground">{t("alternatives")}</span>
          {alternatives.map((a) => (
            <button key={a.id} type="button" disabled={pending} className="rounded-full border px-2 py-0.5 hover:bg-muted" onClick={() => act({ type: "choose", courseId: a.id })}>
              {a.label} <span className="text-muted-foreground tabular-nums">{Math.round(a.confidence * 100)}%</span>
            </button>
          ))}
        </div>
      )}
      <CoursePickerDialog open={pick} onOpenChange={setPick} curriculum={curriculum} title={t("pickTitle")} description={t("pickDesc")} onPick={(c) => act({ type: "choose", courseId: c.id })} />
    </div>
  );
}

export function CommitButton({ importId, needsReview, committed }: { importId: string; needsReview: number; committed: boolean }) {
  const t = useTranslations("transcripts.review");
  const err = useTxErr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const commit = () =>
    start(async () => {
      const res = await commitImportAction(importId);
      if (!res.ok) return err(res.error);
      setOpen(false);
      toast.success(t("committed", { created: res.summary.created, updated: res.summary.updated, changed: res.summary.programs.length }));
      router.refresh();
    });
  return (
    <>
      <Button onClick={() => (needsReview ? setOpen(true) : commit())} disabled={pending} data-testid="commit-import">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        {committed ? t("commitAgain") : t("commit")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("commitTitle")}</DialogTitle>
            <DialogDescription>{t("commitWarning", { n: needsReview })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("keepReviewing")}
            </Button>
            <Button onClick={commit} disabled={pending} data-testid="commit-anyway">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("commitAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
