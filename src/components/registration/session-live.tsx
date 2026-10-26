"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Circle, CircleDashed, Clock, Copy, Expand, Hourglass, Loader2, Minimize2, Play, Square, BadgeCheck } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { encodeQr, qrSvgPath } from "@/server/access/qr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { endSessionAction, sessionProgressAction, startSessionAction, type SessionStudent } from "@/server/registration/selection-actions";
import { Countdown } from "./selection-status";
import { useSelError } from "./assist-controls";

function Qr({ value, size, label }: { value: string; size: number; label: string }) {
  const qr = useMemo(() => {
    try {
      return qrSvgPath(encodeQr(value));
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return <div className="rounded-xl border bg-muted/40" style={{ width: size, height: size }} />;
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width={size} height={size} role="img" aria-label={label} className="rounded-xl border bg-white" shapeRendering="crispEdges" data-testid="session-qr">
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

/** Start choosing for one homeroom class for a set time. */
export function StartSessionForm({ classId, minutes }: { classId: string; minutes: readonly number[] }) {
  const t = useTranslations("selection.session");
  const err = useSelError();
  const router = useRouter();
  const [pick, setPick] = useState(45);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">{t("duration")}</div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("duration")}>
          {minutes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={pick === m}
              onClick={() => setPick(m)}
              className={cn("min-w-14 rounded-lg border px-3 py-2 text-sm font-medium tabular-nums", pick === m ? "border-brand bg-brand text-white" : "bg-card text-muted-foreground hover:text-foreground")}
              data-testid={`session-minutes-${m}`}
            >
              {t("minutes", { count: m })}
            </button>
          ))}
        </div>
      </div>
      <Button
        className="w-full sm:w-auto"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await startSessionAction({ classId, minutes: pick });
            if (!res.ok) return void toast.error(err(res.error));
            if ("id" in res) router.push(`/subjects/session/${res.id}`);
          })
        }
        data-testid="session-start"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {t("start")}
      </Button>
    </div>
  );
}

const ICON = { not_started: Circle, in_progress: CircleDashed, submitted: CheckCircle2, signed_off: BadgeCheck } as const;
const TONE = { not_started: "text-muted-foreground", in_progress: "text-warning", submitted: "text-info", signed_off: "text-success" } as const;

