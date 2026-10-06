"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listPushItemsAction, pushTemplateAction } from "@/server/groups/actions";
import type { PushItem, PushResult } from "@/server/groups/push";

type School = { id: string; name: string };
const KINDS = ["service", "letter", "notification"] as const;
type Kind = (typeof KINDS)[number];

export function PushForm({ groupId, schools, defaultSource }: { groupId: string; schools: School[]; defaultSource: string }) {
  const t = useTranslations("groups.push");
  const tg = useTranslations("groups");
  const locale = useLocale();
  const router = useRouter();
  const [source, setSource] = useState(defaultSource);
  const [kind, setKind] = useState<Kind>("service");
  const [items, setItems] = useState<PushItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [item, setItem] = useState<string>("");
  const [mode, setMode] = useState<"copy" | "replace">("copy");
  const [targets, setTargets] = useState<string[]>(schools.filter((s) => s.id !== defaultSource).map((s) => s.id));
  const [confirm, setConfirm] = useState(false);
  const [results, setResults] = useState<PushResult[] | null>(null);
  const [pending, start] = useTransition();
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    setItems(null);
    setItem("");
    setLoadError(false);
    startLoading(async () => {
      const res = await listPushItemsAction(groupId, source, kind);
      if (res.ok) setItems(res.items);
      else setLoadError(true);
    });
  }, [groupId, source, kind]);

  const others = useMemo(() => schools.filter((s) => s.id !== source), [schools, source]);
  const chosenTargets = targets.filter((x) => others.some((o) => o.id === x));
  const label = (i: PushItem) => `${locale === "ar" ? i.nameAr : i.nameEn}${i.hint ? ` (${tg.has(`channel.${i.hint}`) ? tg(`channel.${i.hint}`) : i.hint})` : ""}`;
  const selected = items?.find((i) => i.id === item);
  const blocker = !item ? t("needItem") : chosenTargets.length === 0 ? t("needTargets") : null;
  const nameOf = (id: string) => schools.find((s) => s.id === id)?.name ?? "";

  const push = () =>
    start(async () => {
      const res = await pushTemplateAction({ groupId, sourceOrgId: source, kind, sourceId: item, targetOrgIds: chosenTargets, mode });
      setConfirm(false);
      if (!res.ok) return void toast.error(tg(`error.${["forbidden", "not_in_group", "not_found"].includes(res.error) ? res.error : "generic"}`));
      setResults(res.results);
      const failed = res.results.filter((r) => r.status === "failed").length;
      if (failed) toast.error(t("someFailed", { n: failed }));
      else toast.success(t("pushed", { n: res.results.length }));
      router.refresh();
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("source")}</Label>
          <Select
            value={source}
            onValueChange={(v) => {
              setSource(v);
              setTargets(schools.filter((s) => s.id !== v).map((s) => s.id));
              setResults(null);
            }}
          >
            <SelectTrigger className="w-full" data-testid="push-source">
              <SelectValue>{nameOf(source)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {schools.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("kind")}</Label>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as Kind);
              setResults(null);
            }}
          >
            <SelectTrigger className="w-full" data-testid="push-kind">
              <SelectValue>{t(`kinds.${kind}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k} data-testid={`push-kind-${k}`}>
                  {t(`kinds.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t(`explain.${kind}`)}</p>

      <div className="space-y-1.5">
        <Label>{t("item")}</Label>
        {loading || items === null ? (
          loadError ? (
            <p className="text-sm text-danger">{tg("error.generic")}</p>
          ) : (
            <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("loadingItems")}
            </div>
          )
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noItems")}</p>
        ) : (
          <Select value={item} onValueChange={(v) => { setItem(v); setResults(null); }}>
            <SelectTrigger className="w-full" data-testid="push-item">
              <SelectValue placeholder={t("chooseItem")}>{selected ? label(selected) : null}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id} data-testid={`push-item-${i.key}`}>
                  {label(i)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {kind === "letter" && (
        <div className="space-y-1.5">
          <Label>{t("mode")}</Label>
          <Select value={mode} onValueChange={(v) => setMode(v === "replace" ? "replace" : "copy")}>
            <SelectTrigger className="w-full" data-testid="push-mode">
              <SelectValue>{t(`modes.${mode}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="copy">{t("modes.copy")}</SelectItem>
              <SelectItem value="replace">{t("modes.replace")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">{t("targets")}</legend>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTargets")}</p>
        ) : (
          others.map((s) => (
            <label key={s.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
              <Checkbox
                checked={targets.includes(s.id)}
                onCheckedChange={(c) => setTargets((cur) => (c ? [...new Set([...cur, s.id])] : cur.filter((x) => x !== s.id)))}
                data-testid={`push-target-${s.id}`}
              />
              {s.name}
            </label>
          ))
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setConfirm(true)} disabled={!!blocker || pending} data-testid="push-submit">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 rtl:-scale-x-100" />}
          {t("submit")}
        </Button>
        {blocker && <span className="text-xs text-muted-foreground">{blocker}</span>}
      </div>

      {results && (
        <ul className="divide-y rounded-lg border" role="list" data-testid="push-results">
          {results.map((r) => (
            <li key={r.orgId} className="flex items-start gap-3 px-4 py-3 text-sm">
              {r.status === "failed" ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium">{nameOf(r.orgId)}</div>
                <div className="text-xs text-muted-foreground">{t(`status.${r.status}`)}</div>
                {r.warnings.map((w) => (
                  <div key={w} className="mt-1 flex items-start gap-1.5 text-xs text-[oklch(0.55_0.14_65)]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {t(`warnings.${w}`)}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("confirmBody", { item: selected ? label(selected) : "", n: chosenTargets.length })}</DialogDescription>
          </DialogHeader>
          <ul className="list-inside list-disc text-sm">
            {chosenTargets.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {tg("cancel")}
            </Button>
            <Button onClick={push} disabled={pending} data-testid="push-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
