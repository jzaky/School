"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Loader2, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import { createDsrAction, eraseSubjectAction, previewErasureAction, searchSubjectsAction, type SubjectHit } from "@/server/privacy/actions";
import type { ErasurePlan } from "@/server/privacy/erase";

type Kind = "student" | "guardian" | "staff";

function useErrorText() {
  const t = useTranslations("privacy");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

/** Search students, guardians and staff by name, number or email. */
export function SubjectSearch({ onPick, autoFocus }: { onPick: (hit: SubjectHit) => void; autoFocus?: boolean }) {
  const t = useTranslations("privacy");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SubjectHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await searchSubjectsAction({ q: term }).catch(() => ({ ok: false as const, error: "generic" }));
      if (!live) return;
      setLoading(false);
      setFailed(!res.ok);
      setHits(res.ok ? res.hits : []);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} className="ps-9" autoFocus={autoFocus} aria-label={t("searchPlaceholder")} data-testid="subject-search" />
        {loading && <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {failed && <p className="text-xs text-danger">{t("error.generic")}</p>}
      {q.trim().length >= 2 && !loading && !failed && hits.length === 0 && <p className="text-xs text-muted-foreground">{t("noMatches")}</p>}
      {hits.length > 0 && (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
          {hits.map((h) => (
            <li key={`${h.kind}-${h.id}`}>
              <button type="button" onClick={() => onPick(h)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-muted/60" data-testid="subject-hit">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{locale === "ar" ? h.nameAr : h.nameEn}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span dir="ltr">{h.reference}</span>
                    {h.kind === "student" && h.detail ? ` · ${t("gradeN", { n: h.detail })}` : h.detail ? ` · ${h.detail}` : ""}
                  </span>
                </span>
                <Pill tone={h.kind === "student" ? "brand" : h.kind === "guardian" ? "info" : "neutral"}>{t(`kind.${h.kind}`)}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Picker that opens the person's data page. */
export function SubjectFinder() {
  const router = useRouter();
  return <SubjectSearch onPick={(h) => router.push(`/admin/compliance/person?kind=${h.kind}&id=${h.id}`)} />;
}

/** Log a new access, correction or deletion request for one person. */
export function LogDsrButton({ preset }: { preset?: { kind: Kind; id: string; name: string } }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("adminCompliance");
  const err = useErrorText();
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [type, setType] = useState<"ACCESS" | "CORRECTION" | "DELETION">("ACCESS");
  const [person, setPerson] = useState<{ kind: Kind; id: string; name: string } | null>(preset ?? null);
  const [requester, setRequester] = useState("");
  const [details, setDetails] = useState("");
  const submit = () =>
    start(async () => {
      if (!person) return;
      const res = await createDsrAction({ type, kind: person.kind, subjectId: person.id, requesterName: requester, details });
      if (!res.ok) {
        toast.error(err(res.error));
        return;
      }
      toast.success(t("dsrLogged", { number: res.number }));
      setOpen(false);
      setRequester("");
      setDetails("");
      if (!preset) setPerson(null);
      router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="log-dsr">
        <UserPlus className="size-4" />
        {t("logRequest")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("logRequest")}</DialogTitle>
            <DialogDescription>{t("logRequestHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("requestType")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{tc(`dsrType.${type}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(["ACCESS", "CORRECTION", "DELETION"] as const).map((v) => (
                    <SelectItem key={v} value={v}>
                      {tc(`dsrType.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("person")}</Label>
              {person ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="truncate">
                    {person.name} <span className="text-xs text-muted-foreground">· {t(`kind.${person.kind}`)}</span>
                  </span>
                  {!preset && (
                    <Button size="sm" variant="ghost" onClick={() => setPerson(null)}>
                      {t("change")}
                    </Button>
                  )}
                </div>
              ) : (
                <SubjectSearch onPick={(h) => setPerson({ kind: h.kind, id: h.id, name: locale === "ar" ? h.nameAr : h.nameEn })} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsr-requester">{t("requester")}</Label>
              <Input id="dsr-requester" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder={t("requesterPlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsr-details">{t("details")}</Label>
              <Textarea id="dsr-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={3} />
            </div>
            <p className="text-xs text-muted-foreground">{t("dueHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !person || requester.trim().length < 2} data-testid="log-dsr-submit">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("logRequestSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ACTION_TONE = { delete: "danger", anonymise: "warning", retain: "success" } as const;

function PlanTable({ plan }: { plan: ErasurePlan }) {
  const t = useTranslations("privacy");
  const ta = useTranslations("privacyExport");
  const groups = useMemo(() => {
    const order = ["delete", "anonymise", "retain"] as const;
    return order.map((a) => ({ action: a, items: plan.items.filter((i) => i.action === a && i.count > 0) })).filter((g) => g.items.length);
  }, [plan]);
  const area = (m: string) => (ta.has(`areas.${m}`) ? ta(`areas.${m}`) : m);
  return (
    <div className="space-y-4" data-testid="erasure-plan">
      {groups.map((g) => (
        <div key={g.action}>
          <p className="mb-1.5 flex items-center gap-2 text-sm font-medium">
            <Pill tone={ACTION_TONE[g.action]}>{t(`action.${g.action}`)}</Pill>
            <span className="text-xs text-muted-foreground">{t(`actionHint.${g.action}`)}</span>
          </p>
          <ul className="divide-y rounded-lg border text-sm">
            {g.items.map((i) => (
              <li key={`${i.model}-${i.reason}-${i.policy}`} className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block">{area(i.model)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`reason.${i.reason}`)}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{i.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t("planFiles", { n: plan.files })}</p>
      <p className="text-xs text-muted-foreground">{t("planPerson")}</p>
    </div>
  );
}

/** Two-step erasure: preview the plan, then confirm by typing the person's reference. */
export function ErasureFlow({ kind, id, reference, dsrs }: { kind: Kind; id: string; reference: string; dsrs: Array<{ id: string; number: string }> }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("adminCompliance");
  const err = useErrorText();
  const router = useRouter();
  const [plan, setPlan] = useState<ErasurePlan | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [dsrId, setDsrId] = useState<string>(dsrs[0]?.id ?? "none");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ files: number; account: string } | null>(null);

  const preview = () =>
    start(async () => {
      const res = await previewErasureAction({ kind, id });
      if (!res.ok) {
        toast.error(err(res.error));
        return;
      }
      setPlan(res.plan);
      setStep(1);
    });
  const erase = () =>
    start(async () => {
      if (!plan) return;
      const res = await eraseSubjectAction({ kind, id, hash: plan.hash, confirm, dsrId: dsrId === "none" ? null : dsrId });
      if (!res.ok) {
        toast.error(err(res.error));
        if (res.error === "PLAN_CHANGED") setStep(0);
        return;
      }
      setDone({ files: res.files, account: res.account });
      setStep(0);
      toast.success(t("erased"));
      router.refresh();
    });

  if (done)
    return (
      <div className="rounded-lg border border-success/30 bg-success-soft p-4 text-sm" data-testid="erasure-done">
        <p className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-success" />
          {t("erased")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("erasedDetail", { files: done.files })} {t(`account.${done.account}`)}
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={preview} disabled={pending} data-testid="erasure-preview">
        {pending && step === 0 ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        {t("previewErasure")}
      </Button>
      <Dialog open={step > 0} onOpenChange={(o) => !o && setStep(0)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" />
              {step === 1 ? t("previewTitle") : t("confirmTitle")}
            </DialogTitle>
            <DialogDescription>{step === 1 ? t("previewBody") : t("confirmBody", { reference })}</DialogDescription>
          </DialogHeader>
          {step === 1 && plan && <PlanTable plan={plan} />}
          {step === 2 && (
            <div className="space-y-4">
              {dsrs.length > 0 && (
                <div className="space-y-1.5">
                  <Label>{t("linkRequest")}</Label>
                  <Select value={dsrId} onValueChange={setDsrId}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{dsrId === "none" ? t("noLinkedRequest") : dsrs.find((d) => d.id === dsrId)?.number}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {dsrs.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.number}
                        </SelectItem>
                      ))}
                      <SelectItem value="none">{t("noLinkedRequest")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="erase-confirm">{t("typeReference", { reference })}</Label>
                <Input id="erase-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" autoComplete="off" data-testid="erasure-confirm-input" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} data-testid="erasure-understood" />
                <span>{t("understand")}</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep(0)}>
              {tc("cancel")}
            </Button>
            {step === 1 ? (
              <Button onClick={() => setStep(2)} data-testid="erasure-continue">
                {t("continue")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            ) : (
              <Button variant="destructive" onClick={erase} disabled={pending || confirm.trim() !== reference || !understood} data-testid="erasure-confirm">
                {pending && <Loader2 className="size-4 animate-spin" />}
                {t("eraseNow")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PersonLink({ kind, id, children }: { kind: Kind; id: string; children: React.ReactNode }) {
  return (
    <Link href={`/admin/compliance/person?kind=${kind}&id=${id}`} className="text-xs font-medium text-brand hover:underline">
      {children}
    </Link>
  );
}
