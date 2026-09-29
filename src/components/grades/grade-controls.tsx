"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileDown, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { generateReportCardAction, resetBandsAction, saveBandsAction } from "@/server/grades/actions";

/** Class picker that keeps the rest of the query string (term, view). */
export function ClassPicker({ value, groups }: { value: string; groups: Array<{ label: string; options: Array<{ value: string; label: string }> }> }) {
  const t = useTranslations("grades");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Select
        value={value}
        onValueChange={(v) => {
          const next = new URLSearchParams(sp.toString());
          next.set("class", v);
          start(() => router.push(`${pathname}?${next.toString()}`));
        }}
      >
        <SelectTrigger className="w-full sm:w-80" aria-label={t("pickClass")} data-testid="class-picker">
          <SelectValue placeholder={t("pickClass")} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((g) => (
            <SelectGroup key={g.label}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** Family and staff button: build the term report card and open it. */
export function ReportCardButton({ studentId, termId, available, termLabel }: { studentId: string; termId: string | null; available: boolean; termLabel: string }) {
  const t = useTranslations("grades");
  const [pending, start] = useTransition();
  const run = () =>
    termId &&
    start(async () => {
      const res = await generateReportCardAction(studentId, termId);
      if (!res.ok) return void toast.error(t("error.generic"));
      toast.success(t("reportReady"));
      window.open(`/api/documents/${res.documentId}/download?inline=1`, "_blank", "noopener");
    });
  if (!available || !termId) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button variant="outline" disabled>
              <FileDown className="size-4" />
              {t("reportCard")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("reportCardUnavailable", { term: termLabel })}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button variant="outline" onClick={run} disabled={pending} data-testid="report-card">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {t("reportCard")}
    </Button>
  );
}

type BandRow = { label: string; minPercent: string };

export function BandSettings({ bands, custom, canEdit }: { bands: Array<{ label: string; minPercent: number }>; custom: boolean; canEdit: boolean }) {
  const t = useTranslations("grades");
  const router = useRouter();
  const [rows, setRows] = useState<BandRow[]>(bands.map((b) => ({ label: b.label, minPercent: String(b.minPercent) })));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveBandsAction(rows.map((r) => ({ label: r.label, minPercent: Number(r.minPercent) })));
      if (!res.ok) return setError(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
      toast.success(t("bandsSaved"));
      router.refresh();
    });
  const reset = () =>
    start(async () => {
      const res = await resetBandsAction();
      if (!res.ok) return void toast.error(t("error.generic"));
      setRows([
        { label: "A*", minPercent: "90" },
        { label: "A", minPercent: "80" },
        { label: "B", minPercent: "70" },
        { label: "C", minPercent: "60" },
        { label: "D", minPercent: "50" },
        { label: "E", minPercent: "40" },
        { label: "U", minPercent: "0" },
      ]);
      toast.success(t("bandsReset"));
      router.refresh();
    });

  if (!canEdit) {
    return (
      <div className="space-y-4" data-testid="band-settings">
        <ul className="divide-y rounded-lg border">
          {bands.map((b) => (
            <li key={b.label} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-semibold">{b.label}</span>
              <span className="tabular-nums text-muted-foreground" dir="ltr">
                {b.minPercent}%+
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("bandsReadOnly")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="band-settings">
      <p className="text-sm text-muted-foreground">{custom ? t("bandsCustom") : t("bandsDefault")}</p>
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>{t("bandLabel")}</span>
          <span>{t("bandMin")}</span>
          <span />
        </div>
        <ul className="divide-y">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-2 px-3 py-2">
              <Input value={r.label} maxLength={8} dir="ltr" disabled={!canEdit} aria-label={t("bandLabel")} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} data-testid="band-label" />
              <div className="flex items-center gap-1">
                <Input type="number" min={0} max={100} step="any" dir="ltr" value={r.minPercent} disabled={!canEdit} aria-label={t("bandMin")} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, minPercent: e.target.value } : x)))} data-testid="band-min" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              {canEdit ? (
                <Button variant="ghost" size="icon" aria-label={t("removeBand")} onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length <= 2}>
                  <Trash2 className="size-4" />
                </Button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRows([...rows, { label: "", minPercent: "" }])} disabled={rows.length >= 15}>
            <Plus className="size-4" />
            {t("addBand")}
          </Button>
          <Button onClick={save} disabled={pending} data-testid="save-bands">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("saveBands")}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={pending}>
            <RotateCcw className="size-4" />
            {t("resetBands")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("bandsReadOnly")}</p>
      )}
    </div>
  );
}
