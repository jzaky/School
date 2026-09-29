"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, X, Download } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addSourceAction,
  approveExtractionAction,
  checkSourceNowAction,
  reextractWithAiAction,
  rejectExtractionAction,
  reviewChangeAction,
  runScorecardCatalogAction,
  verifyRequirementAction,
} from "@/server/catalog-pipeline/actions";
import { SOURCE_TYPES, SUBJECT_TYPES, TEST_POLICIES, type DraftGroup } from "@/server/catalog-pipeline/types";
import { describeAdditional, describeLanguage, describeOverall, describeSubject, describeTest, type SubjectNames } from "./describe";

type T = ReturnType<typeof useTranslations>;
const errText = (t: T, code: string) => (t.has(`error.${code}`) ? t(`error.${code}`) : t("error.invalid"));

export function CatalogTabs() {
  const t = useTranslations("catalog.tabs");
  const pathname = usePathname();
  const tabs = [
    { href: "/career/catalog", key: "queue", match: (p: string) => p === "/career/catalog" || p.startsWith("/career/catalog/review") },
    { href: "/career/catalog/sources", key: "sources", match: (p: string) => p.startsWith("/career/catalog/sources") },
    { href: "/career/catalog/changes", key: "changes", match: (p: string) => p.startsWith("/career/catalog/changes") || p.startsWith("/career/catalog/programs") },
    { href: "/career/catalog/scorecard", key: "scorecard", match: (p: string) => p.startsWith("/career/catalog/scorecard") },
  ];
  return (
    <nav className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-fit" data-testid="catalog-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          data-testid={`catalog-tab-${tab.key}`}
          className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition", tab.match(pathname) ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}

/** A button that is disabled with a tooltip explaining why, or a normal button. */
function Gated({ reason, children, testId }: { reason: string | null; children: React.ReactElement; testId?: string }) {
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex" data-testid={testId ? `${testId}-disabled` : undefined} aria-label={reason}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------------------------
// Review queue

export function ReviewActions({ extractionId, groups, names, denial, aiAvailable }: { extractionId: string; groups: DraftGroup[]; names: SubjectNames; denial: string | null; aiAvailable: boolean }) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<null | "approve" | "edit" | "reject">(null);
  const [note, setNote] = useState("");
  const reason = denial ? errText(t, denial) : null;
  const [draft, setDraft] = useState<DraftGroup[]>(() => JSON.parse(JSON.stringify(groups)));
  const [keep, setKeep] = useState<Record<string, boolean>>({});

  const approve = (edits: DraftGroup[] | null) =>
    start(async () => {
      const res = await approveExtractionAction(extractionId, edits, note || null);
      if (!res.ok) return void toast.error(errText(t, res.error));
      toast.success(t("review.approved"));
      setOpen(null);
      router.push("/career/catalog");
      router.refresh();
    });
  const reject = () =>
    start(async () => {
      const res = await rejectExtractionAction(extractionId, note);
      if (!res.ok) return void toast.error(errText(t, res.error));
      toast.success(t("review.rejectedToast"));
      setOpen(null);
      router.push("/career/catalog");
      router.refresh();
    });
  const rerun = () =>
    start(async () => {
      const res = await reextractWithAiAction(extractionId);
      if (!res.ok) return void toast.error(errText(t, res.error));
      toast.success(res.status === "created" ? t("review.rerunDone") : t("review.rerunCached"));
      router.refresh();
    });

  const kept = (id: string) => keep[id] !== false;
  const edited = () =>
    draft.map((g, gi) => ({
      ...g,
      overall: g.overall.filter((_, i) => kept(`${gi}o${i}`)),
      subjects: g.subjects.filter((_, i) => kept(`${gi}s${i}`)),
      languages: g.languages.filter((_, i) => kept(`${gi}l${i}`)),
      tests: g.tests.filter((_, i) => kept(`${gi}t${i}`)),
      additional: g.additional.filter((_, i) => kept(`${gi}a${i}`)),
    }));
  const patch = (gi: number, fn: (g: DraftGroup) => void) =>
    setDraft((d) => {
      const n: DraftGroup[] = JSON.parse(JSON.stringify(d));
      fn(n[gi]);
      return n;
    });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const KeepBox = ({ id, label }: { id: string; label: string }) => (
    <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
      <Checkbox checked={kept(id)} onCheckedChange={(v) => setKeep((k) => ({ ...k, [id]: v === true }))} aria-label={t("review.keep")} className="mt-0.5" />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="review-actions">
      <Gated reason={reason} testId="approve">
        <Button size="sm" disabled={!!reason || pending} onClick={() => setOpen("approve")} data-testid="approve">
          <Check className="size-4" />
          {t("review.approve")}
        </Button>
      </Gated>
      <Gated reason={reason}>
        <Button size="sm" variant="outline" disabled={!!reason || pending} onClick={() => setOpen("edit")} data-testid="edit-approve">
          <Pencil className="size-4" />
          {t("review.editApprove")}
        </Button>
      </Gated>
      <Gated reason={reason}>
        <Button size="sm" variant="outline" disabled={!!reason || pending} onClick={() => setOpen("reject")} data-testid="reject">
          <X className="size-4" />
          {t("review.reject")}
        </Button>
      </Gated>
      <Gated reason={reason ?? (aiAvailable ? null : t("review.rerunAiDisabled"))}>
        <Button size="sm" variant="ghost" disabled={!!reason || !aiAvailable || pending} onClick={rerun} data-testid="rerun-ai">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t("review.rerunAi")}
        </Button>
      </Gated>

      <Dialog open={open === "approve"} onOpenChange={(o) => setOpen(o ? "approve" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("review.approveTitle")}</DialogTitle>
            <DialogDescription>{t("review.approveBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="approve-note">{t("review.note")}</Label>
            <Textarea id="approve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => approve(null)} disabled={pending} data-testid="confirm-approve">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("review.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "reject"} onOpenChange={(o) => setOpen(o ? "reject" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("review.rejectTitle")}</DialogTitle>
            <DialogDescription>{t("review.rejectBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-note">{t("review.rejectNote")}</Label>
            <Textarea id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} data-testid="reject-note" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={reject} disabled={pending || !note.trim()} data-testid="confirm-reject">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("review.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "edit"} onOpenChange={(o) => setOpen(o ? "edit" : null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("review.editTitle")}</DialogTitle>
            <DialogDescription>{t("review.editBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5" data-testid="edit-lines">
            {draft.map((g, gi) => (
              <div key={gi} className="space-y-3 rounded-lg border p-3">
                {g.overall.map((l, i) => (
                  <div key={`o${i}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <KeepBox id={`${gi}o${i}`} label={describeOverall(t, l)} />
                    <Input className="sm:w-28" aria-label={t("field.value")} value={String(l.value)} onChange={(e) => patch(gi, (x) => void (x.overall[i].value = l.field === "gradeProfile" ? e.target.value : (num(e.target.value) ?? 0)))} />
                  </div>
                ))}
                {g.subjects.map((l, i) => (
                  <div key={`s${i}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <KeepBox id={`${gi}s${i}`} label={describeSubject(t, l, names)} />
                    <Select value={l.type} onValueChange={(v) => patch(gi, (x) => void (x.subjects[i].type = v as typeof l.type))}>
                      <SelectTrigger className="sm:w-36" aria-label={t("field.type")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUBJECT_TYPES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`type.${s}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input className="sm:w-20" aria-label={t("field.grade")} placeholder={t("field.grade")} value={l.minimumGrade ?? ""} onChange={(e) => patch(gi, (x) => void (x.subjects[i].minimumGrade = e.target.value.trim() || null))} />
                  </div>
                ))}
                {g.languages.map((l, i) => (
                  <div key={`l${i}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <KeepBox id={`${gi}l${i}`} label={describeLanguage(t, l)} />
                    <Input className="sm:w-20" type="number" step="0.5" aria-label={t("field.overall")} value={l.minOverall} onChange={(e) => patch(gi, (x) => void (x.languages[i].minOverall = num(e.target.value) ?? 0))} />
                    <Input className="sm:w-20" type="number" step="0.5" aria-label={t("field.component")} value={l.minComponent ?? ""} onChange={(e) => patch(gi, (x) => void (x.languages[i].minComponent = num(e.target.value)))} />
                  </div>
                ))}
                {g.tests.map((l, i) => (
                  <div key={`t${i}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <KeepBox id={`${gi}t${i}`} label={describeTest(t, l)} />
                    <Select value={l.policy} onValueChange={(v) => patch(gi, (x) => void (x.tests[i].policy = v))}>
                      <SelectTrigger className="sm:w-40" aria-label={t("field.policy")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TEST_POLICIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {t(`policy.${p}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {g.additional.map((l, i) => (
                  <div key={`a${i}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <KeepBox id={`${gi}a${i}`} label={describeAdditional(t, l)} />
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={l.required} onCheckedChange={(v) => patch(gi, (x) => void (x.additional[i].required = v === true))} />
                      {t("field.required")}
                    </label>
                  </div>
                ))}
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="edit-note">{t("review.note")}</Label>
              <Textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => approve(edited())} disabled={pending} data-testid="confirm-edit-approve">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("review.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Sources

export function CheckNowButton({ sourceId, denial }: { sourceId: string; denial: string | null }) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [pending, start] = useTransition();
  const reason = denial ? errText(t, denial) : null;
  return (
    <Gated reason={reason} testId="check-now">
      <Button
        size="sm"
        variant="outline"
        disabled={!!reason || pending}
        data-testid="check-now"
        onClick={() =>
          start(async () => {
            const res = await checkSourceNowAction(sourceId);
            if (!res.ok) return void toast.error(errText(t, res.error));
            toast.success(t("sources.queued"));
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {t("sources.checkNow")}
      </Button>
    </Gated>
  );
}

export function AddSourceDialog({ programs, denial }: { programs: Array<{ value: string; label: string }>; denial: string | null }) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [programId, setProgramId] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<string>("OFFICIAL_UNIVERSITY");
  const [title, setTitle] = useState("");
  const reason = denial ? errText(t, denial) : null;
  const submit = () =>
    start(async () => {
      const res = await addSourceAction({ programId, url, sourceType: type, title: title || null });
      if (!res.ok) return void toast.error(errText(t, res.error));
      toast.success(res.created ? t("sources.added") : t("sources.exists"));
      setOpen(false);
      setUrl("");
      setTitle("");
      router.refresh();
    });
  return (
    <>
      <Gated reason={reason} testId="add-source">
        <Button size="sm" disabled={!!reason} onClick={() => setOpen(true)} data-testid="add-source">
          <Plus className="size-4" />
          {t("sources.add")}
        </Button>
      </Gated>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sources.addTitle")}</DialogTitle>
            <DialogDescription>{t("sources.addBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("sources.program")}</Label>
              <Select value={programId} onValueChange={setProgramId}>
                <SelectTrigger className="w-full" data-testid="source-program">
                  <SelectValue placeholder={t("sources.chooseProgram")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {programs.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-url">{t("sources.url")}</Label>
              <Input id="source-url" dir="ltr" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" data-testid="source-url" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sources.type")}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`sources.sourceType.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-title">{t("sources.label")}</Label>
              <Input id="source-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !programId || url.trim().length < 8} data-testid="confirm-add-source">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("sources.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Change monitor and history

export function ChangeActions({ changeId, denial }: { changeId: string; denial: string | null }) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState<null | "REVIEWED" | "DISMISSED">(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const reason = denial ? errText(t, denial) : null;
  const submit = (outcome: "REVIEWED" | "DISMISSED") =>
    start(async () => {
      const res = await reviewChangeAction(changeId, outcome, note || null);
      if (!res.ok) return void toast.error(errText(t, res.error));
      toast.success(outcome === "REVIEWED" ? t("changes.reviewedDone", { n: res.notified }) : t("changes.dismissedDone"));
      setOpen(null);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Gated reason={reason} testId="mark-reviewed">
        <Button size="sm" disabled={!!reason || pending} onClick={() => setOpen("REVIEWED")} data-testid="mark-reviewed">
          <Check className="size-4" />
          {t("changes.markReviewed")}
        </Button>
      </Gated>
      <Gated reason={reason}>
        <Button size="sm" variant="outline" disabled={!!reason || pending} onClick={() => setOpen("DISMISSED")} data-testid="dismiss-change">
          {t("changes.dismiss")}
        </Button>
      </Gated>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open === "DISMISSED" ? t("changes.dismissTitle") : t("changes.reviewTitle")}</DialogTitle>
            <DialogDescription>{open === "DISMISSED" ? t("changes.dismissBody") : t("changes.reviewBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="change-note">{t("review.note")}</Label>
            <Textarea id="change-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => open && submit(open)} disabled={pending} data-testid="confirm-review-change">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {open === "DISMISSED" ? t("changes.dismiss") : t("changes.markReviewed")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function VerifyButton({ requirementId, denial }: { requirementId: string; denial: string | null }) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const reason = denial ? errText(t, denial) : null;
  return (
    <>
      <Gated reason={reason} testId="verify">
        <Button size="sm" variant="outline" disabled={!!reason || pending} onClick={() => setOpen(true)} data-testid="verify">
          <ShieldCheck className="size-4" />
          {t("history.verify")}
        </Button>
      </Gated>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("history.verifyTitle")}</DialogTitle>
            <DialogDescription>{t("history.verifyBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending}
              data-testid="confirm-verify"
              onClick={() =>
                start(async () => {
                  const res = await verifyRequirementAction(requirementId);
                  if (!res.ok) return void toast.error(errText(t, res.error));
                  toast.success(t("history.verified"));
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("history.verify")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ScorecardRunButton({ denial }: { denial: string | null }) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [pending, start] = useTransition();
  const reason = denial ? errText(t, denial) : null;
  return (
    <Gated reason={reason} testId="run-scorecard">
      <Button
        size="sm"
        disabled={!!reason || pending}
        data-testid="run-scorecard"
        onClick={() =>
          start(async () => {
            const res = await runScorecardCatalogAction();
            if (!res.ok) return void toast.error(errText(t, res.error));
            toast.success(res.queued ? t("scorecard.queued") : t("scorecard.done"));
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {t("scorecard.run")}
      </Button>
    </Gated>
  );
}
