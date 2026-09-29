"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addShortlistAction, chooseCareerAction, reviewRecommendationsAction, toggleRequirementAction, updateShortlistAction } from "@/server/career/actions";

export function ChooseCareerButton({ careerId, chosen }: { careerId: string; chosen: boolean }) {
  const t = useTranslations("career");
  const router = useRouter();
  const [pending, start] = useTransition();
  if (chosen)
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
        <Check className="size-4" />
        {t("chosen")}
      </span>
    );
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      data-testid="choose-career"
      onClick={() =>
        start(async () => {
          await chooseCareerAction(careerId);
          toast.success(t("chosenToast"));
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {t("choose")}
    </Button>
  );
}

export function ReviewRecommendations({ studentId, recs }: { studentId: string; recs: Array<{ id: string; title: string; score: number; status: string }> }) {
  const t = useTranslations("career");
  const router = useRouter();
  const drafts = recs.filter((r) => r.status === "DRAFT");
  const [selected, setSelected] = useState<string[]>(drafts.map((r) => r.id));
  const [pending, start] = useTransition();
  if (!drafts.length) return null;
  return (
    <div className="space-y-3 rounded-xl border border-warning/40 bg-warning-soft/50 p-4" data-testid="review-recs">
      <div className="text-sm font-semibold">{t("reviewTitle")}</div>
      <p className="text-xs text-muted-foreground">{t("reviewHint")}</p>
      <ul className="space-y-1.5">
        {drafts.map((r) => (
          <li key={r.id}>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.includes(r.id)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
              <span className="flex-1">{r.title}</span>
              <span className="tabular-nums text-muted-foreground">{r.score}%</span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        disabled={pending}
        data-testid="approve-recs"
        onClick={() =>
          start(async () => {
            await reviewRecommendationsAction({ studentId, approve: selected, reject: drafts.filter((d) => !selected.includes(d.id)).map((d) => d.id) });
            toast.success(t("reviewedToast"));
            router.refresh();
          })
        }
      >
        <Check className="size-4" />
        {t("approveSelected", { count: selected.length })}
      </Button>
    </div>
  );
}

type Uni = { id: string; name: string; city: string; country: string; programs: string[]; acceptance: number | null; rank: number | null };
type EntryCheck = { href: string; met: number; notMet: number; unknown: number; gaps: string[] } | null;
type Entry = { id: string; university: string; country: string; program: string; category: string; status: string; deadline: string | null; check: EntryCheck; requirements: Array<{ id: string; label: string; done: boolean; due: string | null }> };

export function Shortlist({ studentId, entries, universities }: { studentId: string | null; entries: Entry[]; universities: Uni[] }) {
  const t = useTranslations("career");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const countries = [...new Set(universities.map((u) => u.country))];
  const list = useMemo(() => universities.filter((u) => (!country || u.country === country) && (!q || `${u.name} ${u.city} ${u.programs.join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [universities, q, country]);
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("shortlistEmpty")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {entries.map((e) => {
            const done = e.requirements.filter((r) => r.done).length;
            return (
              <div key={e.id} className="rounded-xl border bg-card p-4" data-testid="shortlist-entry">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{e.university}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {e.program} · {e.country}
                    </div>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", e.category === "REACH" ? "bg-danger-soft text-danger" : e.category === "TARGET" ? "bg-info-soft text-info" : "bg-success-soft text-success")}>{t(`cat.${e.category}`)}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Select value={e.status} onValueChange={(v) => run(() => updateShortlistAction({ entryId: e.id, status: v as never }))}>
                    <SelectTrigger size="sm" className="h-8 flex-1">
                      <SelectValue>{t(`app.${e.status}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {["RESEARCHING", "PREPARING", "SUBMITTED", "OFFER", "ACCEPTED", "REJECTED", "WITHDRAWN"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`app.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {e.deadline && <span className="text-xs text-muted-foreground">{t("deadline", { date: e.deadline })}</span>}
                  <Button variant="ghost" size="icon" className="size-8" aria-label={t("remove")} onClick={() => run(() => updateShortlistAction({ entryId: e.id, remove: true }))}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                {e.check && (
                  <div className="mt-3 rounded-lg bg-muted/40 p-2.5 text-xs" data-testid="entry-check">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{t("entryRequirements")}</span>
                      <span className="flex gap-2 tabular-nums">
                        <span className="text-success">{t("reqMet", { n: e.check.met })}</span>
                        {e.check.notMet > 0 && <span className="text-danger">{t("reqNotMet", { n: e.check.notMet })}</span>}
                        {e.check.unknown > 0 && <span className="text-muted-foreground">{t("reqUnknown", { n: e.check.unknown })}</span>}
                      </span>
                    </div>
                    {e.check.gaps.length > 0 && (
                      <ul className="list-disc space-y-0.5 ps-4 text-danger">
                        {e.check.gaps.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    )}
                    <Link href={e.check.href} className="mt-1 inline-block font-medium text-brand hover:underline">
                      {t("seeChecker")}
                    </Link>
                  </div>
                )}
                <div className="mt-3">
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>{t("requirements")}</span>
                    <span className="tabular-nums">
                      {done}/{e.requirements.length}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {e.requirements.map((r) => (
                      <li key={r.id}>
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox checked={r.done} onCheckedChange={(c) => run(() => toggleRequirementAction({ requirementId: r.id, done: c === true }))} />
                          <span className={cn("flex-1", r.done && "text-muted-foreground line-through")}>{r.label}</span>
                          {r.due && <span className="text-muted-foreground">{r.due}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="add-university">
        <Plus className="size-4" />
        {t("addUniversity")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("addUniversity")}</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchUniversities")} className="ps-9" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setCountry(null)} className={cn("rounded-full border px-2.5 py-1 text-xs", !country ? "border-brand bg-brand text-brand-foreground" : "hover:bg-muted")}>
              {t("allCountries")}
            </button>
            {countries.map((c) => (
              <button key={c} onClick={() => setCountry(c)} className={cn("rounded-full border px-2.5 py-1 text-xs", country === c ? "border-brand bg-brand text-brand-foreground" : "hover:bg-muted")}>
                {c}
              </button>
            ))}
          </div>
          <Link href="/career/universities" className="text-xs font-medium text-brand hover:underline" data-testid="browse-all-universities">
            {t("browseAllUniversities")}
          </Link>
          <ul className="-mx-2 max-h-[50dvh] overflow-y-auto">
            {list.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {u.city} · {u.programs.slice(0, 2).join(", ")}
                    {u.acceptance != null && ` · ${t("acceptance", { pct: u.acceptance })}`}
                  </div>
                </div>
                <Button size="sm" variant="ghost" disabled={pending || entries.some((e) => e.university === u.name)} onClick={() => run(async () => { await addShortlistAction({ studentId, universityId: u.id, programEn: u.programs[0] ?? "" }); })}>
                  <Plus className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
