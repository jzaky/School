"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Play, Plus, ScanSearch, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { normHeader } from "@/lib/imports/headers";
import { cleanMapping, missingAfterMapping, type ColumnMapping } from "@/lib/integrations/mapping";
import { SYNC_COLUMNS, SYNC_KINDS, type SyncKind } from "@/lib/integrations/kinds";
import { deleteSyncSourceAction, previewHeadersAction, runSyncNowAction, saveSyncSourceAction } from "@/server/integrations/actions";

export type SourceValue = {
  id: string;
  name: string;
  kind: SyncKind;
  url: string;
  authType: "NONE" | "BASIC" | "BEARER";
  hasSecret: boolean;
  mapping: ColumnMapping;
  schedule: "HOURLY" | "DAILY";
  hour: number;
  enabled: boolean;
};

const AUTO = "__auto";
const IGNORE = "__ignore";

function useError() {
  const t = useTranslations("integrations");
  return (code: string) => (t.has(`error.${code}`) ? t(`error.${code}`) : t.has(`runError.${code}`) ? t(`runError.${code}`) : t("error.generic"));
}

export function SourceDialogButton({ source, disabledReason }: { source?: SourceValue; disabledReason?: string | null }) {
  const t = useTranslations("integrations");
  const [open, setOpen] = useState(false);
  const button = source ? (
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="edit-source">
      <Pencil className="size-4" />
      {t("sync.edit")}
    </Button>
  ) : (
    <Button onClick={() => setOpen(true)} disabled={!!disabledReason} data-testid="add-source">
      <Plus className="size-4" />
      {t("sync.add")}
    </Button>
  );
  return (
    <>
      {disabledReason && !source ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">{open && <SourceForm source={source} onDone={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}

function SourceForm({ source, onDone }: { source?: SourceValue; onDone: () => void }) {
  const t = useTranslations("integrations");
  const locale = useLocale();
  const err = useError();
  const router = useRouter();
  const [name, setName] = useState(source?.name ?? "");
  const [kind, setKind] = useState<SyncKind>(source?.kind ?? "students");
  const [url, setUrl] = useState(source?.url ?? "");
  const [authType, setAuthType] = useState<SourceValue["authType"]>(source?.authType ?? "NONE");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [schedule, setSchedule] = useState<SourceValue["schedule"]>(source?.schedule ?? "DAILY");
  const [hour, setHour] = useState(String(source?.hour ?? 2));
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [mapping, setMapping] = useState<ColumnMapping>(source?.mapping ?? {});
  const [headers, setHeaders] = useState<Array<{ header: string; key: string | null }> | null>(null);
  const [pending, start] = useTransition();
  const [reading, startRead] = useTransition();

  const columns = SYNC_COLUMNS[kind];
  const label = (key: string) => {
    const c = columns.find((x) => x.key === key);
    return c ? (locale === "ar" ? c.ar : c.en) : key;
  };
  const keepSecret = !!source?.hasSecret && source.authType === authType;
  const credentialsReady = authType === "NONE" || keepSecret || (authType === "BASIC" ? !!username && !!password : !!token);
  const valid = name.trim().length > 0 && url.trim().length > 0 && credentialsReady;

  // Rows of the mapping editor: headers read from the file, plus saved entries the file did not show.
  const rows = useMemo(() => {
    const out: Array<{ header: string; norm: string; suggested: string | null }> = [];
    const seen = new Set<string>();
    for (const h of headers ?? []) {
      const norm = normHeader(h.header);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push({ header: h.header, norm, suggested: h.key });
    }
    for (const norm of Object.keys(mapping)) if (!seen.has(norm)) out.push({ header: norm, norm, suggested: null });
    return out;
  }, [headers, mapping]);
  const missing = headers ? missingAfterMapping(headers.map((h) => h.header), cleanMapping(mapping, columns), columns) : [];

  const creds = () => ({ authType, username: username || undefined, password: password || undefined, token: token || undefined });
  const readHeaders = () =>
    startRead(async () => {
      const res = await previewHeadersAction({ id: source?.id, kind, url, mapping, ...creds() });
      if (!res.ok) return void toast.error(err(res.error));
      setHeaders(res.headers);
    });
  const save = () =>
    start(async () => {
      const res = await saveSyncSourceAction({ id: source?.id, name, kind, url, mapping, schedule, hour: Number(hour), enabled, ...creds() });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("sync.saved"));
      onDone();
      router.refresh();
    });
  const setRow = (norm: string, value: string) =>
    setMapping((m) => {
      const next = { ...m };
      if (value === AUTO) delete next[norm];
      else next[norm] = value === IGNORE ? "" : value;
      return next;
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{source ? t("sync.editTitle") : t("sync.addTitle")}</DialogTitle>
        <DialogDescription>{t("sync.formBody")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="src-name">{t("sync.name")}</Label>
            <Input id="src-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("sync.namePlaceholder")} data-testid="source-name" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("sync.kind")}</Label>
            <Select value={kind} onValueChange={(v) => (setKind(v as SyncKind), setMapping({}), setHeaders(null))}>
              <SelectTrigger className="w-full" data-testid="source-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYNC_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="src-url">{t("sync.url")}</Label>
          <Input id="src-url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sis.school.example/export/students.csv" data-testid="source-url" />
          <p className="text-xs text-muted-foreground">{t("sync.urlHelp")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("sync.auth")}</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as SourceValue["authType"])}>
              <SelectTrigger className="w-full" data-testid="source-auth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["NONE", "BASIC", "BEARER"] as const).map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`authTypes.${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {authType === "BASIC" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="src-user">{t("sync.username")}</Label>
                <Input id="src-user" dir="ltr" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={keepSecret ? t("sync.savedPlaceholder") : ""} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="src-pass">{t("sync.password")}</Label>
                <Input id="src-pass" dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={keepSecret ? t("sync.savedPlaceholder") : ""} />
              </div>
            </div>
          )}
          {authType === "BEARER" && (
            <div className="space-y-1.5">
              <Label htmlFor="src-token">{t("sync.token")}</Label>
              <Input id="src-token" dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={keepSecret ? t("sync.savedPlaceholder") : ""} />
            </div>
          )}
        </div>
        {authType !== "NONE" && <p className="text-xs text-muted-foreground">{keepSecret ? t("sync.secretKept") : t("sync.secretStored")}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t("sync.schedule")}</Label>
            <Select value={schedule} onValueChange={(v) => setSchedule(v as SourceValue["schedule"])}>
              <SelectTrigger className="w-full" data-testid="source-schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAILY">{t("schedules.DAILY")}</SelectItem>
                <SelectItem value="HOURLY">{t("schedules.HOURLY")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {schedule === "DAILY" && (
            <div className="space-y-1.5">
              <Label>{t("sync.hour")}</Label>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger className="w-full" data-testid="source-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      <span dir="ltr">{`${String(h).padStart(2, "0")}:00`}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-end gap-2 pb-1.5">
            <Switch id="src-enabled" checked={enabled} onCheckedChange={setEnabled} data-testid="source-enabled" />
            <Label htmlFor="src-enabled">{t("sync.enabled")}</Label>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("sync.mappingTitle")}</div>
              <p className="text-xs text-muted-foreground">{t("sync.mappingBody")}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={readHeaders} disabled={reading || !url.trim() || !credentialsReady} data-testid="read-headers">
              {reading ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
              {t("sync.readHeaders")}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("sync.mappingEmpty")}</p>
          ) : (
            <div className="divide-y rounded-md border" data-testid="mapping-rows">
              {rows.map((r) => {
                const value = Object.prototype.hasOwnProperty.call(mapping, r.norm) ? (mapping[r.norm] === "" ? IGNORE : mapping[r.norm]) : AUTO;
                return (
                  <div key={r.norm} className="grid gap-2 px-3 py-2 sm:grid-cols-2 sm:items-center">
                    <div className="min-w-0 truncate text-sm" dir="auto">
                      {r.header}
                    </div>
                    <Select value={value} onValueChange={(v) => setRow(r.norm, v)}>
                      <SelectTrigger className="w-full" aria-label={r.header}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={AUTO}>{r.suggested ? t("sync.auto", { column: label(r.suggested) }) : t("sync.autoNone")}</SelectItem>
                        {columns.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {locale === "ar" ? c.ar : c.en}
                            {c.required ? " *" : ""}
                          </SelectItem>
                        ))}
                        <SelectItem value={IGNORE}>{t("sync.ignore")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
          {headers && (missing.length ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="mapping-missing">{t("sync.missing", { columns: missing.map(label).join(locale === "ar" ? "، " : ", ") })}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-xs text-success" data-testid="mapping-ok">
              {t("sync.mappingOk")}
            </p>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={pending || !valid} data-testid="source-save">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("sync.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

export function SourceRowActions({ source, running }: { source: SourceValue; running: boolean }) {
  const t = useTranslations("integrations");
  const err = useError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const run = () =>
    start(async () => {
      const res = await runSyncNowAction(source.id);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(res.status === "QUEUED" ? t("sync.queued") : t("sync.finished"));
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const res = await deleteSyncSourceAction(source.id);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("sync.deleted"));
      setConfirm(false);
      router.refresh();
    });
  const runButton = (
    <Button variant="outline" size="sm" onClick={run} disabled={pending || running} data-testid="run-now">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
      {t("sync.runNow")}
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1 lg:justify-end">
      {running ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{runButton}</span>
          </TooltipTrigger>
          <TooltipContent>{t("sync.runningTip")}</TooltipContent>
        </Tooltip>
      ) : (
        runButton
      )}
      <SourceDialogButton source={source} />
      <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirm(true)} data-testid="delete-source">
        <Trash2 className="size-4" />
        {t("sync.delete")}
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sync.deleteTitle", { name: source.name })}</DialogTitle>
            <DialogDescription>{t("sync.deleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending} data-testid="delete-source-confirm">
              {t("sync.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
