"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronDown, GripVertical, Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/app/badges";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { loadBoardColumnAction, moveStageAction } from "@/server/admissions/actions";
import type { BoardFilters, Card } from "@/server/admissions/queries";
import { nextMoves, type MoveAction, type StageDef } from "@/server/admissions/stages";
import { useGrade } from "./ui";

type Column = { key: string; label: string; total: number; cards: Card[] };

const ACTION_PARAM: Record<MoveAction, string> = { offer: "offer", paid: "paid", enroll: "enroll", reason: "close" };

/** The admissions board: one column per stage, paged per column, drag or use the menu to move an application. */
export function AdmissionsBoard({ columns, filters, manage, stagesCfg, authorityShort }: { columns: Column[]; filters: BoardFilters; manage: boolean; stagesCfg: StageDef[]; authorityShort: string }) {
  const t = useTranslations("admissions.board");
  const router = useRouter();
  const [extra, setExtra] = useState<Record<string, { cards: Card[]; next: number | null }>>({});
  const [local, setLocal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const all = columns.flatMap((c) => [...c.cards, ...(extra[c.key]?.cards ?? [])]);
  const stageOf = (c: Card) => local[c.id] ?? c.stage;
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label || k;

  const move = (card: Card, to: string) => {
    if (!manage) return;
    const from = stageOf(card);
    if (from === to) return;
    const opt = nextMoves(from, stagesCfg, { seatFeeRequired: card.feeDue }).find((m) => m.key === to);
    if (!opt) return void toast.error(t("cannotMove", { from: labelOf(from), to: labelOf(to) }));
    // Moves that need details (an offer, a payment, enrollment, a reason) open the application.
    if (opt.action) return router.push(`/admissions/applications/${card.id}?action=${ACTION_PARAM[opt.action]}&to=${to}`);
    setLocal((m) => ({ ...m, [card.id]: to }));
    start(async () => {
      const r = await moveStageAction({ applicationId: card.id, to });
      if (!r.ok) {
        setLocal((m) => {
          const n = { ...m };
          delete n[card.id];
          return n;
        });
        return void toast.error(t("moveFailed"));
      }
      toast.success(t("moved", { stage: labelOf(to) }));
      router.refresh();
    });
  };

  const more = async (key: string) => {
    setLoading(key);
    try {
      const col = columns.find((c) => c.key === key)!;
      const cursor = extra[key]?.next ?? col.cards.length;
      const r = await loadBoardColumnAction({ stage: key, filters, cursor });
      if (!r.ok) return void toast.error(t("moveFailed"));
      setExtra((e) => ({ ...e, [key]: { cards: [...(e[key]?.cards ?? []), ...r.cards], next: r.nextCursor } }));
    } finally {
      setLoading(null);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const card = all.find((c) => c.id === e.active.id);
    const to = e.over?.id as string | undefined;
    if (card && to) move(card, to);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" data-testid="admissions-board">
        <div className="flex gap-3">
          {columns.map((col) => {
            const cards = all.filter((c) => stageOf(c) === col.key);
            const shown = col.cards.length + (extra[col.key]?.cards.length ?? 0);
            const hasMore = extra[col.key] ? extra[col.key].next !== null : col.total > col.cards.length;
            return (
              <BoardColumn key={col.key} id={col.key} label={col.label} total={col.total} empty={t("columnEmpty")}>
                {cards.map((c) => (
                  <BoardCard key={c.id} card={{ ...c, stage: stageOf(c) }} manage={manage} busy={pending} stagesCfg={stagesCfg} labelOf={labelOf} onMove={(to) => move(c, to)} authorityShort={authorityShort} />
                ))}
                {hasMore && (
                  <Button variant="ghost" size="sm" className="w-full" disabled={loading === col.key} onClick={() => more(col.key)} data-testid={`more-${col.key}`}>
                    {loading === col.key && <Loader2 className="size-3.5 animate-spin" />}
                    {t("showMore", { shown, total: col.total })}
                  </Button>
                )}
              </BoardColumn>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}

function BoardColumn({ id, label, total, empty, children }: { id: string; label: string; total: number; empty: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={cn("flex w-64 shrink-0 flex-col rounded-xl border bg-muted/40 p-2 transition", isOver && "border-brand bg-brand-soft/40")} data-testid={`col-${id}`}>
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <h3 className="truncate text-xs font-semibold">{label}</h3>
        <span className="rounded-full bg-card px-2 text-[11px] tabular-nums text-muted-foreground">{total}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2">{total ? children : <p className="px-1 py-6 text-center text-xs text-muted-foreground">{empty}</p>}</div>
    </section>
  );
}

function BoardCard({ card, manage, busy, stagesCfg, labelOf, onMove, authorityShort }: { card: Card; manage: boolean; busy: boolean; stagesCfg: StageDef[]; labelOf: (k: string) => string; onMove: (to: string) => void; authorityShort: string }) {
  const t = useTranslations("admissions.board");
  const tf = useTranslations("admissions.flags");
  const locale = useLocale();
  const grade = useGrade();
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: card.id, disabled: !manage });
  const moves = manage ? nextMoves(card.stage, stagesCfg, { seatFeeRequired: card.feeDue }) : [];
  const name = locale === "ar" ? card.nameAr : card.nameEn;
  const deadline = card.offerDeadline ? new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" }).format(new Date(card.offerDeadline)) : null;
  return (
    <article
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("rounded-lg border bg-card p-2.5 text-xs shadow-xs", isDragging && "z-10 opacity-80 shadow-lg")}
      data-testid="adm-card"
    >
      <div className="flex items-start gap-1.5">
        {manage && (
          <button type="button" className="mt-0.5 cursor-grab touch-none text-muted-foreground active:cursor-grabbing" aria-label={t("drag")} {...listeners} {...attributes}>
            <GripVertical className="size-3.5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/admissions/applications/${card.id}`} className="block truncate text-sm font-medium hover:text-brand" data-testid="adm-card-link">
            {name}
          </Link>
          <div className="truncate text-muted-foreground">
            {grade(card.grade)} · <span dir="ltr">{card.number}</span>
          </div>
        </div>
        {manage && moves.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6" disabled={busy} aria-label={t("moveTo")} data-testid="card-menu">
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("moveTo")}</DropdownMenuLabel>
              {moves.map((m) => (
                <DropdownMenuItem key={m.key} onSelect={() => onMove(m.key)} data-testid={`move-${m.key}`}>
                  {labelOf(m.key)}
                  {m.action && <span className="ms-auto text-[10px] text-muted-foreground">{t(`needs.${m.action}`)}</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {card.ageFlag && <Pill tone="warning" className="text-[10px]">{tf(card.ageFlag === "UNDER" ? "under" : "over")}</Pill>}
        {card.duplicate && <Pill tone="danger" className="text-[10px]">{tf("duplicate")}</Pill>}
        {card.sibling && <Pill tone="info" className="text-[10px]">{tf("sibling")}</Pill>}
        {card.staffChild && <Pill tone="info" className="text-[10px]">{tf("staffChild")}</Pill>}
        {card.support && <Pill tone="violet" className="text-[10px]">{tf("support")}</Pill>}
        {card.missing > 0 && card.stage !== "ENROLLED" && <Pill tone="warning" className="text-[10px]">{tf("missing", { n: card.missing })}</Pill>}
        {deadline && card.stage === "OFFER_MADE" && <Pill tone={card.offerExpired ? "danger" : "gold"} className="text-[10px] tabular-nums">{card.offerExpired ? tf("expired") : tf("due", { date: deadline })}</Pill>}
        {card.outcome && card.stage !== "ENROLLED" && <Pill tone={card.outcome === "NOT_RECOMMENDED" ? "danger" : "success"} className="text-[10px]">{tf(`outcome.${card.outcome}`)}</Pill>}
        {card.awaitingAuthority && <Pill tone="warning" className="text-[10px]" >{tf("awaiting", { authority: authorityShort })}</Pill>}
      </div>
    </article>
  );
}
