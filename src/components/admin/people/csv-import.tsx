"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import Papa from "papaparse";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MAX_IMPORT_ROWS, missingHeaders, normalizeRow, rowNumber, templateCsv, validateRows, type CsvRow, type RowError } from "@/lib/people-csv";
import { importStudentsAction } from "@/server/admin/people-actions";
import { usePeopleError } from "./staff-forms";

type Parsed = { fileName: string; raw: Array<Record<string, unknown>>; rows: CsvRow[] };
type Result = { total: number; succeeded: number; failed: number; created: number; updated: number };
const PREVIEW_LIMIT = 300;

function useRowError() {
  const t = useTranslations("adminPeople");
  return (e: { field: string; code: string }) => t(`rowError.${t.has(`rowError.${e.code}`) ? e.code : "failed"}`, { field: e.field });
}

/** Past import errors, collapsed by default. Only row numbers and field names are stored. */
export function ImportErrors({ errors }: { errors: Array<{ row: number; field: string; code: string }> }) {
  const t = useTranslations("adminPeople");
  const msg = useRowError();
  return (
    <details className="rounded-lg border bg-muted/20 text-xs">
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground hover:text-foreground">{t("showErrors", { count: errors.length })}</summary>
      <ul className="max-h-48 space-y-1 overflow-y-auto border-t px-3 py-2">
        {errors.map((e, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 font-medium tabular-nums">{t("rowN", { row: e.row })}</span>
            <span className="text-muted-foreground">{msg(e)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function CsvImporter() {
  const t = useTranslations("adminPeople");
  const err = usePeopleError();
  const msg = useRowError();
  const locale = useLocale();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [pending, start] = useTransition();

  const validation = useMemo(() => (parsed ? validateRows(parsed.rows) : null), [parsed]);
  const errorsByRow = useMemo(() => {
    const map = new Map<number, RowError[]>();
    for (const e of validation?.errors ?? []) map.set(e.row, [...(map.get(e.row) ?? []), e]);
    return map;
  }, [validation]);

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + templateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students-import-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const reset = () => {
    setParsed(null);
    setFileError(null);
    setResult(null);
    setOnlyErrors(false);
    if (input.current) input.current.value = "";
  };

  const onFile = (file: File | undefined) => {
    setResult(null);
    setFileError(null);
    setParsed(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setFileError(t("fileNotCsv"));
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (res) => {
        const missing = missingHeaders(res.meta.fields ?? []);
        if (missing.length) return setFileError(t("fileMissingHeaders", { headers: missing.join(", ") }));
        if (res.data.length === 0) return setFileError(t("fileEmpty"));
        if (res.data.length > MAX_IMPORT_ROWS) return setFileError(t("fileTooLarge", { max: MAX_IMPORT_ROWS }));
        setParsed({ fileName: file.name, raw: res.data, rows: res.data.map(normalizeRow) });
      },
      error: () => setFileError(t("fileUnreadable")),
    });
  };

  const runImport = () =>
    start(async () => {
      if (!parsed) return;
      const res = await importStudentsAction({ fileName: parsed.fileName, rows: parsed.raw });
      if (!res.ok) return void toast.error(err(res.error));
      setResult({ total: res.total, succeeded: res.succeeded, failed: res.failed, created: res.created, updated: res.updated });
      toast.success(t("importDone", { succeeded: res.succeeded, total: res.total }));
      router.refresh();
    });

  const validCount = validation?.valid.length ?? 0;
  const invalidCount = (validation?.total ?? 0) - validCount;
  const previewRows = (parsed?.rows ?? []).map((r, i) => ({ r, n: rowNumber(i) })).filter(({ n }) => !onlyErrors || errorsByRow.has(n));

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5" data-testid="csv-importer">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <FileSpreadsheet className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{t("importTitle")}</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{t("importBody", { max: MAX_IMPORT_ROWS })}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate} data-testid="download-template">
            <Download className="size-4" />
            {t("downloadTemplate")}
          </Button>
          <Button onClick={() => input.current?.click()} disabled={pending} data-testid="choose-csv">
            <FileUp className="size-4" />
            {parsed ? t("chooseAnother") : t("chooseCsv")}
          </Button>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} data-testid="csv-file" />
        </div>
      </div>

      {fileError && (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert data-testid="import-result">
          <CheckCircle2 className="size-4 text-success" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("importResult", { succeeded: result.succeeded, total: result.total, failed: result.failed, created: result.created, updated: result.updated })}</span>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" />
              {t("importAnother")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {parsed && validation && !result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium" dir="ltr">
              {parsed.fileName}
            </span>
            <span className="text-muted-foreground">{t("previewSummary", { total: validation.total, valid: validCount, invalid: invalidCount })}</span>
            {invalidCount > 0 && (
              <button type="button" onClick={() => setOnlyErrors((v) => !v)} className="text-xs font-medium text-brand hover:underline" data-testid="toggle-errors">
                {onlyErrors ? t("showAllRows") : t("showOnlyErrors")}
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-auto rounded-lg border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("colRow")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colStudentNo")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colName")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colGrade")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colGuardian")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colCheck")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {previewRows.slice(0, PREVIEW_LIMIT).map(({ r, n }) => {
                  const errs = errorsByRow.get(n);
                  return (
                    <tr key={n} className={cn(errs && "bg-danger-soft/40")} data-testid={errs ? "preview-row-invalid" : "preview-row-valid"}>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{n}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span dir="ltr">{r.student_no}</span>
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const en = [r.first_name_en, r.last_name_en].filter(Boolean).join(" ");
                          const ar = [r.first_name_ar, r.last_name_ar].filter(Boolean).join(" ");
                          const [main, other] = locale === "ar" && ar ? [ar, en] : [en, ar];
                          return (
                            <>
                              <div>{main}</div>
                              {other && <div className="text-xs text-muted-foreground">{other}</div>}
                            </>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        <span dir="ltr">{[r.grade, r.section].filter(Boolean).join(" ")}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div>{[r.guardian_first_name_en, r.guardian_last_name_en].filter(Boolean).join(" ")}</div>
                        {r.guardian_email && (
                          <div className="text-xs text-muted-foreground">
                            <span dir="ltr">{r.guardian_email}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {errs ? (
                          <ul className="space-y-0.5 text-xs text-danger">
                            {errs.map((e, i) => (
                              <li key={i}>{msg(e)}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                            <CheckCircle2 className="size-3.5" />
                            {t("rowReady")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {previewRows.length > PREVIEW_LIMIT && <p className="text-xs text-muted-foreground">{t("previewTruncated", { shown: PREVIEW_LIMIT, total: previewRows.length })}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="outline" onClick={reset} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={runImport} disabled={pending || validCount === 0} data-testid="run-import">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {invalidCount > 0 ? t("importValidOnly", { count: validCount }) : t("importAll", { count: validCount })}
            </Button>
          </div>
          {pending && <p className="text-xs text-muted-foreground">{t("importing")}</p>}
        </div>
      )}
    </section>
  );
}
