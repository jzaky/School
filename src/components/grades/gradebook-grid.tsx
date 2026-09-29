"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, Check, CloudOff, Eye, EyeOff, FileDown, Loader2, MoreVertical, Pencil, Send, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bandFor, mean, parsePasted, parseScore, percent, weightedAverage, type Band } from "@/server/grades/calc";
import { deleteAssessmentAction, generateReportCardAction, saveGradesAction, setPublishedAction } from "@/server/grades/actions";
import { AssessmentDialog, type AssessmentRow, type TermOption } from "./assessment-dialog";

export type GridStudent = { id: string; name: string; studentNo: string };
export type GridGrade = { assessmentId: string; studentId: string; score: number | null; excused: boolean; comment: string };

type Cell = { raw: string; score: number | null; excused: boolean; comment: string; invalid: boolean };
type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const key = (aid: string, sid: string) => `${aid}:${sid}`;
const EXCUSED_TOKENS = new Set(["x", "ex", "exc", "excused", "معفى", "م"]);

function fmtNum(n: number, locale: string, digits = 1) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { maximumFractionDigits: digits }).format(n);
}

export function GradebookGrid({
  classId,
  canEdit,
  locale,
  students,
  assessments,
  grades,
  bands,
  terms,
  defaultTermId,
  termId,
}: {
  classId: string;
  canEdit: boolean;
  locale: "en" | "ar";
  students: GridStudent[];
  assessments: AssessmentRow[];
  grades: GridGrade[];
  bands: Band[];
  terms: TermOption[];
  defaultTermId: string | null;
  termId: string | null;
}) {
  const t = useTranslations("grades");
  const router = useRouter();
  const rtl = locale === "ar";

  const initial = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const g of grades) m.set(key(g.assessmentId, g.studentId), { raw: g.score === null ? "" : String(g.score), score: g.score, excused: g.excused, comment: g.comment, invalid: false });
    return m;
  }, [grades]);
  const [cells, setCellsState] = useState<Map<string, Cell>>(initial);
  const cellsRef = useRef<Map<string, Cell>>(initial);
  const setCells = useCallback((next: Map<string, Cell>) => {
    cellsRef.current = next;
    setCellsState(next);
  }, []);
  const saved = useRef<Map<string, Cell>>(new Map(initial));
  const dirty = useRef<Set<string>>(new Set());
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [editing, setEditing] = useState<AssessmentRow | null>(null);
  const [confirm, setConfirm] = useState<{ a: AssessmentRow; publish: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AssessmentRow | null>(null);
  const [pending, start] = useTransition();
  const [reportFor, setReportFor] = useState<string | null>(null);

  useEffect(() => {
    // Fresh server data (after publish or a new assessment): keep any edits that are not saved yet.
    const next = new Map(initial);
    for (const k of dirty.current) {
      const c = cellsRef.current.get(k);
      if (c) next.set(k, c);
    }
    setCells(next);
    saved.current = new Map(initial);
  }, [initial, setCells]);

  const cellOf = useCallback((aid: string, sid: string): Cell => cells.get(key(aid, sid)) ?? { raw: "", score: null, excused: false, comment: "", invalid: false }, [cells]);

  // --- Autosave -------------------------------------------------------------------------------
  const flush = useCallback(async () => {
    if (inflight.current) return;
    const keys = [...dirty.current];
    if (!keys.length) return;
    inflight.current = true;
    dirty.current = new Set();
    setState("saving");
    const snapshot = cellsRef.current;
    const payload = keys
      .map((k) => {
        const [assessmentId, studentId] = k.split(":");
        const c = snapshot.get(k);
        if (!c || c.invalid) return null;
        return { assessmentId, studentId, score: c.score, excused: c.excused, comment: c.comment };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    try {
      const res = await saveGradesAction(classId, payload);
      if (!res.ok) throw new Error(res.error);
      const bad = new Set(res.rejected.map((r) => key(r.assessmentId, r.studentId)));
      setErrors((cur) => {
        const next = new Set(cur);
        for (const k of keys) next.delete(k);
        for (const k of bad) next.add(k);
        return next;
      });
      for (const p of payload) {
        const k = key(p.assessmentId, p.studentId);
        if (!bad.has(k)) saved.current.set(k, snapshot.get(k)!);
      }
      setState(bad.size ? "error" : dirty.current.size ? "pending" : "saved");
    } catch {
      for (const k of keys) dirty.current.add(k);
      setErrors((cur) => new Set([...cur, ...keys]));
      setState("error");
    } finally {
      inflight.current = false;
      if (dirty.current.size) schedule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState("pending");
    timer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current.size || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const update = useCallback(
    (changes: Array<{ aid: string; sid: string; patch: Partial<Cell> }>) => {
      if (!canEdit || !changes.length) return;
      const next = new Map(cellsRef.current);
      for (const ch of changes) {
        const k = key(ch.aid, ch.sid);
        const prev = next.get(k) ?? { raw: "", score: null, excused: false, comment: "", invalid: false };
        next.set(k, { ...prev, ...ch.patch });
      }
      setCells(next);
      let anyValid = false;
      for (const ch of changes) {
        const k = key(ch.aid, ch.sid);
        if (ch.patch.invalid) dirty.current.delete(k);
        else {
          dirty.current.add(k);
          anyValid = true;
        }
      }
      if (anyValid) schedule();
    },
    [canEdit, schedule, setCells],
  );

  const interpret = useCallback(
    (a: AssessmentRow, raw: string): Partial<Cell> => {
      const v = raw.trim().toLowerCase();
      if (EXCUSED_TOKENS.has(v)) return { raw: "", score: null, excused: true, invalid: false };
      const p = parseScore(raw);
      if (!p.ok || (p.value !== null && p.value > a.maxScore)) return { raw, invalid: true };
      return { raw, score: p.value, invalid: false, ...(p.value !== null ? { excused: false } : {}) };
    },
    [],
  );

  // --- Keyboard and paste --------------------------------------------------------------------
  const focusCell = useCallback(
    (r: number, c: number) => {
      const rr = Math.max(0, Math.min(students.length - 1, r));
      const cc = Math.max(0, Math.min(assessments.length - 1, c));
      const el = inputs.current.get(`${rr}:${cc}`);
      if (el) {
        el.focus();
        el.select();
      }
    },
    [students.length, assessments.length],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    const allSelected = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(e.shiftKey && e.key === "Enter" ? r - 1 : r + 1, c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(r - 1, c);
    } else if (e.key === fwd && (atEnd || allSelected)) {
      e.preventDefault();
      focusCell(r, c + 1);
    } else if (e.key === back && (atStart || allSelected)) {
      e.preventDefault();
      focusCell(r, c - 1);
    } else if (e.key === "Escape") {
      const a = assessments[c];
      const s = students[r];
      const prev = saved.current.get(key(a.id, s.id));
      update([{ aid: a.id, sid: s.id, patch: prev ?? { raw: "", score: null, excused: false, invalid: false } }]);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData("text/plain");
    const block = parsePasted(text);
    if (block.length <= 1 && (block[0]?.length ?? 0) <= 1) return; // a single value pastes normally
    e.preventDefault();
    const changes: Array<{ aid: string; sid: string; patch: Partial<Cell> }> = [];
    let rejected = 0;
    block.forEach((row, i) => {
      const s = students[r + i];
      if (!s) return;
      row.forEach((val, j) => {
        const a = assessments[c + j];
        if (!a) return;
        const patch = interpret(a, val);
        if (patch.invalid) rejected++;
        changes.push({ aid: a.id, sid: s.id, patch });
      });
    });
    update(changes);
    if (rejected) toast.error(t("pasteRejected", { count: rejected }));
    else toast.success(t("pasted", { count: changes.length }));
  };

  // --- Derived numbers ----------------------------------------------------------------------
  const studentAvg = (sid: string) =>
    weightedAverage(assessments.map((a) => {
      const c = cellOf(a.id, sid);
      return { score: c.invalid ? null : c.score, excused: c.excused, maxScore: a.maxScore, weight: a.weight };
    }));
  const colAvg = (a: AssessmentRow) =>
    mean(students.map((s) => {
      const c = cellOf(a.id, s.id);
      return c.excused || c.invalid ? null : percent(c.score, a.maxScore);
    }));
  const averages = students.map((s) => studentAvg(s.id));
  const classAvg = mean(averages);

  const activeInfo = active && students[active.r] && assessments[active.c] ? { s: students[active.r], a: assessments[active.c] } : null;
  const activeCell = activeInfo ? cellOf(activeInfo.a.id, activeInfo.s.id) : null;

  // --- Assessment actions --------------------------------------------------------------------
  const doPublish = () =>
    confirm &&
    start(async () => {
      if (dirty.current.size) await flush();
      const res = await setPublishedAction(confirm.a.id, confirm.publish);
      if (!res.ok) return void toast.error(t("error.generic"));
      toast.success(confirm.publish ? t("publishedToast", { count: res.notified }) : t("unpublishedToast"));
      setConfirm(null);
      router.refresh();
    });

  const doDelete = () =>
    confirmDelete &&
    start(async () => {
      const res = await deleteAssessmentAction(confirmDelete.id);
      if (!res.ok) return void toast.error(t(res.error === "publishedDelete" ? "error.publishedDelete" : "error.generic"));
      toast.success(t("deleted"));
      setConfirmDelete(null);
      router.refresh();
    });

  const reportCard = (sid: string) => {
    const tid = termId ?? defaultTermId;
    if (!tid) return;
    setReportFor(sid);
    start(async () => {
      const res = await generateReportCardAction(sid, tid);
      setReportFor(null);
      if (!res.ok) return void toast.error(t("error.generic"));
      window.open(`/api/documents/${res.documentId}/download?inline=1`, "_blank", "noopener");
      toast.success(t("reportReady"));
    });
  };

  const invalidCount = [...cells.values()].filter((c) => c.invalid).length;
  const status =
    invalidCount > 0 && state !== "saving" ? (
      <span className="inline-flex items-center gap-1.5 text-danger" data-testid="save-state" data-state="invalid">
        <AlertCircle className="size-3.5" />
        {t("invalidCells", { count: invalidCount })}
      </span>
    ) : state === "saving" ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="save-state" data-state="saving">
        <Loader2 className="size-3.5 animate-spin" />
        {t("saving")}
      </span>
    ) : state === "pending" ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="save-state" data-state="pending">
        <span className="size-2 rounded-full bg-warning" />
        {t("unsaved")}
      </span>
    ) : state === "error" ? (
      <span className="inline-flex items-center gap-2 text-danger" data-testid="save-state" data-state="error">
        <CloudOff className="size-3.5" />
        {t("saveError")}
        <Button size="sm" variant="outline" className="h-7" onClick={() => {
          for (const k of errors) if (!cells.get(k)?.invalid) dirty.current.add(k);
          void flush();
        }}>
          {t("retry")}
        </Button>
      </span>
    ) : state === "saved" ? (
      <span className="inline-flex items-center gap-1.5 text-success" data-testid="save-state" data-state="saved">
        <Check className="size-3.5" />
        {t("saved")}
      </span>
    ) : (
      <span className="text-muted-foreground" data-testid="save-state" data-state="idle">{canEdit ? t("autosaveHint") : t("viewOnly")}</span>
    );

  const termLabel = (id: string | null) => {
    const tt = terms.find((x) => x.id === id);
    return tt ? tt.label : "";
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-7 flex items-center">{status}</div>
        {canEdit && assessments.length > 0 && <p className="text-muted-foreground">{t("keyboardHint")}</p>}
      </div>

      <div className="relative max-w-full overflow-x-auto rounded-xl border bg-card shadow-xs" data-testid="gradebook">
        <table className="w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/40 align-bottom text-xs">
              <th scope="col" className="sticky start-0 z-20 min-w-32 sm:min-w-44 border-b border-e bg-muted px-3 py-2 text-start font-medium text-muted-foreground">
                {t("student")}
              </th>
              {assessments.map((a) => (
                <th key={a.id} scope="col" className="w-36 min-w-36 max-w-36 border-b border-e px-2 py-2 text-start font-normal" data-testid="assessment-col">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-xs font-medium text-foreground" title={locale === "ar" ? a.titleAr : a.titleEn}>
                        {locale === "ar" ? a.titleAr : a.titleEn}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {t(`kind.${a.kind}`)} · {t("outOf", { max: fmtNum(a.maxScore, locale) })} · {t("weightShort", { weight: fmtNum(a.weight, locale) })}
                      </div>
                      {a.dueLabel && <div className="text-[11px] text-muted-foreground">{a.dueLabel}</div>}
                      <div className="mt-1">
                        {a.publishedAt ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success">
                            <Eye className="size-3" />
                            {t("published")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            <EyeOff className="size-3" />
                            {t("draft")}
                          </span>
                        )}
                      </div>
                    </div>
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("assessmentMenu")} data-testid="assessment-menu">
                            <MoreVertical className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(a)}>
                            <Pencil className="size-4" />
                            {t("edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setConfirm({ a, publish: !a.publishedAt })} data-testid={a.publishedAt ? "unpublish" : "publish"}>
                            {a.publishedAt ? <EyeOff className="size-4" /> : <Send className="size-4" />}
                            {a.publishedAt ? t("unpublish") : t("publish")}
                          </DropdownMenuItem>
                          {!a.publishedAt && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(a)}>
                                <Trash2 className="size-4" />
                                {t("delete")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </th>
              ))}
              <th scope="col" className="min-w-20 border-b border-e bg-brand-soft/40 px-3 py-2 text-start text-xs font-medium">{t("average")}</th>
              <th scope="col" className="min-w-14 border-b bg-brand-soft/40 px-3 py-2 text-start text-xs font-medium">{t("band")}</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, r) => {
              const avg = averages[r];
              return (
                <tr key={s.id} className="group" data-testid="grade-row">
                  <th scope="row" className="sticky start-0 z-10 border-b border-e bg-card px-3 py-1.5 text-start font-normal">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="text-[11px] text-muted-foreground" dir="ltr">{s.studentNo}</div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground hover:opacity-100 disabled:opacity-30"
                            onClick={() => reportCard(s.id)}
                            disabled={pending || !(termId ?? defaultTermId)}
                            aria-label={t("reportCardFor", { name: s.name })}
                            data-testid="row-report-card"
                          >
                            {reportFor === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t("reportCardTip", { term: termLabel(termId ?? defaultTermId) })}</TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  {assessments.map((a, c) => {
                    const k = key(a.id, s.id);
                    const cell = cellOf(a.id, s.id);
                    const hasErr = cell.invalid || errors.has(k);
                    const isActive = active?.r === r && active?.c === c;
                    return (
                      <td key={a.id} className={cn("relative border-b border-e p-0", isActive && "bg-brand-soft/40")}>
                        <input
                          ref={(el) => {
                            if (el) inputs.current.set(`${r}:${c}`, el);
                            else inputs.current.delete(`${r}:${c}`);
                          }}
                          value={cell.excused ? t("excusedShort") : cell.raw}
                          readOnly={!canEdit || cell.excused}
                          inputMode="decimal"
                          dir="ltr"
                          aria-label={t("cellLabel", { student: s.name, assessment: locale === "ar" ? a.titleAr : a.titleEn })}
                          aria-invalid={hasErr || undefined}
                          title={cell.invalid ? t("error.range", { max: fmtNum(a.maxScore, locale) }) : errors.has(k) ? t("saveError") : undefined}
                          data-testid="grade-cell"
                          className={cn(
                            "h-9 w-full min-w-20 bg-transparent px-2 text-center tabular-nums outline-none focus:bg-background focus:ring-2 focus:ring-brand focus:ring-inset",
                            cell.excused && "text-xs font-medium text-muted-foreground",
                            hasErr && "bg-danger-soft text-danger ring-1 ring-danger ring-inset",
                            !canEdit && "cursor-default",
                          )}
                          onFocus={(e) => {
                            setActive({ r, c });
                            e.currentTarget.select();
                          }}
                          onChange={(e) => update([{ aid: a.id, sid: s.id, patch: interpret(a, e.target.value) }])}
                          onKeyDown={(e) => {
                            if (cell.excused && canEdit && (e.key === "Backspace" || e.key === "Delete")) {
                              e.preventDefault();
                              update([{ aid: a.id, sid: s.id, patch: { excused: false, raw: "", score: null, invalid: false } }]);
                              return;
                            }
                            onKeyDown(e, r, c);
                          }}
                          onPaste={(e) => canEdit && onPaste(e, r, c)}
                        />
                        {cell.comment && <span className="pointer-events-none absolute top-0.5 end-0.5 size-1.5 rounded-full bg-info" aria-hidden />}
                        {hasErr && <AlertCircle className="pointer-events-none absolute top-1 start-1 size-3 text-danger" aria-hidden />}
                      </td>
                    );
                  })}
                  <td className="border-b border-e bg-brand-soft/20 px-3 text-sm font-semibold tabular-nums" data-testid="row-average">
                    {avg === null ? <span className="text-muted-foreground">-</span> : `${fmtNum(avg, locale)}%`}
                  </td>
                  <td className="border-b bg-brand-soft/20 px-3 text-sm font-semibold" data-testid="row-band" dir="ltr">{bandFor(avg, bands) ?? <span className="text-muted-foreground">-</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 text-xs">
              <th scope="row" className="sticky start-0 z-10 border-e bg-muted px-3 py-2 text-start font-medium">{t("classAverage")}</th>
              {assessments.map((a) => {
                const v = colAvg(a);
                return (
                  <td key={a.id} className="border-e px-2 py-2 text-center font-medium tabular-nums">
                    {v === null ? "-" : `${fmtNum(v, locale)}%`}
                  </td>
                );
              })}
              <td className="border-e px-3 py-2 font-semibold tabular-nums" data-testid="class-average">{classAvg === null ? "-" : `${fmtNum(classAvg, locale)}%`}</td>
              <td className="px-3 py-2 font-semibold" dir="ltr">{bandFor(classAvg, bands) ?? "-"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {canEdit && (
        <div className="rounded-xl border bg-card p-4 shadow-xs" data-testid="cell-panel">
          {activeInfo && activeCell ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-3">
                <div>
                  <div className="truncate text-sm font-medium">{activeInfo.s.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{locale === "ar" ? activeInfo.a.titleAr : activeInfo.a.titleEn}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="cell-excused"
                    checked={activeCell.excused}
                    onCheckedChange={(v) => update([{ aid: activeInfo.a.id, sid: activeInfo.s.id, patch: v ? { excused: true, score: null, raw: "", invalid: false } : { excused: false } }])}
                    data-testid="cell-excused"
                  />
                  <Label htmlFor="cell-excused">{t("excused")}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{t("excusedHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cell-comment">{t("comment")}</Label>
                <Textarea
                  id="cell-comment"
                  rows={2}
                  maxLength={500}
                  value={activeCell.comment}
                  placeholder={t("commentPlaceholder")}
                  onChange={(e) => update([{ aid: activeInfo.a.id, sid: activeInfo.s.id, patch: { comment: e.target.value } }])}
                  data-testid="cell-comment"
                />
                <p className="text-xs text-muted-foreground">{t("commentHint")}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("selectCellHint")}</p>
          )}
        </div>
      )}

      {editing && (
        <AssessmentDialog open onOpenChange={(o) => !o && setEditing(null)} classId={classId} terms={terms} defaultTermId={defaultTermId} assessment={editing} />
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.publish ? t("publishTitle") : t("unpublishTitle")}</DialogTitle>
            <DialogDescription>{confirm?.publish ? t("publishBody", { count: students.length }) : t("unpublishBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={doPublish} disabled={pending} data-testid="confirm-publish">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {confirm?.publish ? t("publish") : t("unpublish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={doDelete} disabled={pending}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
