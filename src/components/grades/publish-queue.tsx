"use client";

// The publishing queue for holders of grades.publish: select assessments (or report cards) and publish them, or
// publish everything ready in the current filter. Each publish notifies families once, as a teacher's publish does.
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EyeOff, Loader2, Send } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { publishReadyAction, releaseReportCardsAction, setPublishModeAction, unpublishByPublisherAction, withdrawReportCardAction } from "@/server/grades/actions";

export type QueueRow = {
  id: string;
  title: string;
  kind: string;
  cls: string;
  subject: string | null;
  teacher: string | null;
  when: string | null;
  by: string | null;
  marked: number;
  students: number;
};

export function PublishList({ rows, mode, total, filter }: { rows: QueueRow[]; mode: "ready" | "published" | "waiting"; total: number; filter: { classId: string | null; teacherId: string | null } }) {
  const t = useTranslations("grades.publishing");
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<{ ids?: string[]; all?: boolean } | null>(null);
  const [undo, setUndo] = useState<QueueRow | null>(null);
  const toggle = (id: string, on: boolean) => setSel((s) => {
    const n = new Set(s);
    if (on) n.add(id);
    else n.delete(id);
    return n;
  });
  const publish = () =>
    confirm &&
    start(async () => {
      const res = await publishReadyAction(confirm.all ? { all: filter } : { ids: confirm.ids });
      if (!res.ok) return void toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
      toast.success(t("publishedToast", { count: res.published, notified: res.notified }));
      if (res.remaining && confirm.all) toast.info(t("remaining", { count: res.remaining }));
      setConfirm(null);
      setSel(new Set());
      router.refresh();
    });
  const unpublish = () =>
    undo &&
    start(async () => {
      const res = await unpublishByPublisherAction(undo.id);
      if (!res.ok) return void toast.error(t("error.generic"));
      toast.success(t("unpublishedToast"));
      setUndo(null);
      router.refresh();
    });
  const count = confirm?.all ? total : (confirm?.ids?.length ?? 0);

  return (
    <div className="space-y-3">
      {mode === "ready" && rows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={sel.size > 0 && sel.size === rows.length} onCheckedChange={(c) => setSel(c ? new Set(rows.map((r) => r.id)) : new Set())} aria-label={t("selectPage")} data-testid="select-page" />
            {sel.size ? t("selected", { count: sel.size }) : t("selectPage")}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!sel.size || pending} onClick={() => setConfirm({ ids: [...sel] })} data-testid="publish-selected">
              <Send className="size-4" />
              {t("publishSelected", { count: sel.size })}
            </Button>
            <Button disabled={pending} onClick={() => setConfirm({ all: true })} data-testid="publish-all">
              <Send className="size-4" />
              {t("publishAll", { count: total })}
            </Button>
          </div>
        </div>
      )}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid={`queue-${mode}`}>
        {rows.map((r) => {
          const incomplete = r.marked < r.students;
          return (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3" data-testid="queue-row">
              {mode === "ready" && <Checkbox className="mt-1" checked={sel.has(r.id)} onCheckedChange={(c) => toggle(r.id, !!c)} aria-label={t("selectOne", { title: r.title })} />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{r.kind}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[r.cls, r.subject, r.teacher].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  <span className={cn(incomplete ? "text-[oklch(0.5_0.13_65)]" : "text-success")}>{t("marked", { marked: r.marked, total: r.students })}</span>
                  {r.when && <span className="text-muted-foreground">{mode === "published" ? t("publishedOn", { when: r.when, by: r.by ?? "" }) : mode === "ready" ? t("readySince", { when: r.when, by: r.by ?? "" }) : ""}</span>}
                </div>
              </div>
              {mode === "ready" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirm({ ids: [r.id] })} data-testid="publish-one">
                  {t("publish")}
                </Button>
              )}
              {mode === "published" && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setUndo(r)} data-testid="unpublish-one">
                  <EyeOff className="size-4" />
                  {t("unpublish")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("confirmTitle", { count })}</DialogTitle>
            <DialogDescription>{t("confirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={publish} disabled={pending} data-testid="confirm-publish-queue">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("publishNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!undo} onOpenChange={(o) => !o && setUndo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("unpublishTitle")}</DialogTitle>
            <DialogDescription>{t("unpublishBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUndo(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={unpublish} disabled={pending}>
              {t("unpublish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type CardRow = { id: string; student: string; detail: string; title: string; when: string };

export function ReportCardList({ rows, total }: { rows: CardRow[]; total: number }) {
  const t = useTranslations("grades.publishing");
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const release = (input: { ids?: string[]; all?: boolean }) =>
    start(async () => {
      const res = await releaseReportCardsAction(input);
      if (!res.ok) return void toast.error(t("error.generic"));
      toast.success(t("releasedToast", { count: res.released }));
      setSel(new Set());
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={sel.size > 0 && sel.size === rows.length} onCheckedChange={(c) => setSel(c ? new Set(rows.map((r) => r.id)) : new Set())} aria-label={t("selectPage")} />
          {sel.size ? t("selected", { count: sel.size }) : t("selectPage")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!sel.size || pending} onClick={() => release({ ids: [...sel] })}>
            {t("releaseSelected", { count: sel.size })}
          </Button>
          <Button disabled={pending} onClick={() => release({ all: true })} data-testid="release-all">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("releaseAll", { count: total })}
          </Button>
        </div>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="queue-cards">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            <Checkbox checked={sel.has(r.id)} onCheckedChange={(c) => setSel((s) => {
              const n = new Set(s);
              if (c) n.add(r.id);
              else n.delete(r.id);
              return n;
            })} aria-label={r.student} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{r.student}</div>
              <div className="truncate text-xs text-muted-foreground">{r.title} · {r.detail} · {r.when}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WithdrawCardButton({ id }: { id: string }) {
  const t = useTranslations("grades.publishing");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
      const res = await withdrawReportCardAction(id);
      if (!res.ok) return void toast.error(t("error.generic"));
      toast.success(t("withdrawnToast"));
      router.refresh();
    })}>
      {t("withdraw")}
    </Button>
  );
}

export function PublishModeForm({ mode, publishers }: { mode: "TEACHER" | "PUBLISHER"; publishers: number }) {
  const t = useTranslations("grades.publishing");
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3" data-testid="publish-mode">
      <RadioGroup value={value} onValueChange={(v) => setValue(v as typeof mode)} className="gap-2">
        {(["TEACHER", "PUBLISHER"] as const).map((m) => (
          <Label key={m} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal", value === m && "border-brand bg-brand-soft/40")}>
            <RadioGroupItem value={m} className="mt-0.5" data-testid={`publish-mode-${m}`} />
            <span>
              <span className="block text-sm font-medium">{t(`mode.${m}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`modeHelp.${m}`)}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {value === "PUBLISHER" && publishers === 0 && <p className="text-xs text-danger">{t("noPublishers")}</p>}
      <Button
        disabled={pending || value === mode}
        onClick={() =>
          start(async () => {
            const res = await setPublishModeAction(value);
            if (!res.ok) return void toast.error(t("error.generic"));
            toast.success(t("modeSaved"));
            router.refresh();
          })
        }
        data-testid="save-publish-mode"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t("saveMode")}
      </Button>
    </div>
  );
}
