"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileUp, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Pill } from "@/components/app/badges";
import { previewImportAction, runImportAction } from "@/server/imports/actions";
import type { ImportKind, ImportPreview, ImportSummary, RowIssue } from "@/lib/imports/types";
import type { SheetRecord } from "@/lib/imports/table";

export type ColumnInfo = { key: string; en: string; ar: string; required?: boolean };

const PREVIEW_COLUMNS: Record<ImportKind, string[]> = {
  staff: ["name", "email", "roles", "department", "subjects"],
  students: ["studentNo", "name", "grade", "guardian"],
  classes: ["class", "subject", "grade", "teacher", "room", "newStudents"],
  enrollments: ["class", "studentNo"],
  registrations: ["studentNo", "name", "grade", "options"],
};
const PREVIEW_LIMIT = 300;

/** Translates a row issue: "Roles: role not found (items 2, 3)". Never shows the cell's value. */
export function useIssueText() {
  const t = useTranslations("imports");
  return (e: RowIssue, warning = false) => {
    const field = t.has(`field.${e.field}`) ? t(`field.${e.field}`) : e.field;
    const base = warning ? `warn.${e.code}` : `error.${e.code}`;
    const text = t.has(base) ? t(base) : t("error.failed");
    const items = e.items?.length ? ` ${t("atItems", { items: e.items.join(", ") })}` : "";
    return `${field}: ${text}${items}`;
  };
}

