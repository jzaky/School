"use client";

// Taking a register on a phone, tablet or desktop. One tap per student (present, late, absent, excused, school
// activity), "All present" first and then adjust. Every change saves on its own after a short pause; when the
// device is offline the changes wait in this browser (localStorage) and are sent again automatically, with the
// state always shown at the bottom. Keyboard: arrow keys move between students, P L A E S (or 1 to 5) mark.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CheckCheck, ChevronDown, CloudOff, Loader2, Lock, Minus, MoreHorizontal, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { saveRegisterAction } from "@/server/attendance/actions";

export type TakerCode = { code: string; label: string; countsAs: "PRESENT" | "ABSENT" | "NOT_COUNTED"; late: boolean; authorised: boolean; quick: string | null; active: boolean };
export type TakerStudent = {
  id: string;
  name: string;
  studentNo: string;
  initials: string;
  mark: { code: string; minutesLate: number | null; masked: boolean; fromReport: boolean } | null;
  prefill: { code: string; from: "daily" | "report" } | null;
};

type Mark = { code: string; minutesLate: number | null };
type SaveState = "idle" | "pending" | "saving" | "saved" | "offline" | "error";

const QUICK_ORDER = ["present", "late", "absent", "excused", "activity"] as const;
const KEYS: Record<string, (typeof QUICK_ORDER)[number]> = { p: "present", "1": "present", l: "late", "2": "late", a: "absent", "3": "absent", e: "excused", "4": "excused", s: "activity", "5": "activity" };

const TONE: Record<string, string> = {
  present: "data-[on=true]:bg-success data-[on=true]:text-white data-[on=true]:border-success",
  late: "data-[on=true]:bg-warning data-[on=true]:text-[oklch(0.25_0.05_65)] data-[on=true]:border-warning",
  absent: "data-[on=true]:bg-danger data-[on=true]:text-white data-[on=true]:border-danger",
  excused: "data-[on=true]:bg-info data-[on=true]:text-white data-[on=true]:border-info",
  activity: "data-[on=true]:bg-brand data-[on=true]:text-white data-[on=true]:border-brand",
  other: "data-[on=true]:bg-foreground data-[on=true]:text-background data-[on=true]:border-foreground",
};

