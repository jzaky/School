"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { approvePlanAction, requestPlanChangesAction } from "@/server/pathway-engine/actions";
import { recomputeCaseloadAction } from "@/server/transcripts/actions";
import { useTxErr } from "./picker";

type Opt = { value: string; label: string };
const ALL = "all";

export function DashboardFilters({ grades, curricula, counselors }: { grades: Opt[]; curricula: Opt[]; counselors: Opt[] }) {
  const t = useTranslations("transcripts.dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    start(() => router.replace(`${pathname}?${next.toString()}`));
  };
  const field = (key: string, label: string, opts: Opt[], allLabel: string) => (
    <Select value={sp.get(key) ?? ALL} onValueChange={(v) => set(key, v)}>
      <SelectTrigger className="w-full sm:w-48" aria-label={label} data-testid={`filter-${key}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      {field("grade", t("filter.grade"), grades, t("filter.allGrades"))}
      {field("curriculum", t("filter.curriculum"), curricula, t("filter.allTracks"))}
      {field("counselor", t("filter.counselor"), counselors, t("filter.allCounselors"))}
    </div>
  );
}

export function RecomputeButton({ filters }: { filters: { grade: number | null; curriculum: string | null; counselor: string | null } }) {
  const t = useTranslations("transcripts.dashboard");
  const err = useTxErr();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await recomputeCaseloadAction(filters);
          if (!res.ok) return err(res.error);
          toast.success(res.capped ? t("recomputedCapped", { n: res.evaluated }) : t("recomputed", { n: res.evaluated }));
          router.refresh();
        })
      }
      data-testid="recompute"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {pending ? t("recomputing") : t("recompute")}
    </Button>
  );
}

/** Approve or send back a proposed plan without leaving the dashboard (existing engine actions). */
export function InlinePlanReview({ planId }: { planId: string }) {
  const t = useTranslations("transcripts.dashboard");
  const te = useTranslations("engine.errors");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(te.has(res.error ?? "") ? te(res.error!) : te("generic"));
        return;
      }
      setNote("");
      toast.success(done);
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="inline-review">
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} className="h-8 sm:w-56" maxLength={2000} aria-label={t("note")} />
      <div className="flex gap-1.5">
        <Button size="sm" disabled={pending} onClick={() => act(() => approvePlanAction({ planId, note: note.trim() || null }), t("approved"))} data-testid="dash-approve">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {t("approve")}
        </Button>
        <Button size="sm" variant="outline" disabled={pending || !note.trim()} title={!note.trim() ? t("noteRequired") : undefined} onClick={() => act(() => requestPlanChangesAction({ planId, note }), t("changesRequested"))} data-testid="dash-request">
          <X className="size-3.5" />
          {t("requestChanges")}
        </Button>
      </div>
    </div>
  );
}