export function ImportStep({
  kind,
  template,
  templateName,
  columns,
  disabledReason,
  invite,
  hint,
}: {
  kind: ImportKind;
  template: string;
  templateName: string;
  columns: ColumnInfo[];
  disabledReason?: string | null;
  invite?: { allowed: boolean; reason: string | null };
  hint?: string;
}) {
  const t = useTranslations("imports");
  const locale = useLocale();
  const issue = useIssueText();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; records: SheetRecord[]; preview: ImportPreview } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [sendInvites, setSendInvites] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState<"check" | "import" | null>(null);

  const failText = (error: string, missing?: string[]) => {
    if (error === "MISSING_COLUMNS" && missing) {
      const names = missing.map((k) => {
        const c = columns.find((x) => x.key === k);
        return c ? (locale === "ar" ? c.ar : c.en) : k;
      });
      return t("failure.MISSING_COLUMNS", { columns: names.join(locale === "ar" ? "، " : ", ") });
    }
    return t.has(`failure.${error}`) ? t(`failure.${error}`) : t("failure.generic");
  };

  const reset = () => {
    setFile(null);
    setFileError(null);
    setResult(null);
    setOnlyErrors(false);
    if (input.current) input.current.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + template], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = (f: File | undefined) => {
    reset();
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) return setFileError(t(/\.xls$/i.test(f.name) ? "failure.XLS_OLD" : "failure.TYPE"));
    setPhase("check");
    start(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", f);
      const res = await previewImportAction(fd);
      setPhase(null);
      if (!res.ok) return setFileError(failText(res.error, res.missing));
      setFile({ name: res.fileName, records: res.records, preview: res.preview });
    });
  };

  const runImport = () => {
    if (!file) return;
    setPhase("import");
    start(async () => {
      const res = await runImportAction({ kind, fileName: file.name, records: file.records, invite: sendInvites });
      setPhase(null);
      if (!res.ok) return void toast.error(failText(res.error));
      setResult(res.summary);
      toast.success(t("result.toast", { succeeded: res.summary.succeeded, total: res.summary.total }));
      router.refresh();
    });
  };

  const p = file?.preview;
  const rows = (p?.rows ?? []).filter((r) => !onlyErrors || r.errors.length > 0);
  const cols = PREVIEW_COLUMNS[kind];

  return (
    <div className="space-y-4" data-testid={`import-${kind}`}>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={downloadTemplate} data-testid={`template-${kind}`}>
          <Download className="size-4" />
          {t("downloadTemplate")}
        </Button>
        {disabledReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button disabled>
                  <FileUp className="size-4" />
                  {t("upload")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{disabledReason}</TooltipContent>
          </Tooltip>
        ) : (
          <Button onClick={() => input.current?.click()} disabled={pending} data-testid={`upload-${kind}`}>
            {phase === "check" ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {file ? t("chooseAnother") : t("upload")}
          </Button>
        )}
        <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} data-testid={`file-${kind}`} />
        <Button variant="ghost" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns}>
          <ChevronDown className={cn("size-4 transition-transform", showColumns && "rotate-180")} />
          {t("columns")}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}

      {showColumns && (
        <ul className="grid gap-1.5 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-2">
          {columns.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{locale === "ar" ? c.ar : c.en}</span>
              <span className="text-muted-foreground">{locale === "ar" ? c.en : c.ar}</span>
              {c.required && <Pill tone="brand">{t("required")}</Pill>}
            </li>
          ))}
        </ul>
      )}

      {fileError && (
        <Alert variant="destructive" data-testid="import-file-error">
          <XCircle className="size-4" />
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      )}

      {phase === "check" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("checking")}
        </p>
      )}

      {result && (
        <Alert data-testid="import-result">
          <CheckCircle2 className="size-4 text-success" />
          <AlertDescription className="space-y-2">
            <p className="font-medium text-foreground">{t("result.title")}</p>
            <p>{t("result.line", { succeeded: result.succeeded, total: result.total, created: result.created, updated: result.updated, unchanged: result.unchanged })}</p>
            {result.failed > 0 && <p className="text-danger">{t("result.failed", { failed: result.failed })}</p>}
            {Object.entries(result.extra).filter(([, n]) => n > 0).length > 0 && (
              <ul className="list-disc space-y-0.5 ps-5">
                {Object.entries(result.extra)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => (
                    <li key={k}>{t.has(`extra.${k}`) ? t(`extra.${k}`, { count: n }) : `${k}: ${n}`}</li>
                  ))}
              </ul>
            )}
            {result.errors.length > 0 && <IssueList issues={result.errors} />}
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" />
              {t("importAnother")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {file && p && !result && (
        <div className="space-y-3" data-testid="import-preview">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium" dir="ltr">
              {file.name}
            </span>
            <span className="text-muted-foreground">{t("preview.summary", { total: p.total, valid: p.valid, invalid: p.invalid })}</span>
            <span className="text-muted-foreground">{t("preview.counts", p.counts)}</span>
            {p.invalid > 0 && (
              <button type="button" onClick={() => setOnlyErrors((v) => !v)} className="text-xs font-medium text-brand hover:underline" data-testid="toggle-errors">
                {onlyErrors ? t("preview.showAll") : t("preview.showErrors")}
              </button>
            )}
          </div>
          {p.unknownHeaders.length > 0 && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertDescription>{t("preview.unknownColumns", { columns: p.unknownHeaders.join(", ") })}</AlertDescription>
            </Alert>
          )}
          <div className="max-h-[440px] overflow-auto rounded-lg border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-10 bg-muted/90 text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("preview.row")}</th>
                  {cols.map((c) => (
                    <th key={c} className="px-3 py-2 text-start font-medium">
                      {t(`preview.col.${c}`)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-start font-medium">{t("preview.check")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, PREVIEW_LIMIT).map((r) => (
                  <tr key={r.row} className={cn("align-top", r.errors.length > 0 && "bg-danger-soft/40")} data-testid={r.errors.length ? "preview-row-invalid" : "preview-row-valid"}>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="px-3 py-2">
                        {c.text && (
                          <div className="break-words" dir={c.ltr ? "ltr" : undefined}>
                            {c.text}
                          </div>
                        )}
                        {c.chips && c.chips.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {c.chips.map((chip, j) => (
                              <span key={j} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                {chip === "homeroom" ? t("homeroom") : chip}
                              </span>
                            ))}
                          </div>
                        )}
                        {c.sub && (
                          <div className="text-xs text-muted-foreground" dir="auto">
                            {c.sub}
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="min-w-[200px] px-3 py-2">
                      {r.errors.length > 0 ? (
                        <ul className="space-y-0.5 text-xs text-danger">
                          {r.errors.map((e, i) => (
                            <li key={i}>{issue(e)}</li>
                          ))}
                        </ul>
                      ) : r.action ? (
                        <div className="space-y-1">
                          <Pill tone={r.action === "create" ? "success" : r.action === "update" ? "info" : "neutral"} dot>
                            {t(`action.${r.action}`)}
                          </Pill>
                          {r.changes && r.changes.length > 0 && <div className="text-xs text-muted-foreground">{t("preview.changes", { list: r.changes.map((c) => t(`changes.${c}`)).join(locale === "ar" ? "، " : ", ") })}</div>}
                        </div>
                      ) : null}
                      {r.warnings.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-[oklch(0.55_0.14_65)]">
                          {r.warnings.map((w, i) => (
                            <li key={i}>{issue(w, true)}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_LIMIT && <p className="text-xs text-muted-foreground">{t("preview.truncated", { shown: PREVIEW_LIMIT, total: rows.length })}</p>}
          {invite && (
            <div className="flex items-start gap-2">
              {invite.allowed ? (
                <>
                  <Checkbox id={`invite-${kind}`} checked={sendInvites} onCheckedChange={(v) => setSendInvites(v === true)} data-testid="send-invites" />
                  <Label htmlFor={`invite-${kind}`} className="text-sm font-normal leading-snug">
                    {t("invite.label")}
                  </Label>
                </>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="flex items-start gap-2">
                      <Checkbox id={`invite-${kind}`} checked={false} disabled />
                      <span className="text-sm text-muted-foreground">{t("invite.label")}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{invite.reason}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="outline" onClick={reset} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={runImport} disabled={pending || p.valid === 0} data-testid={`confirm-${kind}`}>
              {phase === "import" && <Loader2 className="size-4 animate-spin" />}
              {p.invalid > 0 ? t("importValid", { count: p.valid }) : t("importAll", { count: p.valid })}
            </Button>
          </div>
          {phase === "import" && <p className="text-xs text-muted-foreground">{t("importing")}</p>}
        </div>
      )}
    </div>
  );
}

export function IssueList({ issues }: { issues: RowIssue[] }) {
  const t = useTranslations("imports");
  const issue = useIssueText();
  return (
    <details className="rounded-lg border bg-muted/20 text-xs">
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground hover:text-foreground">{t("history.showErrors", { count: issues.length })}</summary>
      <ul className="max-h-48 space-y-1 overflow-y-auto border-t px-3 py-2">
        {issues.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 font-medium tabular-nums">{t("history.rowN", { row: e.row })}</span>
            <span className="text-muted-foreground">{issue(e)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