export function RegisterTaker({
  queueKey,
  regRef,
  students,
  codes,
  canEdit,
  lateAllowed,
  lateCutoff,
  startMin,
  timeZone,
  isToday,
  auditNotice,
  doneHref,
}: {
  queueKey: string;
  regRef: { classId: string; date: string; periodNo: number };
  students: TakerStudent[];
  codes: TakerCode[];
  canEdit: boolean;
  /** False after the late cut-off for a teacher: late is shown but disabled with the reason. */
  lateAllowed: boolean;
  lateCutoff: string;
  startMin: number;
  timeZone: string;
  isToday: boolean;
  auditNotice: boolean;
  /** The "Done" link back to today's registers, rendered by the page. */
  doneHref?: React.ReactNode;
}) {
  const t = useTranslations("attendance.take");
  const byQuick = useMemo(() => Object.fromEntries(codes.filter((c) => c.quick).map((c) => [c.quick!, c])) as Record<string, TakerCode | undefined>, [codes]);
  const others = useMemo(() => codes.filter((c) => !c.quick && c.active), [codes]);
  const codeOf = useCallback((code: string) => codes.find((c) => c.code === code), [codes]);

  const saved = useRef<Map<string, Mark>>(new Map(students.filter((s) => s.mark).map((s) => [s.id, { code: s.mark!.code, minutesLate: s.mark!.minutesLate }])));
  const [marks, setMarks] = useState<Map<string, Mark>>(() => new Map(saved.current));
  const pending = useRef<Map<string, Mark>>(new Map());
  const [state, setState] = useState<SaveState>("idle");
  const [waiting, setWaiting] = useState(0);
  const [focus, setFocus] = useState(0);
  const rows = useRef<Array<HTMLDivElement | null>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const attempts = useRef(0);

  const nowMinutesLate = useCallback(() => {
    if (!isToday) return 5;
    const d = new Date();
    const local = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    const [h, m] = local.split(":").map(Number);
    return Math.max(1, Math.min(240, h * 60 + m - startMin));
  }, [isToday, startMin, timeZone]);

  // --- Queue: pending marks are kept in this browser until the server has them --------------------------------
  const persist = useCallback(() => {
    try {
      if (pending.current.size) localStorage.setItem(queueKey, JSON.stringify([...pending.current.entries()]));
      else localStorage.removeItem(queueKey);
    } catch {
      // Private browsing or full storage: the queue still lives in memory for this page.
    }
    setWaiting(pending.current.size);
  }, [queueKey]);

  const flush = useCallback(async () => {
    if (inflight.current || !pending.current.size) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState("offline");
      return;
    }
    inflight.current = true;
    const batch = new Map(pending.current);
    setState("saving");
    try {
      const res = await saveRegisterAction({ ref: regRef, marks: [...batch.entries()].map(([studentId, m]) => ({ studentId, code: m.code, minutesLate: m.minutesLate })) });
      if (!res.ok) {
        // A rule refused the save (for example the register was closed meanwhile): not a network problem.
        for (const k of batch.keys()) pending.current.delete(k);
        persist();
        setMarks(new Map(saved.current));
        setState("error");
        toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
        return;
      }
      for (const [k, m] of batch) {
        const cur = pending.current.get(k);
        if (cur && cur.code === m.code && cur.minutesLate === m.minutesLate) pending.current.delete(k);
        if (!res.rejected.some((r) => r.studentId === k)) saved.current.set(k, m);
      }
      if (res.rejected.length) {
        // Put refused marks back to what the server has, and say why.
        setMarks((prev) => {
          const next = new Map(prev);
          for (const r of res.rejected) {
            const s = saved.current.get(r.studentId);
            if (s) next.set(r.studentId, s);
            else next.delete(r.studentId);
          }
          return next;
        });
        const first = res.rejected[0].error;
        toast.error(t.has(`error.${first}`) ? t(`error.${first}`, { time: lateCutoff }) : t("error.generic"));
      }
      attempts.current = 0;
      persist();
      setState(pending.current.size ? "pending" : "saved");
    } catch {
      // Network or server unreachable: keep everything queued and try again with a growing delay.
      attempts.current++;
      setState("offline");
      const delay = Math.min(60_000, 3_000 * 2 ** Math.min(attempts.current, 5));
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => void flush(), delay);
    } finally {
      inflight.current = false;
    }
  }, [lateCutoff, persist, regRef, t]);

  const schedule = useCallback(() => {
    setState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  }, [flush]);

  // Marks left in this browser from an earlier visit (offline) are shown and sent again.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(queueKey);
      if (raw) {
        const entries = JSON.parse(raw) as Array<[string, Mark]>;
        const ids = new Set(students.map((s) => s.id));
        const valid = entries.filter(([k, m]) => ids.has(k) && typeof m?.code === "string");
        if (valid.length) {
          pending.current = new Map(valid);
          setMarks((prev) => {
            const next = new Map(prev);
            for (const [k, m] of valid) next.set(k, m);
            return next;
          });
          setWaiting(valid.length);
          setState("pending");
          void flush();
        }
      }
    } catch {
      // Unreadable storage: nothing to restore.
    }
    const online = () => {
      attempts.current = 0;
      void flush();
    };
    const offline = () => pending.current.size && setState("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.size && navigator.onLine) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
      if (retry.current) clearTimeout(retry.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMark = useCallback(
    (studentId: string, m: Mark) => {
      if (!canEdit) return;
      setMarks((prev) => {
        const next = new Map(prev);
        next.set(studentId, m);
        return next;
      });
      pending.current.set(studentId, m);
      persist();
      schedule();
    },
    [canEdit, persist, schedule],
  );

  const tapQuick = (s: TakerStudent, q: (typeof QUICK_ORDER)[number]) => {
    const c = byQuick[q];
    if (!c) return;
    if (c.late && !lateAllowed && !(marks.get(s.id) && codeOf(marks.get(s.id)!.code)?.late)) return;
    setMark(s.id, { code: c.code, minutesLate: c.late ? (marks.get(s.id)?.minutesLate ?? nowMinutesLate()) : null });
  };

  const allPresent = () => {
    const present = byQuick.present;
    if (!present) return;
    let n = 0;
    for (const s of students) {
      if (marks.has(s.id)) continue;
      const code = s.prefill?.code ?? present.code;
      const c = codeOf(code);
      setMark(s.id, { code, minutesLate: c?.late ? nowMinutesLate() : null });
      n++;
    }
    if (n) toast.success(t("allPresentDone", { count: n }));
  };

  const counts = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    for (const s of students) {
      const m = marks.get(s.id);
      const c = m ? codeOf(m.code) : undefined;
      if (!c) continue;
      if (c.countsAs === "PRESENT") present++;
      if (c.late) late++;
      if (c.countsAs === "ABSENT") absent++;
    }
    return { present, late, absent, unmarked: students.filter((s) => !marks.has(s.id)).length };
  }, [codeOf, marks, students]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      const n = Math.min(students.length - 1, i + 1);
      setFocus(n);
      rows.current[n]?.focus();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      const n = Math.max(0, i - 1);
      setFocus(n);
      rows.current[n]?.focus();
      return;
    }
    const q = KEYS[e.key.toLowerCase()];
    if (q && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      tapQuick(students[i], q);
      const n = Math.min(students.length - 1, i + 1);
      setFocus(n);
      rows.current[n]?.focus();
    }
  };

  const quickLabel = (q: (typeof QUICK_ORDER)[number]) => t(`quick.${q}`);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5 text-xs" aria-live="polite">
            <span className="rounded-full bg-success-soft px-2.5 py-1 font-medium text-success" data-testid="count-present">{t("countPresent", { n: counts.present })}</span>
            <span className="rounded-full bg-warning-soft px-2.5 py-1 font-medium text-[oklch(0.5_0.13_65)]">{t("countLate", { n: counts.late })}</span>
            <span className="rounded-full bg-danger-soft px-2.5 py-1 font-medium text-danger">{t("countAbsent", { n: counts.absent })}</span>
            <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground" data-testid="count-unmarked">{t("countUnmarked", { n: counts.unmarked })}</span>
          </div>
          <Button size="lg" className="h-12 w-full text-base sm:w-auto" onClick={allPresent} disabled={counts.unmarked === 0} data-testid="all-present">
            <CheckCheck className="size-5" />
            {t("allPresent")}
          </Button>
        </div>
      )}
      {canEdit && <p className="hidden text-xs text-muted-foreground md:block">{t("keyboardHint")}</p>}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs" role="list" aria-label={t("listLabel")} data-testid="taker">
        {students.map((s, i) => {
          const m = marks.get(s.id);
          const c = m ? codeOf(m.code) : undefined;
          const quick = c?.quick ?? (c ? "other" : null);
          const masked = !!s.mark?.masked && m?.code === s.mark.code;
          const pre = !m && s.prefill ? codeOf(s.prefill.code) : undefined;
          return (
            <div
              key={s.id}
              ref={(el) => {
                rows.current[i] = el;
              }}
              role="listitem"
              tabIndex={canEdit ? (i === focus ? 0 : -1) : -1}
              onKeyDown={(e) => canEdit && onKey(e, i)}
              onFocus={() => setFocus(i)}
              className={cn("border-b px-3 py-3 outline-none last:border-b-0 focus-visible:bg-brand-soft/40 sm:px-4", !m && canEdit && "bg-muted/20")}
              data-testid="taker-row"
              data-student={s.id}
              data-code={m?.code ?? ""}
            >
              <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-hidden>
                    {s.initials}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium">{s.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span dir="ltr">{s.studentNo}</span>
                      {pre && (
                        <span className="text-info" data-testid="prefill">
                          {t(s.prefill!.from === "report" ? "prefillReport" : "prefillDaily", { code: pre.label })}
                        </span>
                      )}
                      {m && c && !c.quick && <span className="font-medium text-foreground">{c.code} · {c.label}</span>}
                      {masked && (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="size-3" />
                          {t("reasonPrivate")}
                        </span>
                      )}
                      {s.mark?.fromReport && m?.code === s.mark.code && <span className="text-info">{t("fromReport")}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="grid flex-1 grid-cols-5 gap-1.5 md:flex-none">
                    {QUICK_ORDER.map((q) => {
                      const qc = byQuick[q];
                      if (!qc) return <span key={q} />;
                      const on = quick === q;
                      const blocked = qc.late && !lateAllowed && !on;
                      const btn = (
                        <button
                          type="button"
                          data-on={on}
                          disabled={!canEdit || blocked}
                          onClick={() => tapQuick(s, q)}
                          aria-pressed={on}
                          aria-label={`${s.name}: ${qc.label}`}
                          tabIndex={-1}
                          data-testid={`mark-${q}`}
                          className={cn(
                            "flex h-12 min-w-0 flex-col items-center justify-center rounded-lg border bg-background text-sm font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 md:h-11 md:w-[4.25rem]",
                            TONE[q],
                          )}
                        >
                          <span className="leading-none">{qc.code}</span>
                          <span className="mt-0.5 max-w-full truncate px-0.5 text-[10px] font-medium leading-none opacity-80">{quickLabel(q)}</span>
                        </button>
                      );
                      return blocked ? (
                        <Tooltip key={q}>
                          <TooltipTrigger asChild>
                            <span className="grid" tabIndex={0}>
                              {btn}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{t("lateClosedTip", { time: lateCutoff })}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span key={q} className="grid">
                          {btn}
                        </span>
                      );
                    })}
                  </div>
                  {others.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          disabled={!canEdit}
                          data-on={quick === "other"}
                          className={cn("grid h-12 w-11 shrink-0 place-items-center rounded-lg border bg-background disabled:opacity-40 md:h-11", TONE.other)}
                          aria-label={t("moreCodesFor", { name: s.name })}
                          data-testid="mark-more"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-72 p-1">
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("moreCodes")}</div>
                        <ul className="max-h-72 overflow-y-auto">
                          {others.map((oc) => (
                            <li key={oc.code}>
                              <button
                                type="button"
                                className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-start text-sm hover:bg-muted"
                                onClick={() => setMark(s.id, { code: oc.code, minutesLate: oc.late ? nowMinutesLate() : null })}
                                disabled={oc.late && !lateAllowed}
                              >
                                <span className="grid h-7 min-w-9 place-items-center rounded bg-muted px-1 text-xs font-semibold" dir="ltr">
                                  {oc.code}
                                </span>
                                <span className="flex-1">{oc.label}</span>
                                {m?.code === oc.code && <Check className="size-4 text-brand" />}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
              {m && c?.late && (
                <div className="mt-2 flex items-center gap-2 ps-12 text-sm">
                  <span className="text-muted-foreground">{t("minutesLate")}</span>
                  <Button type="button" variant="outline" size="icon" className="size-9" disabled={!canEdit || (m.minutesLate ?? 1) <= 1} onClick={() => setMark(s.id, { code: m.code, minutesLate: Math.max(1, (m.minutesLate ?? 1) - 5) })} aria-label={t("lessMinutes")}>
                    <Minus className="size-4" />
                  </Button>
                  <span className="min-w-14 text-center font-semibold tabular-nums" data-testid="minutes">
                    {t("minutesShort", { n: m.minutesLate ?? 0 })}
                  </span>
                  <Button type="button" variant="outline" size="icon" className="size-9" disabled={!canEdit || (m.minutesLate ?? 0) >= 240} onClick={() => setMark(s.id, { code: m.code, minutesLate: Math.min(240, (m.minutesLate ?? 0) + 5) })} aria-label={t("moreMinutes")}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="sticky bottom-20 z-20 rounded-xl border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur sm:bottom-3 sm:me-40 sm:px-4">
          <div className="flex min-h-9 items-center justify-between gap-3">
            <SaveStatus state={state} waiting={waiting} onRetry={() => void flush()} auditNotice={auditNotice} />
            {doneHref}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveStatus({ state, waiting, onRetry, auditNotice }: { state: SaveState; waiting: number; onRetry: () => void; auditNotice: boolean }) {
  const t = useTranslations("attendance.take");
  if (state === "offline")
    return (
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-[oklch(0.45_0.12_65)]" data-testid="save-state" data-state="offline" role="status">
        <span className="flex min-w-0 items-center gap-2">
          <CloudOff className="size-4 shrink-0" />
          <span className="min-w-0">{t("offline", { n: waiting })}</span>
        </span>
        <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          {t("retryNow")}
        </Button>
      </div>
    );
  if (state === "error")
    return (
      <span className="flex items-center gap-2 text-sm text-danger" data-testid="save-state" data-state="error" role="status">
        <TriangleAlert className="size-4" />
        {t("saveRefused")}
      </span>
    );
  if (state === "saving" || state === "pending")
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="save-state" data-state={state} role="status">
        <Loader2 className="size-4 animate-spin" />
        {t("saving", { n: waiting })}
      </span>
    );
  if (state === "saved")
    return (
      <span className="flex items-center gap-2 text-sm font-medium text-success" data-testid="save-state" data-state="saved" role="status">
        <Check className="size-4" />
        {auditNotice ? t("savedAudited") : t("saved")}
      </span>
    );
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="save-state" data-state="idle" role="status">
      <ChevronDown className="size-4 rotate-180 opacity-0" aria-hidden />
      {t("autosave")}
    </span>
  );
}
