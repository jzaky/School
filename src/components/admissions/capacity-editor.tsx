"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Minus, Plus, Save } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCapacityAction } from "@/server/admissions/actions";
import { SECTION_LETTERS } from "@/server/admissions/rules";

type Row = { grade: number; label: string; sectionSeats: number[]; seatFee: string; capacity: number | null; enrolled: number; holding: number; offered: number; waitlisted: number; free: number | null };

/** Places per grade and section for a year, the seat booking amount, and live counts of enrolled, held and offered seats. */
export function CapacityEditor({ yearId, rows, editable, current }: { yearId: string; rows: Row[]; editable: boolean; current: boolean }) {
  const t = useTranslations("admissions.capacity");
  const tm = useTranslations("admissions");
  const router = useRouter();
  const [state, setState] = useState(rows.map((r) => ({ grade: r.grade, sectionSeats: r.sectionSeats, seatFee: r.seatFee })));
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(state) !== JSON.stringify(rows.map((r) => ({ grade: r.grade, sectionSeats: r.sectionSeats, seatFee: r.seatFee })));
  const set = (g: number, patch: Partial<(typeof state)[number]>) => setState((s) => s.map((x) => (x.grade === g ? { ...x, ...patch } : x)));
  const save = () =>
    start(async () => {
      const r = await saveCapacityAction({ academicYearId: yearId, rows: state.map((x) => ({ gradeLevel: x.grade, sectionSeats: x.sectionSeats, seatFee: x.seatFee })) });
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(t("saved"));
      router.refresh();
    });
  const totalCap = state.reduce((s, x) => s + x.sectionSeats.reduce((a, b) => a + b, 0), 0);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{current ? t("enrolledCurrent") : t("enrolledNext")}</p>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm" data-testid="capacity-table">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("grade")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("sections")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("capacity")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("enrolled")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("holding")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("offered")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("free")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("waitlisted")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("seatFee")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const s = state.find((x) => x.grade === r.grade)!;
                const cap = s.sectionSeats.reduce((a, b) => a + b, 0);
                const free = s.sectionSeats.length ? cap - r.enrolled - r.holding - r.offered : null;
                return (
                  <tr key={r.grade} className={cn(!s.sectionSeats.length && "text-muted-foreground")} data-testid={`cap-row-${r.grade}`}>
                    <td className="px-3 py-2 font-medium text-foreground">{r.label}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {s.sectionSeats.map((n, i) => (
                          <label key={i} className="flex items-center gap-1 rounded-md border bg-muted/30 px-1.5 py-0.5 text-xs">
                            <span className="font-semibold">{SECTION_LETTERS[i]}</span>
                            {editable ? (
                              <input type="number" min={1} max={60} value={n} onChange={(e) => set(r.grade, { sectionSeats: s.sectionSeats.map((x, j) => (j === i ? Math.max(1, Math.min(60, Number(e.target.value) || 1)) : x)) })} className="w-11 bg-transparent text-center tabular-nums outline-none" aria-label={t("seatsIn", { section: SECTION_LETTERS[i] })} dir="ltr" />
                            ) : (
                              <span className="tabular-nums">{n}</span>
                            )}
                          </label>
                        ))}
                        {editable && (
                          <>
                            <Button type="button" size="icon" variant="ghost" className="size-6" disabled={s.sectionSeats.length >= 16} onClick={() => set(r.grade, { sectionSeats: [...s.sectionSeats, s.sectionSeats[s.sectionSeats.length - 1] ?? 24] })} aria-label={t("addSection")} data-testid={`add-section-${r.grade}`}>
                              <Plus className="size-3.5" />
                            </Button>
                            {s.sectionSeats.length > 0 && (
                              <Button type="button" size="icon" variant="ghost" className="size-6" onClick={() => set(r.grade, { sectionSeats: s.sectionSeats.slice(0, -1) })} aria-label={t("removeSection")}>
                                <Minus className="size-3.5" />
                              </Button>
                            )}
                          </>
                        )}
                        {!s.sectionSeats.length && <span className="text-xs">{t("notOffered")}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{s.sectionSeats.length ? cap : "-"}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.enrolled}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.holding}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.offered}</td>
                    <td className={cn("px-3 py-2 text-end font-semibold tabular-nums", free !== null && free <= 0 ? "text-danger" : free !== null ? "text-success" : "")}>{free === null ? "-" : free}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.waitlisted}</td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">{t("currency")}</span>
                          <Input value={s.seatFee} onChange={(e) => set(r.grade, { seatFee: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="0.00" inputMode="decimal" dir="ltr" className="h-8 w-28" disabled={!s.sectionSeats.length} title={s.sectionSeats.length ? undefined : t("feeNeedsSection")} aria-label={t("seatFee")} />
                        </div>
                      ) : (
                        <span className="tabular-nums">{s.seatFee ? tm("money", { amount: s.seatFee }) : "-"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("totalPlaces", { n: totalCap })}</p>
        {editable && (
          <Button size="sm" disabled={pending || !dirty} onClick={save} data-testid="save-capacity">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("save")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("feeNote")}</p>
    </div>
  );
}
