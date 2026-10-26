"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, FileArchive, Loader2, Play, Upload } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyRunAction, runProgressAction, startPreviewAction, uploadOneRosterAction } from "@/server/rostering/actions";

function useError() {
  const t = useTranslations("roster");
  return (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
}

export function PreviewButton({ connectionId, busy }: { connectionId: string; busy: boolean }) {
  const t = useTranslations("roster");
  const errorText = useError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={busy || pending}
      title={busy ? t("busy") : undefined}
      onClick={() =>
        start(async () => {
          const res = await startPreviewAction({ connectionId, mode: "FULL" });
          if (!res.ok) return void toast.error(errorText(res.error));
          router.push(`/admin/rostering/runs/${res.runId}`);
        })
      }
      data-testid="preview-connection"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
      {t("preview")}
    </Button>
  );
}

/** Live progress of a running preview or sync; refreshes the page when the run finishes. */
export function RunProgress({ runId, initial }: { runId: string; initial: { status: string; done: number; total: number; phase: string | null } }) {
  const t = useTranslations("roster");
  const router = useRouter();
  const [p, setP] = useState(initial);
  const finished = useRef(false);
  useEffect(() => {
    const timer = setInterval(async () => {
      const res = await runProgressAction(runId).catch(() => null);
      if (!res || !res.ok) return;
      setP({ status: res.status, done: res.done, total: res.total, phase: res.phase });
      if (!["QUEUED", "FETCHING", "PLANNING", "APPLYING"].includes(res.status) && !finished.current) {
        finished.current = true;
        clearInterval(timer);
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [runId, router]);
  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  return (
    <div className="space-y-2" role="status" aria-live="polite" data-testid="run-progress">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 className="size-4 animate-spin text-brand" />
          {t(`phase.${p.status === "FETCHING" ? "fetch" : (p.phase ?? "queued")}`)}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{pct !== null ? `${pct}%` : t("recordsRead", { count: p.done })}</span>
      </div>
      <Progress value={pct ?? undefined} className={pct === null ? "animate-pulse" : undefined} />
    </div>
  );
}

export function ApplyRunButton({ runId, blocked, removals }: { runId: string; blocked: boolean; removals: number }) {
  const t = useTranslations("roster");
  const errorText = useError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3">
      {blocked && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={confirm} onCheckedChange={(c) => setConfirm(c === true)} data-testid="confirm-removals" />
          <span>{t("confirmRemovals", { count: removals })}</span>
        </label>
      )}
      <Button
        disabled={pending || (blocked && !confirm)}
        onClick={() =>
          start(async () => {
            const res = await applyRunAction({ runId, allowMassDelete: blocked && confirm });
            if (!res.ok) return void toast.error(errorText(res.error));
            toast.success(t("applyStarted"));
            router.refresh();
          })
        }
        data-testid="apply-run"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 rtl:rotate-180" />}
        {blocked ? t("applyWithRemovals") : t("apply")}
      </Button>
    </div>
  );
}

export function CsvUploadForm({ connections }: { connections: Array<{ id: string; name: string }> }) {
  const t = useTranslations("roster");
  const errorText = useError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [conn, setConn] = useState<string>(connections[0]?.id ?? "none");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return;
        const fd = new FormData();
        fd.set("file", file);
        if (conn !== "none") fd.set("connectionId", conn);
        start(async () => {
          const res = await uploadOneRosterAction(fd);
          if (!res.ok) return void toast.error(errorText(res.error));
          router.push(`/admin/rostering/runs/${res.runId}`);
        });
      }}
      data-testid="csv-upload"
    >
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 text-sm transition hover:border-brand/50 hover:bg-muted/30">
        <FileArchive className="size-5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate">{file ? file.name : t("csvPick")}</span>
        <input type="file" accept=".zip,application/zip" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="csv-file" />
      </label>
      {connections.length > 0 && (
        <div className="space-y-1.5">
          <Label>{t("csvConnection")}</Label>
          <Select value={conn} onValueChange={setConn}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
              <SelectItem value="none">{t("csvNoConnection")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <Button type="submit" variant="outline" disabled={!file || pending} data-testid="csv-preview">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {t("csvPreview")}
      </Button>
    </form>
  );
}
