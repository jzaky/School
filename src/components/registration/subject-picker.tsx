"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, Loader2, Lock, Send } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { checkChoices, missingPrerequisites, type OfferingLite } from "@/lib/registration";
import { saveRegistrationAction } from "@/server/registration/actions";
import { useRegError } from "./admin-controls";

export type PickerOffering = OfferingLite & {
  name: string;
  notes: string | null;
  periods: number;
  /** Class the student sits in for this subject, when allocated. */
  placement: string | null;
  teacher: string | null;
};

export function SubjectPicker({
  studentId,
  offerings,
  initial,
  priorCodes,
  codeNames,
  canEdit,
}: {
  studentId: string;
  offerings: PickerOffering[];
  /** Currently registered option subject ids. */
  initial: string[];
  priorCodes: string[];
  codeNames: Record<string, string>;
  canEdit: boolean;
}) {
  const t = useTranslations("registration");
  const err = useRegError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const blocks = useMemo(() => {
    const map = new Map<string, PickerOffering[]>();
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
  const core = offerings.filter((o) => o.kind === "CORE");
  const taking = new Set([...core, ...offerings.filter((o) => chosenIds.includes(o.subjectId))].map((o) => o.code.toUpperCase()));
  const changed = blocks.some(([b]) => (chosen[b] ?? null) !== (initialByBlock[b] ?? null));
  const complete = blocks.every(([b]) => initialByBlock[b]);
  const names = (codes: string[]) => codes.map((c) => codeNames[c] ?? c).join(t("listSep"));

  const submit = () =>
    start(async () => {
      const res = await saveRegistrationAction({ studentId, optionSubjectIds: chosenIds });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("submitted"));
      router.refresh();
    });

  const errorText = (e: (typeof errors)[number]) => {
    if (e.code === "missingBlock") return t("errMissingBlock", { block: e.block });
    if (e.code === "sameBlock") return t("errSameBlock", { block: e.block });
    if (e.code === "prerequisite") return t("errPrereq", { subject: offerings.find((o) => o.subjectId === e.subjectId)?.name ?? "", missing: names(e.missing) });
    return t("error.INVALID");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
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

        {blocks.map(([block, options]) => (
          <section key={block} className="rounded-xl border bg-card p-4 shadow-xs sm:p-5" data-testid={`block-${block}`}>
            <h2 className="text-sm font-semibold">{t("blockN", { block })}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{canEdit ? t("pickOne") : t("yourChoice")}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("blockN", { block })}>
              {options.map((o) => {
                const selected = chosen[block] === o.subjectId;
                const takingIfChosen = new Set([...taking].filter((c) => !options.some((x) => x.code.toUpperCase() === c)));
                takingIfChosen.add(o.code.toUpperCase());
                const missing = missingPrerequisites(o, takingIfChosen, prior);
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
                      !canEdit && !selected && "opacity-50",
                      !canEdit && "cursor-default",
                    )}
                    data-testid={`option-${o.code}`}
                  >
                    <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", selected ? "border-brand bg-brand text-white" : "border-muted-foreground/40")}>{selected && <Check className="size-3" />}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">{t("periodsN", { count: o.periods })}</span>
                      {o.notes && <span className="mt-0.5 block text-xs text-muted-foreground">{o.notes}</span>}
                      {o.prerequisites.length > 0 && (
                        <span className={cn("mt-1 flex items-center gap-1 text-xs", missing.length ? "text-danger" : "text-success")}>
                          {missing.length ? <AlertTriangle className="size-3" /> : <Check className="size-3" />}
                          {missing.length ? t("needs", { subjects: names(missing) }) : t("prereqMet", { subjects: names(o.prerequisites) })}
                        </span>
                      )}
                      {selected && o.placement && !changed && <span className="mt-1 block text-xs font-medium text-brand">{[o.placement, o.teacher].filter(Boolean).join(" · ")}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
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
                <span className={cn("truncate", !o && "text-muted-foreground")}>{o ? o.name : t("notChosen")}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{t("blockN", { block })}</span>
              </li>
            );
          })}
        </ul>
        <div className="text-xs text-muted-foreground">{t("periodsTotal", { count: offerings.filter((o) => o.kind === "CORE" || chosenIds.includes(o.subjectId)).reduce((n, o) => n + o.periods, 0) })}</div>
        {errors.length > 0 && canEdit && (
          <ul className="space-y-1 rounded-lg bg-danger-soft/50 p-2.5 text-xs text-danger" data-testid="choice-errors">
            {errors.map((e, i) => (
              <li key={i}>{errorText(e)}</li>
            ))}
          </ul>
        )}
        {canEdit ? (
          complete && !changed ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success" data-testid="registered-state">
              <CheckCircle2 className="size-4" />
              {t("registeredState")}
            </p>
          ) : (
            <Button className="w-full" onClick={submit} disabled={pending || errors.length > 0} data-testid="submit-registration">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {complete ? t("saveChanges") : t("submit")}
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
