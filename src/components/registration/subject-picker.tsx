"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, DoorOpen, GraduationCap, Loader2, Lock, Scale, Send, Target } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/app/badges";
import { checkChoices, missingPrerequisites, type OfferingLite } from "@/lib/registration";
import { electiveImpactAction, saveRegistrationAction } from "@/server/registration/actions";
import type { ElectiveImpact } from "@/server/pathway-engine/levels-service";
import { LevelChip } from "@/components/pathway-engine/level-chip";
import { useRegError } from "./admin-controls";

export type PickerOffering = OfferingLite & {
  name: string;
  notes: string | null;
  periods: number;
  /** Class the student sits in for this subject, when allocated. */
  placement: string | null;
  teacher: string | null;
  /** An Advanced Placement course. */
  isAP: boolean;
  /** Linked to a curriculum course, so universities can be checked. */
  linked: boolean;
};

type Opt = PickerOffering;

export function SubjectPicker({
  studentId,
  yearId,
  nextYear,
  offerings,
  initial,
  priorCodes,
  codeNames,
  canEdit,
  impact: initialImpact,
  self,
  levelsHref,
}: {
  studentId: string;
  yearId: string | null;
  nextYear: boolean;
  offerings: PickerOffering[];
  /** Currently registered option subject ids. */
  initial: string[];
  priorCodes: string[];
  codeNames: Record<string, string>;
  canEdit: boolean;
  impact: ElectiveImpact | null;
  /** The student is looking at their own choices. */
  self: boolean;
  levelsHref: string;
}) {
  const t = useTranslations("registration");
  const locale = useLocale();
  const err = useRegError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const blocks = useMemo(() => {
    const map = new Map<string, Opt[]>();
    for (const o of offerings) if (o.kind === "OPTION") map.set(o.optionBlock ?? "A", [...(map.get(o.optionBlock ?? "A") ?? []), o]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [offerings]);
  const initialByBlock = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of offerings) if (o.kind === "OPTION" && initial.includes(o.subjectId)) m[o.optionBlock ?? "A"] = o.subjectId;
    return m;
  }, [offerings, initial]);
  const [chosen, setChosen] = useState<Record<string, string>>(initialByBlock);
  const chosenIds = Object.values(chosen);
  const prior = useMemo(() => new Set(priorCodes), [priorCodes]);
  const errors = checkChoices(offerings, chosenIds, prior);
  const missingBlocks = errors.filter((e) => e.code === "missingBlock").length;
  const hardErrors = errors.filter((e) => e.code !== "missingBlock");
  const core = offerings.filter((o) => o.kind === "CORE");
  const taking = new Set([...core, ...offerings.filter((o) => chosenIds.includes(o.subjectId))].map((o) => o.code.toUpperCase()));
  const changed = blocks.some(([b]) => (chosen[b] ?? null) !== (initialByBlock[b] ?? null));
  const complete = blocks.every(([b]) => initialByBlock[b]);
  const names = (codes: string[]) => codes.map((c) => codeNames[c] ?? c).join(t("listSep"));

  // University impact: recomputed by the engine when the choices change (other blocks affect each option).
  const [impact, setImpact] = useState<ElectiveImpact | null>(initialImpact);
  const [updating, setUpdating] = useState(false);
  const firstRun = useRef(true);
  const key = chosenIds.slice().sort().join(",");
  useEffect(() => {
    if (!initialImpact) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    let live = true;
    setUpdating(true);
    const timer = setTimeout(async () => {
      const res = await electiveImpactAction({ studentId, yearId, chosen: key ? key.split(",") : [] }).catch(() => null);
      if (!live) return;
      setUpdating(false);
      if (res && res.ok) setImpact(res.impact);
      else toast.error(t("impact.error"));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, initialImpact, studentId, yearId, t]);

  const totalTargets = impact?.targetIds.length ?? 0;
  const uniName = (id: string) => {
    const p = impact?.programs[id];
    return p ? (locale === "ar" ? p.universityAr || p.universityEn : p.universityEn) : "";
  };
  const optImpact = (o: Opt) => impact?.options[o.subjectId] ?? null;

  const submit = () =>
    start(async () => {
      const res = await saveRegistrationAction({ studentId, optionSubjectIds: chosenIds, yearId });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(nextYear ? t("next.submitted") : t("submitted"));
      router.refresh();
    });

  const errorText = (e: (typeof errors)[number]) => {
    if (e.code === "missingBlock") return t("errMissingBlock", { block: e.block });
    if (e.code === "sameBlock") return t("errSameBlock", { block: e.block });
    if (e.code === "prerequisite") return t("errPrereq", { subject: offerings.find((o) => o.subjectId === e.subjectId)?.name ?? "", missing: names(e.missing) });
    return t("error.INVALID");
  };

  // Union over the chosen options, for the summary.
  const chosenTargets = new Set(chosenIds.flatMap((id) => impact?.options[id]?.targets ?? []));
  const chosenPrograms = new Set(chosenIds.flatMap((id) => impact?.options[id]?.programs ?? []));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {impact && (
          <div className="flex flex-col gap-2 rounded-xl border border-brand/20 bg-brand-soft/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="impact-intro">
            <p className="flex items-start gap-2">
              <GraduationCap className="mt-0.5 size-4 shrink-0 text-brand" />
              <span>
                {totalTargets > 0 ? t(`impact.intro.${self ? "self" : "other"}`, { targets: totalTargets, checked: impact.checked }) : t(`impact.introNoTargets.${self ? "self" : "other"}`, { checked: impact.checked })}
              </span>
            </p>
            <Link href={levelsHref} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:underline" data-testid="levels-link">
              {t("impact.seeLevels")}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          </div>
        )}
        <section className="rounded-xl border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="text-sm font-semibold">{t("coreTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("coreAuto")}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="core-list">
            {core.map((o) => (
              <li key={o.subjectId} className="flex items-start gap-2 rounded-lg border bg-muted/20 p-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{o.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{o.placement ? [o.placement, o.teacher].filter(Boolean).join(" · ") : t("periodsN", { count: o.periods })}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {blocks.map(([block, unordered]) => {
          const pairs = apPairs(unordered, impact);
          const paired = pairs.flatMap((p) => [p.ap, p.regular]);
          const options = [...paired, ...unordered.filter((o) => !paired.includes(o))];
          return (
            <section key={block} className="rounded-xl border bg-card p-4 shadow-xs sm:p-5" data-testid={`block-${block}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{t("blockN", { block })}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{canEdit ? t("pickOne") : t("yourChoice")}</p>
                </div>
                {updating && impact && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
                    <Loader2 className="size-3 animate-spin" />
                    {t("impact.updating")}
                  </span>
                )}
              </div>
              {pairs.map(({ ap, regular }) => {
                const a = optImpact(ap);
                const r = optImpact(regular);
                if (!a || !r) return null;
                const extra = a.programs.length - r.programs.length;
                const apOnly = a.targets.filter((id) => !r.targets.includes(id));
                const both = a.targets.filter((id) => r.targets.includes(id));
                return (
                  <div key={`${ap.subjectId}:${regular.subjectId}`} className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2.5 text-sm dark:border-violet-900 dark:bg-violet-950/30" data-testid="ap-compare">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Scale className="size-4 text-violet-700 dark:text-violet-300" />
                      {t("impact.compareTitle", { ap: ap.name, regular: regular.name })}
                    </div>
                    <p className="mt-1 text-sm">
                      {extra > 0 ? t("impact.compareMore", { ap: ap.name, regular: regular.name, n: extra }) : extra < 0 ? t("impact.compareMore", { ap: regular.name, regular: ap.name, n: -extra }) : t("impact.compareSame", { ap: ap.name, regular: regular.name })}
                    </p>
                    {(apOnly.length > 0 || both.length > 0) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[apOnly.length ? t(`impact.apOnly.${self ? "self" : "other"}`, { names: apOnly.map(uniName).join(t("listSep")), ap: ap.name }) : null, both.length ? t("impact.either", { names: both.map(uniName).join(t("listSep")) }) : null].filter(Boolean).join(" ")}
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("blockN", { block })}>
                {options.map((o) => {
                  const selected = chosen[block] === o.subjectId;
                  const takingIfChosen = new Set([...taking].filter((c) => !options.some((x) => x.code.toUpperCase() === c)));
                  takingIfChosen.add(o.code.toUpperCase());
                  const missing = missingPrerequisites(o, takingIfChosen, prior);
                  const im = optImpact(o);
                  const hasApSibling = !o.isAP && options.some((x) => x.isAP && impact?.families[x.subjectId] && impact.families[x.subjectId] === impact.families[o.subjectId]);
                  return (
                    <button
                      key={o.subjectId}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={!canEdit || pending}
                      onClick={() => setChosen((c) => ({ ...c, [block]: o.subjectId }))}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg border p-3 text-start transition-colors",
                        selected ? "border-brand bg-brand-soft/60 ring-1 ring-brand/30" : "hover:bg-muted/40",
                        !canEdit && !selected && "opacity-60",
                        !canEdit && "cursor-default",
                      )}
                      data-testid={`option-${o.code}`}
                    >
                      <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", selected ? "border-brand bg-brand text-white" : "border-muted-foreground/40")}>{selected && <Check className="size-3" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium">{o.name}</span>
                          {o.isAP && (
                            <Pill tone="violet" className="px-1.5 font-semibold">
                              <span data-testid="ap-badge">{t("impact.apBadge")}</span>
                            </Pill>
                          )}
                          {hasApSibling && <Pill tone="neutral">{t("impact.regularBadge")}</Pill>}
                        </span>
                        <span className="block text-xs text-muted-foreground">{t("periodsN", { count: o.periods })}</span>
                        {o.notes && <span className="mt-0.5 block text-xs text-muted-foreground">{o.notes}</span>}
                        {o.prerequisites.length > 0 && (
                          <span className={cn("mt-1 flex items-center gap-1 text-xs", missing.length ? "text-danger" : "text-success")}>
                            {missing.length ? <AlertTriangle className="size-3" /> : <Check className="size-3" />}
                            {missing.length ? t("needs", { subjects: names(missing) }) : t("prereqMet", { subjects: names(o.prerequisites) })}
                          </span>
                        )}
                        {impact && o.linked && im && (
                          <span className={cn("mt-2 block space-y-1 border-t pt-2 text-xs transition-opacity", updating && "opacity-60")} data-testid="option-impact">
                            {totalTargets > 0 && (
                              <span className={cn("flex items-start gap-1.5", im.targets.length ? "font-medium text-brand" : "text-muted-foreground")}>
                                <Target className="mt-px size-3.5 shrink-0" />
                                <span>
                                  <span data-testid="needed-for">{im.targets.length ? t(`impact.neededFor.${self ? "self" : "other"}`, { n: im.targets.length, total: totalTargets }) : t(`impact.neededNone.${self ? "self" : "other"}`)}</span>
                                  {im.targets.length > 0 && (
                                    <span className="mt-1 flex flex-wrap gap-1 font-normal">
                                      {im.targets.map((id) => {
                                        const line = im.lines.find((l) => l.programId === id);
                                        return (
                                          <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pe-0.5 ps-2 text-[11px] text-foreground">
                                            {uniName(id)}
                                            {line && <LevelChip guide={{ cls: line.cls, curriculum: "AMERICAN", basis: "quote", apCourses: [], effectiveLevel: null, storedLevel: null }} />}
                                          </span>
                                        );
                                      })}
                                    </span>
                                  )}
                                </span>
                              </span>
                            )}
                            <span className={cn("flex items-center gap-1.5", im.programs.length ? "text-success" : "text-muted-foreground")} title={t("impact.keepsHint", { checked: impact.checked })}>
                              <DoorOpen className="size-3.5 shrink-0" />
                              <span data-testid="keeps-open">{im.programs.length ? t("impact.keepsOpen", { n: im.programs.length }) : t("impact.keepsNone")}</span>
                            </span>
                          </span>
                        )}
                        {impact && !o.linked && <span className="mt-2 block border-t pt-2 text-xs text-muted-foreground">{t("impact.notLinked")}</span>}
                        {selected && o.placement && !changed && <span className="mt-1 block text-xs font-medium text-brand">{[o.placement, o.teacher].filter(Boolean).join(" · ")}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <aside className="h-fit space-y-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5 lg:sticky lg:top-20" data-testid="summary">
        <h2 className="text-sm font-semibold">{t("summaryTitle")}</h2>
        <ul className="space-y-1 text-sm">
          {core.map((o) => (
            <li key={o.subjectId} className="flex items-center justify-between gap-2">
              <span className="truncate">{o.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t("core")}</span>
            </li>
          ))}
          {blocks.map(([block, options]) => {
            const o = options.find((x) => x.subjectId === chosen[block]);
            return (
              <li key={block} className="flex items-center justify-between gap-2">
                <span className={cn("flex min-w-0 items-center gap-1.5", !o && "text-muted-foreground")}>
                  <span className="truncate">{o ? o.name : t("notChosen")}</span>
                  {o?.isAP && <Pill tone="violet" className="px-1.5 py-0 text-[10px] font-semibold">{t("impact.apBadge")}</Pill>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{t("blockN", { block })}</span>
              </li>
            );
          })}
        </ul>
        <div className="text-xs text-muted-foreground">{t("periodsTotal", { count: offerings.filter((o) => o.kind === "CORE" || chosenIds.includes(o.subjectId)).reduce((n, o) => n + o.periods, 0) })}</div>
        {impact && (
          <div className={cn("space-y-1 rounded-lg bg-muted/40 p-2.5 text-xs transition-opacity", updating && "opacity-60")} data-testid="impact-summary">
            <div className="font-medium">{t("impact.summaryTitle")}</div>
            {chosenIds.length === 0 ? (
              <div className="text-muted-foreground">{t("impact.summaryEmpty")}</div>
            ) : (
              <>
                {totalTargets > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Target className="size-3.5 text-brand" />
                    {t(`impact.summaryTargets.${self ? "self" : "other"}`, { n: chosenTargets.size, total: totalTargets })}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <DoorOpen className="size-3.5 text-success" />
                  {t("impact.summaryPrograms", { n: chosenPrograms.size })}
                </div>
              </>
            )}
          </div>
        )}
        {canEdit && missingBlocks > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="blocks-left">
            {t("impact.blocksLeft", { done: blocks.length - missingBlocks, total: blocks.length })}
          </p>
        )}
        {hardErrors.length > 0 && canEdit && (
          <ul className="space-y-1 rounded-lg bg-danger-soft/50 p-2.5 text-xs text-danger" data-testid="choice-errors">
            {hardErrors.map((e, i) => (
              <li key={i}>{errorText(e)}</li>
            ))}
          </ul>
        )}
        {canEdit ? (
          complete && !changed ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success" data-testid="registered-state">
              <CheckCircle2 className="size-4" />
              {nextYear ? t("next.registeredState") : t("registeredState")}
            </p>
          ) : (
            <Button className="w-full" onClick={submit} disabled={pending || errors.length > 0} data-testid="submit-registration">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {complete ? t("saveChanges") : nextYear ? t("next.submit") : t("submit")}
            </Button>
          )
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {t("readOnly")}
          </p>
        )}
      </aside>
    </div>
  );
}

/** AP and regular versions of the same subject in one block (for example AP Physics 1 and Physics). */
function apPairs(options: Opt[], impact: ElectiveImpact | null): Array<{ ap: Opt; regular: Opt }> {
  if (!impact) return [];
  const out: Array<{ ap: Opt; regular: Opt }> = [];
  for (const ap of options.filter((o) => o.isAP && impact.families[o.subjectId])) {
    const regular = options.find((o) => !o.isAP && impact.families[o.subjectId] === impact.families[ap.subjectId]);
    if (regular && !out.some((p) => p.regular.subjectId === regular.subjectId)) out.push({ ap, regular });
  }
  return out;
}
