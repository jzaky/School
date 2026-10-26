"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Format = "xlsx" | "csv" | "pdf";

/**
 * Export buttons. With open problems (or a choice about Emirates ID numbers) a dialog comes first; the file then
 * downloads from /api/government/export, which logs the version and checksum and writes the audit event.
 */
export function ExportMenu({ returnId, problems, canPrepare, canIds, idsPossible }: { returnId: string; problems: number; canPrepare: boolean; canIds: boolean; idsPossible: boolean }) {
  const t = useTranslations("govReports");
  const router = useRouter();
  const [pending, setPending] = useState<{ format: Format; lang?: "en" | "ar" } | null>(null);
  const [withIds, setWithIds] = useState(false);

  const download = (format: Format, lang?: "en" | "ar", ids = false) => {
    const q = new URLSearchParams({ return: returnId, format });
    if (lang) q.set("lang", lang);
    if (ids) q.set("ids", "1");
    const a = document.createElement("a");
    a.href = `/api/government/export?${q.toString()}`;
    if (format === "pdf") a.target = "_blank";
    else a.download = "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(t("export.started"));
    // The new file appears in the log once the server has generated it.
    setTimeout(() => router.refresh(), 1500);
  };

  const ask = (format: Format, lang?: "en" | "ar") => {
    const idChoice = idsPossible && canIds && format !== "pdf";
    if (problems > 0 || idChoice) {
      setWithIds(false);
      setPending({ format, lang });
    } else download(format, lang);
  };

  return (
    <>
      {canPrepare && (
        <>
          <Button variant="outline" onClick={() => ask("xlsx")} data-testid="gov-export-xlsx">
            <FileSpreadsheet className="size-4" />
            {t("export.excel")}
          </Button>
          <Button variant="outline" onClick={() => ask("csv")} title={t("export.csvHint")} data-testid="gov-export-csv">
            <Table2 className="size-4" />
            {t("export.csv")}
          </Button>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" data-testid="gov-export-pdf">
            <FileText className="size-4" />
            {t("export.pdf")}
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => ask("pdf", "en")} data-testid="gov-export-pdf-en">
            {t("export.pdfEn")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => ask("pdf", "ar")} data-testid="gov-export-pdf-ar">
            {t("export.pdfAr")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent data-testid="gov-export-dialog">
          <DialogHeader>
            <DialogTitle>{problems > 0 ? t("export.warnTitle") : t("export.withIds")}</DialogTitle>
            <DialogDescription className="sr-only">{t("export.menu")}</DialogDescription>
          </DialogHeader>
          {problems > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm" data-testid="gov-export-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>{t("export.warnBody", { n: problems })}</span>
            </div>
          )}
          {pending && pending.format !== "pdf" && idsPossible && canIds && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={withIds} onCheckedChange={(v) => setWithIds(v === true)} className="mt-0.5" data-testid="gov-export-ids" />
              <span>
                <span className="block font-medium">{t("export.withIds")}</span>
                <span className="block text-xs text-muted-foreground">{t("export.withIdsHelp")}</span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("export.cancel")}
            </Button>
            <Button
              onClick={() => {
                const p = pending!;
                setPending(null);
                download(p.format, p.lang, withIds);
              }}
              data-testid="gov-export-go"
            >
              {problems > 0 ? t("export.continue") : t("export.menu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
