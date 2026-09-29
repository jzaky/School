"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DndContext, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Check, ChevronDown, GripVertical, ListChecks, Loader2, Send } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pill } from "@/components/app/badges";
import {
  assignRecommendationAction,
  changeStageAction,
  generateTasksAction,
  markLetterSentAction,
  saveNotesAction,
  setCounselorAction,
  setDecisionPlanAction,
  setItemDueAction,
  setItemStatusAction,
  startApplicationAction,
} from "@/server/applications/actions";
import { BOARD_STAGES, canTransition, nextStages, type Stage } from "@/server/applications/types";

type Opt = { value: string; label: string };

function useRun() {
  const t = useTranslations("applications");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error === "invalid_transition" ? t("invalidTransition") : t("error"));
      else {
        if (success) toast.success(success);
        router.refresh();
      }
    });
  return { run, pending, t, router };
}

/** "Start application" on a shortlist entry, or "Open application" when one exists. */
export function StartApplicationButton({ shortlistEntryId, studentId, applicationId }: { shortlistEntryId: string; studentId?: string | null; applicationId?: string | null }) {
  const t = useTranslations("applications");
  const router = useRouter();
  const [pending, start] = useTransition();
  if (applicationId)
    return (
      <Button asChild size="sm" variant="outline" className="h-8" data-testid="open-application">
        <Link href={`/career/applications/${applicationId}`}>
          <Send className="size-3.5" />
          {t("openApplication")}
        </Link>
      </Button>
    );
  return (
    <Button
      size="sm"
      className="h-8"
      disabled={pending}
      data-testid="start-application"
      onClick={() =>
        start(async () => {
          const r = await startApplicationAction({ shortlistEntryId, studentId: studentId ?? undefined });
          if (!r.ok) return void toast.error(t("error"));
          toast.success(t("started"));
          router.push(`/career/applications/${r.id}`);
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
      {t("startApplication")}
    </Button>
  );
}

/** Stage control. Staff get every allowed transition; students only up to "submitted". */
export function StageControl({ applicationId, stage, actor }: { applicationId: string; stage: Stage; actor: "student" | "staff" }) {
  const { run, pending, t } = useRun();
  const options = nextStages(stage, actor);
  if (!options.length) return <p className="text-xs text-muted-foreground">{actor === "student" ? t("studentStageHint") : t("noNextStage")}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="stage-control">
      <span className="text-xs text-muted-foreground">{t("moveTo")}</span>
      {options.map((s) => (
        <Button key={s} size="sm" variant={["REJECTED", "RESEARCHING", "SHORTLISTED"].includes(s) || TRANSITION_BACK(stage, s) ? "outline" : "default"} disabled={pending} onClick={() => run(() => changeStageAction({ applicationId, stage: s }), t("stageUpdated"))} data-testid={`stage-to-${s}`}>
          {t(`stage.${s}`)}
        </Button>
      ))}
      {actor === "student" && <p className="w-full text-xs text-muted-foreground">{t("studentStageHint")}</p>}
    </div>
  );
}
const ORDER: Stage[] = ["RESEARCHING", "SHORTLISTED", "PREPARING", "SUBMITTED", "INTERVIEW", "WAITLISTED", "OFFER", "ACCEPTED", "ENROLLED"];
const TRANSITION_BACK = (from: Stage, to: Stage) => ORDER.indexOf(to) < ORDER.indexOf(from);

export function ItemStatusSelect({ itemId, status, statuses }: { itemId: string; status: string; statuses: string[] }) {
  const { run, pending, t } = useRun();
  return (
    <Select value={status} onValueChange={(v) => run(() => setItemStatusAction({ itemId, status: v }))} disabled={pending}>
      <SelectTrigger size="sm" className="h-8 w-36" data-testid="item-status" aria-label={t("stageLabel")}>
        <SelectValue>{t(`itemStatus.${status}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {statuses.map((s) => (
          <SelectItem key={s} value={s}>
            {t(`itemStatus.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Student checkbox: done or not done. */
export function ItemCheck({ itemId, done, label }: { itemId: string; done: boolean; label: string }) {
  const { run, pending } = useRun();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      disabled={pending}
      data-testid="item-check"
      onClick={() => run(() => setItemStatusAction({ itemId, status: done ? "TODO" : "DONE" }))}
      className={cn("grid size-5 shrink-0 place-items-center rounded border transition", done ? "border-success bg-success text-white" : "bg-card hover:border-brand")}
    >
      {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : done && <Check className="size-3.5" />}
    </button>
  );
}

export function AssignTeacher({ itemId, teachers, current }: { itemId: string; teachers: Opt[]; current: string | null }) {
  const { run, pending, t } = useRun();
  const [teacher, setTeacher] = useState<string>("");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="assign-teacher">
      <Select value={teacher} onValueChange={setTeacher}>
        <SelectTrigger size="sm" className="h-8 w-48 max-w-full">
          <SelectValue placeholder={t("chooseTeacher")} />
        </SelectTrigger>
        <SelectContent>
          {teachers.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.value === current}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="h-8" disabled={!teacher || pending} onClick={() => run(() => assignRecommendationAction({ itemId, teacherId: teacher }), t("letterRequested"))} data-testid="request-letter">
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {current ? t("reassign") : t("requestLetter")}
      </Button>
    </div>
  );
}

export function DueInput({ itemId, value }: { itemId: string; value: string | null }) {
  const { run, pending, t } = useRun();
  return (
    <Input
      type="date"
      defaultValue={value ?? ""}
      disabled={pending}
      aria-label={t("setDue")}
      title={t("lockedHint")}
      className="h-8 w-40"
      data-testid="item-due"
      onChange={(e) => run(() => setItemDueAction({ itemId, dueAt: e.target.value || null }), t("saved"))}
    />
  );
}

export function NotesForm({ applicationId, notes }: { applicationId: string; notes: string }) {
  const { run, pending, t } = useRun();
  const [value, setValue] = useState(notes);
  return (
    <div className="space-y-2">
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("notesPlaceholder")} rows={4} maxLength={4000} data-testid="app-notes" />
      <Button size="sm" disabled={pending || value === notes} onClick={() => run(() => saveNotesAction({ applicationId, notes: value }), t("saved"))} data-testid="save-notes">
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {t("saveNotes")}
      </Button>
    </div>
  );
}

export function GenerateTasksButton({ applicationIds, label, variant = "outline" }: { applicationIds: string[]; label: string; variant?: "outline" | "default" }) {
  const t = useTranslations("applications");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending || !applicationIds.length}
      data-testid="generate-tasks"
      onClick={() =>
        start(async () => {
          const r = await generateTasksAction({ applicationIds });
          if (!r.ok) return void toast.error(t("error"));
          toast.success(t("generated", { created: r.created, archived: r.archived }));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
      {label}
    </Button>
  );
}

export function PlanSelect({ applicationId, value, options }: { applicationId: string; value: string | null; options: Opt[] }) {
  const { run, pending, t } = useRun();
  return (
    <Select value={value ?? "auto"} onValueChange={(v) => run(() => setDecisionPlanAction({ applicationId, decisionPlan: v === "auto" ? null : v }), t("saved"))} disabled={pending}>
      <SelectTrigger size="sm" className="h-8 w-full" data-testid="decision-plan">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{t("decisionPlanAuto")}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CounselorSelect({ applicationId, value, options }: { applicationId: string; value: string | null; options: Opt[] }) {
  const { run, pending, t } = useRun();
  return (
    <Select value={value ?? "none"} onValueChange={(v) => run(() => setCounselorAction({ applicationId, counselorId: v === "none" ? null : v }), t("saved"))} disabled={pending}>
      <SelectTrigger size="sm" className="h-8 w-full" data-testid="counselor-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t("unassigned")}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MarkSentButton({ taskId }: { taskId: string }) {
  const { run, pending, t } = useRun();
  return (
    <Button size="sm" disabled={pending} onClick={() => run(() => markLetterSentAction({ taskId }), t("sent"))} data-testid="mark-sent">
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      {t("markSent")}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------

export type BoardCard = {
  id: string;
  stage: Stage;
  student: string;
  grade: number;
  university: string;
  program: string | null;
  route: string;
  counselor: string | null;
  deadline: { date: string; bucket: string; days: number | null } | null;
  done: number;
  total: number;
  dueSoon: number;
};

const URGENCY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = { overdue: "danger", urgent: "danger", soon: "warning", upcoming: "info", later: "neutral", none: "neutral" };
const column = (s: Stage): Stage => (s === "RESEARCHING" ? "SHORTLISTED" : s === "ENROLLED" ? "ACCEPTED" : s);

export function Board({ cards }: { cards: BoardCard[] }) {
  const t = useTranslations("applications");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [local, setLocal] = useState<Record<string, Stage>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const stageOf = (c: BoardCard) => local[c.id] ?? c.stage;
  const move = (card: BoardCard, to: Stage) => {
    const from = stageOf(card);
    if (column(from) === to) return;
    if (!canTransition(from, to, "staff")) return void toast.error(t("invalidTransition"));
    setLocal((m) => ({ ...m, [card.id]: to }));
    start(async () => {
      const r = await changeStageAction({ applicationId: card.id, stage: to });
      if (!r.ok) {
        setLocal((m) => {
          const n = { ...m };
          delete n[card.id];
          return n;
        });
        return void toast.error(r.error === "invalid_transition" ? t("invalidTransition") : t("error"));
      }
      toast.success(t("stageUpdated"));
      router.refresh();
    });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id as Stage | undefined;
    if (card && to) move(card, to);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" data-testid="application-board">
        <div className="flex gap-3">
          {BOARD_STAGES.map((s) => {
            const list = cards.filter((c) => column(stageOf(c)) === s);
            return (
              <Column key={s} stage={s} count={list.length} label={t(`stage.${s}`)} empty={t("columnEmpty")}>
                {list.map((c) => (
                  <Card key={c.id} card={{ ...c, stage: stageOf(c) }} onMove={(to) => move(c, to)} busy={pending} />
                ))}
              </Column>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

function Column({ stage, label, count, empty, children }: { stage: Stage; label: string; count: number; empty: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section ref={setNodeRef} className={cn("flex w-64 shrink-0 flex-col rounded-xl border bg-muted/40 p-2 transition", isOver && "border-brand bg-brand-soft/40")} data-testid={`column-${stage}`}>
      <header className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold">{label}</h3>
        <span className="rounded-full bg-card px-2 text-[11px] tabular-nums text-muted-foreground">{count}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2">{count ? children : <p className="px-1 py-6 text-center text-xs text-muted-foreground">{empty}</p>}</div>
    </section>
  );
}

function Card({ card, onMove, busy }: { card: BoardCard; onMove: (to: Stage) => void; busy: boolean }) {
  const t = useTranslations("applications");
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: card.id });
  const options = nextStages(card.stage, "staff");
  return (
    <article
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("rounded-lg border bg-card p-2.5 text-xs shadow-xs", isDragging && "z-10 opacity-80 shadow-lg")}
      data-testid="board-card"
    >
      <div className="flex items-start gap-1.5">
        <button type="button" className="mt-0.5 cursor-grab touch-none text-muted-foreground active:cursor-grabbing" aria-label={t("changeStage")} {...listeners} {...attributes}>
          <GripVertical className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/career/applications/${card.id}`} className="block truncate text-sm font-medium hover:text-brand">
            {card.student}
          </Link>
          <div className="truncate text-muted-foreground">{card.university}</div>
          {card.program && <div className="truncate text-muted-foreground">{card.program}</div>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6" disabled={busy || !options.length} aria-label={t("changeStage")} data-testid="card-stage-menu">
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("moveTo")}</DropdownMenuLabel>
            {options.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onMove(s)}>
                {t(`stage.${s}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Pill tone="info" className="text-[10px]">
          {t(`route.${card.route}`)}
        </Pill>
        {card.deadline && (
          <Pill tone={URGENCY_TONE[card.deadline.bucket] ?? "neutral"} className="text-[10px] tabular-nums">
            {card.deadline.date}
          </Pill>
        )}
        {card.dueSoon > 0 && (
          <Pill tone="warning" className="text-[10px]">
            {t("missingCount", { n: card.dueSoon })}
          </Pill>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{card.counselor ?? t("unassigned")}</span>
        <span className="tabular-nums">{t("progress", { done: card.done, total: card.total })}</span>
      </div>
    </article>
  );
}
