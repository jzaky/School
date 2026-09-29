"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileUp, Loader2, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { acceptImportAction, deleteFrameworkAction, deleteStandardAction, discardAiDraftAction, extractDocumentTextAction, previewImportAction, saveFrameworkAction, saveStandardAction } from "@/server/curriculum/actions";
import type { DraftStandard } from "@/server/curriculum/parse";
import { SimpleSelect, useCurriculumError } from "./fields";

type FrameworkValue = { id?: string; nameEn: string; nameAr: string; subjectId: string; gradeLevel: number; sourceEn: string };

export function FrameworkDialog({ framework, subjects }: { framework?: FrameworkValue; subjects: Array<{ id: string; label: string }> }) {
  const t = useTranslations("curriculum");
  const err = useCurriculumError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState<FrameworkValue>(framework ?? { nameEn: "", nameAr: "", subjectId: "", gradeLevel: 9, sourceEn: "" });
  const save = () =>
    start(async () => {
      const res = await saveFrameworkAction(v);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("frameworks.saved"));
      setOpen(false);
      if (!framework) router.push(`/curriculum/frameworks/${res.id}`);
      else router.refresh();
    });
  return (
    <>
      {framework ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil className="size-4" />
          {t("edit")}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} data-testid="new-framework">
          <Plus className="size-4" />
          {t("frameworks.new")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{framework ? t("frameworks.editTitle") : t("frameworks.newTitle")}</DialogTitle>
            <DialogDescription>{t("frameworks.dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
              <div className="space-y-1.5">
                <Label>{t("frameworks.subject")}</Label>
                <SimpleSelect testId="framework-subject" options={subjects.map((s) => ({ value: s.id, label: s.label }))} value={v.subjectId} onChange={(subjectId) => setV({ ...v, subjectId })} placeholder={t("editor.chooseSubject")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fw-grade">{t("frameworks.grade")}</Label>
                <Input id="fw-grade" type="number" min={1} max={13} value={v.gradeLevel} onChange={(e) => setV({ ...v, gradeLevel: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fw-name-en">{t("frameworks.nameEn")}</Label>
              <Input id="fw-name-en" dir="ltr" value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} data-testid="framework-name-en" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fw-name-ar">{t("frameworks.nameAr")}</Label>
              <Input id="fw-name-ar" dir="rtl" value={v.nameAr} onChange={(e) => setV({ ...v, nameAr: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fw-source">{t("frameworks.source")}</Label>
              <Input id="fw-source" value={v.sourceEn} onChange={(e) => setV({ ...v, sourceEn: e.target.value })} placeholder={t("frameworks.sourceHint")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending} data-testid="framework-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteFrameworkButton({ id, inUse }: { id: string; inUse: boolean }) {
  const t = useTranslations("curriculum");
  const err = useCurriculumError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (inUse) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        {t("delete")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("frameworks.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("frameworks.deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteFrameworkAction(id);
                  if (!res.ok) return void toast.error(err(res.error));
                  router.push("/curriculum/frameworks");
                })
              }
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type StandardValue = DraftStandard & { id?: string };

export function StandardDialog({ frameworkId, standard, prefix }: { frameworkId: string; standard?: StandardValue; prefix: string }) {
  const t = useTranslations("curriculum");
  const err = useCurriculumError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState<StandardValue>(standard ?? { code: `${prefix}.`, strandEn: "", strandAr: "", descEn: "", descAr: "" });
  const save = () =>
    start(async () => {
      const res = await saveStandardAction({ ...v, frameworkId });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("frameworks.standardSaved"));
      setOpen(false);
      if (!standard) setV({ code: `${prefix}.`, strandEn: v.strandEn, strandAr: v.strandAr, descEn: "", descAr: "" });
      router.refresh();
    });
  return (
    <>
      {standard ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={t("edit")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="size-4" />
        </button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)} data-testid="add-standard">
          <Plus className="size-4" />
          {t("frameworks.addStandard")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{standard ? t("frameworks.editStandard") : t("frameworks.addStandard")}</DialogTitle>
            <DialogDescription>{t("frameworks.standardBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="std-code">{t("frameworks.code")}</Label>
              <Input id="std-code" dir="ltr" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} data-testid="standard-code" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="std-strand-en">{t("frameworks.strandEn")}</Label>
                <Input id="std-strand-en" dir="ltr" value={v.strandEn} onChange={(e) => setV({ ...v, strandEn: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="std-strand-ar">{t("frameworks.strandAr")}</Label>
                <Input id="std-strand-ar" dir="rtl" value={v.strandAr} onChange={(e) => setV({ ...v, strandAr: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="std-desc-en">{t("frameworks.descEn")}</Label>
              <Textarea id="std-desc-en" dir="ltr" rows={2} value={v.descEn} onChange={(e) => setV({ ...v, descEn: e.target.value })} data-testid="standard-desc-en" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="std-desc-ar">{t("frameworks.descAr")}</Label>
              <Textarea id="std-desc-ar" dir="rtl" rows={2} value={v.descAr} onChange={(e) => setV({ ...v, descAr: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending} data-testid="standard-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteStandardButton({ id }: { id: string }) {
  const t = useTranslations("curriculum");
  const err = useCurriculumError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={t("delete")}
      disabled={pending}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-danger"
      onClick={() =>
        start(async () => {
          const res = await deleteStandardAction(id);
          if (!res.ok) return void toast.error(err(res.error));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}

type Mode = "paste" | "csv" | "ai";
type Row = DraftStandard & { include: boolean };

/** Three ways in: paste a list, import a CSV, or let AI read a curriculum document. Nothing is saved until accepted. */
export function ImportStandardsDialog({ frameworkId, existingCodes }: { frameworkId: string; existingCodes: string[] }) {
  const t = useTranslations("curriculum.import");
  const tc = useTranslations("curriculum");
  const err = useCurriculumError();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [csvErrors, setCsvErrors] = useState<number[]>([]);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setRows(null);
    setCsvErrors([]);
    setInteractionId(null);
  };

  const readFile = (f: File) =>
    start(async () => {
      if (mode === "csv" || !f.name.toLowerCase().endsWith(".pdf")) {
        setText(await f.text());
        return;
      }
      const form = new FormData();
      form.append("file", f);
      const res = await extractDocumentTextAction(form);
      if (!res.ok) return void toast.error(err(res.error));
      setText(res.text);
    });

  const preview = () =>
    start(async () => {
      const res = await previewImportAction({ frameworkId, mode, text });
      if (!res.ok) return void toast.error(err(res.error));
      setRows(res.rows.map((r) => ({ ...r, include: true })));
      setCsvErrors(res.csvErrors.map((e) => e.line));
      setInteractionId(res.interactionId);
    });

  const accept = () =>
    start(async () => {
      if (!rows) return;
      const res = await acceptImportAction({ frameworkId, rows: rows.filter((r) => r.include).map(({ include: _i, ...r }) => r), interactionId });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved", { created: res.created, updated: res.updated }));
      setOpen(false);
      setText("");
      reset();
      router.refresh();
    });

  const discard = () =>
    start(async () => {
      if (interactionId) await discardAiDraftAction(interactionId);
      reset();
    });

  const setRow = (i: number, patch: Partial<Row>) => setRows((cur) => cur && cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const included = rows?.filter((r) => r.include).length ?? 0;

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="import-standards">
        <Upload className="size-4" />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{rows ? t("reviewTitle", { count: rows.length }) : t("title")}</DialogTitle>
            <DialogDescription>{rows ? t("reviewBody") : t("body")}</DialogDescription>
          </DialogHeader>
          {!rows ? (
            <div className="space-y-4">
              <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
                {(["paste", "csv", "ai"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} data-testid={`import-mode-${m}`} className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", mode === m ? "bg-card shadow-xs" : "text-muted-foreground")}>
                    {m === "ai" && <Sparkles className="size-3.5" />}
                    {t(`mode.${m}`)}
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{t(`hint.${mode}`)}</p>
              {mode !== "paste" && (
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed bg-muted/30 p-4 text-sm hover:bg-muted/50">
                  <FileUp className="size-5 text-muted-foreground" />
                  <span>{mode === "csv" ? t("chooseCsv") : t("chooseDocument")}</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={mode === "csv" ? ".csv,text/csv" : ".pdf,.txt,.md,text/plain,application/pdf"}
                    className="sr-only"
                    data-testid="import-file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) readFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={t(`placeholder.${mode}`)} dir="auto" className="font-mono text-xs" data-testid="import-text" />
            </div>
          ) : (
            <div className="space-y-3">
              {interactionId && <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs">{t("aiNotice")}</p>}
              {csvErrors.length > 0 && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{t("csvSkipped", { lines: csvErrors.join(", ") })}</p>}
              <div className="space-y-2" data-testid="import-preview">
                {rows.map((r, i) => (
                  <div key={i} className={cn("space-y-2 rounded-lg border p-3", !r.include && "opacity-50")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox checked={r.include} onCheckedChange={(v) => setRow(i, { include: v === true })} aria-label={t("include")} />
                      <Input dir="ltr" value={r.code} onChange={(e) => setRow(i, { code: e.target.value })} className="h-8 w-36 font-mono text-xs" aria-label={tc("frameworks.code")} />
                      <Input value={r.strandEn} onChange={(e) => setRow(i, { strandEn: e.target.value })} className="h-8 min-w-0 flex-1 text-xs" dir="ltr" aria-label={tc("frameworks.strandEn")} />
                      <Input value={r.strandAr} onChange={(e) => setRow(i, { strandAr: e.target.value })} className="h-8 min-w-0 flex-1 text-xs" dir="rtl" aria-label={tc("frameworks.strandAr")} />
                      {existingCodes.includes(r.code) && <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] text-info">{t("willUpdate")}</span>}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Textarea dir="ltr" rows={2} value={r.descEn} onChange={(e) => setRow(i, { descEn: e.target.value })} className="text-xs" aria-label={tc("frameworks.descEn")} />
                      <Textarea dir="rtl" rows={2} value={r.descAr} onChange={(e) => setRow(i, { descAr: e.target.value })} className={cn("text-xs", !r.descAr.trim() && "border-warning")} placeholder={t("needsArabic")} aria-label={tc("frameworks.descAr")} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            {!rows ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button onClick={preview} disabled={pending || !text.trim()} data-testid="import-preview-button">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : mode === "ai" ? <Sparkles className="size-4" /> : null}
                  {mode === "ai" ? t("readWithAi") : t("preview")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={discard} disabled={pending}>
                  {t("back")}
                </Button>
                <Button onClick={accept} disabled={pending || included === 0} data-testid="import-accept">
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("accept", { count: included })}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
