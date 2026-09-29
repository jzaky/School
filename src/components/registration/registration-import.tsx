"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import Papa from "papaparse";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MAX_REG_IMPORT_ROWS, hasStudentNoHeader } from "@/lib/registration-csv";
import { importRegistrationsAction, previewImportAction } from "@/server/registration/actions";
import type { Preview } from "@/server/registration/import";
import { useRegError } from "./admin-controls";

type Parsed = { fileName: string; raw: Array<Record<string, unknown>> };
type Result = { total: number; succeeded: number; failed: number; placed: number; sections: number };
const PREVIEW_LIMIT = 300;

export function useRowError() {
  const t = useTranslations("registration");
  return (e: { field: string; code: string }) => t(`rowError.${t.has(`rowError.${e.code}`) ? e.code : "failed"}`, { field: e.field });
}

export function RegistrationImporter({ template }: { template: string }) {
  const t = useTranslations("registration");
  const err = useRegError();
  const msg = useRowError();
  const locale = useLocale();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [pending, start] = useTransition();

  const downloadTemplate = () => {
    const blob = new Blob(["﻿" + template], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subject-registration-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const reset = () => {
    setParsed(null);
    setPreview(null);
    setFileError(null);
    setResult(null);
    setOnlyErrors(false);
    if (input.current) input.current.value = "";
  };

  const onFile = (file: File | undefined) => {
    reset();
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setFileError(t("fileNotCsv"));
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (res) => {
        if (!hasStudentNoHeader(res.meta.fields ?? [])) return setFileError(t("fileMissingStudentNo"));
        if (res.data.length === 0) return setFileError(t("fileEmpty"));
        if (res.data.length > MAX_REG_IMPORT_ROWS) return setFileError(t("fileTooLarge", { max: MAX_REG_IMPORT_ROWS }));
        const p = { fileName: file.name, raw: res.data };
        setParsed(p);
        start(async () => {
          const r = await previewImportAction({ rows: p.raw });
          if (!r.ok) return setFileError(err(r.error));
          setPreview(r.preview);
        });
      },
      error: () => setFileError(t("fileUnreadable")),
    });
  };

  const runImport = () =>
    start(async () => {
      if (!parsed) return;
      const res = await importRegistrationsAction({ fileName: parsed.fileName, rows: parsed.raw });
      if (!res.ok) return void toast.error(err(res.error));
      setResult({ total: res.total, succeeded: res.succeeded, failed: res.failed, placed: res.allocation.placed + res.allocation.moved, sections: res.allocation.sectionsCreated });
      toast.success(t("importDone", { succeeded: res.succeeded, total: res.total }));
      router.refresh();
    });

  const rows = (preview?.rows ?? []).filter((r) => !onlyErrors || r.errors.length > 0);
  const invalid = preview ? preview.total - preview.valid : 0;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5" data-testid="registration-importer">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <FileSpreadsheet className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{t("importTitle")}</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{t("importBody")}</p>
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

      {parsed && !preview && !fileError && pending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("checking")}
        </p>
      )}

      {result && (
        <Alert data-testid="import-result">
          <CheckCircle2 className="size-4 text-success" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("importResult", result)}</span>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" />
              {t("importAnother")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {parsed && preview && !result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium" dir="ltr">
              {parsed.fileName}
            </span>
            <span className="text-muted-foreground">{t("previewSummary", { total: preview.total, valid: preview.valid, invalid })}</span>
            {invalid > 0 && (
              <button type="button" onClick={() => setOnlyErrors((v) => !v)} className="text-xs font-medium text-brand hover:underline" data-testid="toggle-errors">
                {onlyErrors ? t("showAllRows") : t("showOnlyErrors")}
              </button>
            )}
          </div>
          {preview.unknownHeaders.length > 0 && (
            <Alert>
              <AlertDescription>{t("unknownColumns", { columns: preview.unknownHeaders.join(", ") })}</AlertDescription>
            </Alert>
          )}
          <div className="max-h-[420px] overflow-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("colRow")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colStudent")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colGrade")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colOptions")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("colCheck")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.slice(0, PREVIEW_LIMIT).map((r) => (
                  <tr key={r.row} className={cn(r.errors.length > 0 && "bg-danger-soft/40")} data-testid={r.errors.length ? "preview-row-invalid" : "preview-row-valid"}>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                    <td className="px-3 py-2">
                      <div>{r.name ? (locale === "ar" ? r.name.ar : r.name.en) : "-"}</div>
                      <div className="text-xs text-muted-foreground">
                        <span dir="ltr">{r.studentNo}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.grade ?? "-"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.options.map((o) => (
                          <span key={o.subjectId} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {o.block}: {locale === "ar" ? o.nameAr : o.nameEn}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {r.errors.length ? (
                        <ul className="space-y-0.5 text-xs text-danger">
                          {r.errors.map((e, i) => (
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
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_LIMIT && <p className="text-xs text-muted-foreground">{t("previewTruncated", { shown: PREVIEW_LIMIT, total: rows.length })}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="outline" onClick={reset} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={runImport} disabled={pending || preview.valid === 0} data-testid="run-import">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {invalid > 0 ? t("importValidOnly", { count: preview.valid }) : t("importAll", { count: preview.valid })}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ImportErrorList({ errors }: { errors: Array<{ row: number; field: string; code: string }> }) {
  const t = useTranslations("registration");
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