/** The teacher's live screen: QR code and short link, countdown, and who has finished. Polls every 5 seconds. */
export function SessionLive({ id, code, className, initial, endsAt, active: initialActive, signOffRequired, serverNow }: { id: string; code: string; className: string; initial: SessionStudent[]; endsAt: string; active: boolean; signOffRequired: boolean; serverNow: string }) {
  const t = useTranslations("selection.session");
  const ts = useTranslations("selection.status");
  const err = useSelError();
  const router = useRouter();
  const [students, setStudents] = useState(initial);
  const [active, setActive] = useState(initialActive);
  const [end, setEnd] = useState(endsAt);
  const [big, setBig] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [link, setLink] = useState(`/choose/${code}`);
  useEffect(() => setLink(`${window.location.origin}/choose/${code}`), [code]);

  const poll = useCallback(async () => {
    const res = await sessionProgressAction({ id }).catch(() => null);
    if (res && res.ok) {
      setStudents(res.students);
      setActive(res.active);
      setEnd(res.endsAt);
    }
  }, [id]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(poll, 5000);
    // The session ends on its own: check again right after the end time.
    const left = new Date(end).getTime() - Date.now();
    const stop = left > 0 ? setTimeout(poll, left + 1500) : null;
    return () => {
      clearInterval(timer);
      if (stop) clearTimeout(stop);
    };
  }, [active, poll, end]);

  const done = students.filter((s) => s.status === "submitted" || s.status === "signed_off").length;
  const waiting = students.filter((s) => s.status === "submitted").length;
  const order = { not_started: 0, in_progress: 1, submitted: 2, signed_off: 3 } as const;
  const sorted = [...students].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="h-fit space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5 lg:sticky lg:top-20" data-testid="session-card">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", active ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")} data-testid="session-state" data-active={active}>
            <span className={cn("size-2 rounded-full", active ? "animate-pulse bg-success" : "bg-muted-foreground")} />
            {active ? t("live") : t("ended")}
          </span>
          {active && (
            <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
              <Clock className="size-4 text-muted-foreground" />
              <Countdown until={end} serverNow={serverNow} />
            </span>
          )}
        </div>
        {active ? (
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              <Qr value={link} size={220} label={t("qrLabel", { name: className })} />
              <p className="text-sm text-muted-foreground">{t("scan")}</p>
              <button type="button" onClick={copy} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm" dir="ltr" data-testid="session-link">
                <span className="truncate">{link.replace(/^https?:\/\//, "")}</span>
                <Copy className="size-3.5 shrink-0" />
              </button>
              <p className="text-xs text-muted-foreground">
                {t("code")} <span className="font-mono font-semibold tracking-widest text-foreground" dir="ltr">{code}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setBig(true)} data-testid="session-fullscreen">
                <Expand className="size-4" />
                {t("classScreen")}
              </Button>
              <Button variant="outline" className="flex-1 text-danger hover:text-danger" onClick={() => setConfirm(true)} data-testid="session-end">
                <Square className="size-4" />
                {t("end")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("endedBody")}</p>
        )}
      </section>

      <section className="space-y-3" data-testid="session-progress">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border bg-card p-3 shadow-xs">
            <div className="text-xs text-muted-foreground">{t("finished")}</div>
            <div className="text-2xl font-semibold tabular-nums" data-testid="session-done">
              {done}/{students.length}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-xs">
            <div className="text-xs text-muted-foreground">{t("choosing")}</div>
            <div className="text-2xl font-semibold tabular-nums">{students.filter((s) => s.status === "in_progress").length}</div>
          </div>
          <div className="rounded-xl border bg-card p-3 shadow-xs">
            <div className="text-xs text-muted-foreground">{signOffRequired ? t("waitingSignOff") : t("notStarted")}</div>
            <div className="text-2xl font-semibold tabular-nums">{signOffRequired ? waiting : students.filter((s) => s.status === "not_started").length}</div>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${students.length ? (done / students.length) * 100 : 0}%` }} />
        </div>
        {students.length === 0 ? (
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">{t("noStudents")}</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {sorted.map((s) => {
              const Icon = ICON[s.status];
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5" data-testid="session-student" data-status={s.status}>
                  <Icon className={cn("size-5 shrink-0", TONE[s.status])} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {s.status === "submitted" && signOffRequired ? (
                      <span className="inline-flex items-center gap-1">
                        <Hourglass className="size-3" />
                        {t("waitingParent")}
                      </span>
                    ) : s.status === "in_progress" ? (
                      t("blocks", { chosen: s.chosen, total: s.blocks })
                    ) : (
                      ts(s.status)
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("screenTitle", { name: className })}</DialogTitle>
            <DialogDescription>{t("scan")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2 sm:flex-row sm:justify-center sm:gap-8">
            <Qr value={link} size={300} label={t("qrLabel", { name: className })} />
            <div className="space-y-3 text-center sm:text-start">
              <div className="font-mono text-2xl font-semibold sm:text-3xl" dir="ltr">
                {link.replace(/^https?:\/\//, "")}
              </div>
              <div className="text-5xl font-semibold tabular-nums">
                {done}/{students.length}
              </div>
              <div className="text-sm text-muted-foreground">{t("finished")}</div>
              {active && (
                <div className="inline-flex items-center gap-1.5 text-lg font-medium tabular-nums">
                  <Clock className="size-5 text-muted-foreground" />
                  <Countdown until={end} serverNow={serverNow} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBig(false)}>
              <Minimize2 className="size-4" />
              {t("closeScreen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endTitle")}</DialogTitle>
            <DialogDescription>{t("endBody", { name: className })}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await endSessionAction({ id });
                  if (!res.ok) return void toast.error(err(res.error));
                  setConfirm(false);
                  setActive(false);
                  toast.success(t("endedToast"));
                  router.refresh();
                })
              }
              data-testid="session-end-confirm"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("end")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
