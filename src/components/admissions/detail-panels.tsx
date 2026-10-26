"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, Check, ClipboardCheck, CreditCard, Eye, FileText, Lock, Loader2, Send, Send as Offer, UserPlus, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/app/badges";
import { revealApplicantIdAction, revealHealthAction, reviewDocumentAction, searchStudentsAction, setPriorityAction, staffMessageAction } from "@/server/admissions/actions";
import { AssessmentDialog, CloseDialog, EnrollDialog, ExtendDialog, MoveButtons, OfferDialog, OutcomeDialog, PaidDialog, type DialogKind } from "./detail-actions";
import { formatBytes, useGrade } from "./ui";

type Opt = { value: string; label: string };

/** The next-step buttons for an application and the dialogs behind them. Opens a dialog from ?action= (board moves). */
export function NextSteps(props: {
  applicationId: string;
  phase: string;
  stage: string;
  manage: boolean;
  enroll: boolean;
  simpleMoves: Array<{ key: string; label: string }>;
  can: { offer: boolean; paid: boolean; enroll: boolean; declined: boolean; withdrawn: boolean; assessment: boolean };
  labels: { declined: string; withdrawn: string };
  offer: { days: number; sections: Opt[]; full: boolean; seats: string; deadline: string | null };
  paidAmount: string;
  hosts: Opt[];
  defaultHost: string | null;
  outcome: string | null;
  outcomeNotes: string;
  homerooms: Opt[];
  readmit: Opt[];
  defaultSection: string | null;
  startsLater: boolean;
}) {
  const t = useTranslations("admissions.detail");
  const sp = useSearchParams();
  const initial = (() => {
    const a = sp.get("action");
    if (a === "offer" && props.can.offer) return "offer";
    if (a === "paid" && props.can.paid) return "paid";
    if (a === "enroll" && props.can.enroll && props.enroll) return "enroll";
    if (a === "close") return sp.get("to") === "DECLINED" ? "decline" : "withdraw";
    return null;
  })();
  const [open, setOpen] = useState<DialogKind | "decline" | "withdraw" | null>(props.manage ? (initial as DialogKind) : null);
  const set = (k: typeof open) => (o: boolean) => setOpen(o ? k : null);
  if (!props.manage) return null;
  const review = props.phase === "review" || props.phase === "waitlist";
  return (
    <div className="space-y-3" data-testid="next-steps">
      <div className="flex flex-wrap gap-2">
        {review && props.can.assessment && (
          <Button size="sm" variant="outline" onClick={() => setOpen("assessment")} data-testid="btn-assessment">
            <CalendarPlus className="size-4" />
            {t("bookAssessment")}
          </Button>
        )}
        {review && (
          <Button size="sm" variant="outline" onClick={() => setOpen("outcome")} data-testid="btn-outcome">
            <ClipboardCheck className="size-4" />
            {t("recordOutcome")}
          </Button>
        )}
        {props.can.offer && (
          <Button size="sm" onClick={() => setOpen("offer")} data-testid="btn-offer">
            <Offer className="size-4" />
            {t("makeOffer")}
          </Button>
        )}
        {props.stage === "OFFER_MADE" && (
          <Button size="sm" variant="outline" onClick={() => setOpen("extend")} data-testid="btn-extend">
            {t("extend")}
          </Button>
        )}
        {props.can.paid && (
          <Button size="sm" onClick={() => setOpen("paid")} data-testid="btn-paid">
            <CreditCard className="size-4" />
            {t("markPaid")}
          </Button>
        )}
        {props.can.enroll && (
          <Button size="sm" disabled={!props.enroll} title={props.enroll ? undefined : t("enrollNoPermission")} onClick={() => setOpen("enroll")} data-testid="btn-enroll">
            <UserPlus className="size-4" />
            {t("enroll")}
          </Button>
        )}
        {props.can.declined && (
          <Button size="sm" variant="ghost" onClick={() => setOpen("decline")} data-testid="btn-decline">
            {props.labels.declined}
          </Button>
        )}
        {props.can.withdrawn && (
          <Button size="sm" variant="ghost" onClick={() => setOpen("withdraw")} data-testid="btn-withdraw">
            {props.labels.withdrawn}
          </Button>
        )}
      </div>
      {props.simpleMoves.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("moveTo")}</span>
          <MoveButtons applicationId={props.applicationId} moves={props.simpleMoves} />
        </div>
      )}
      <OfferDialog open={open === "offer"} onOpenChange={set("offer")} applicationId={props.applicationId} offerDays={props.offer.days} sections={props.offer.sections} full={props.offer.full} seats={props.offer.seats} />
      <ExtendDialog open={open === "extend"} onOpenChange={set("extend")} applicationId={props.applicationId} current={props.offer.deadline} />
      <PaidDialog open={open === "paid"} onOpenChange={set("paid")} applicationId={props.applicationId} amount={props.paidAmount} />
      <EnrollDialog open={open === "enroll"} onOpenChange={set("enroll")} applicationId={props.applicationId} homerooms={props.homerooms} sections={props.offer.sections} readmit={props.readmit} defaultSection={props.defaultSection} startsLater={props.startsLater} />
      <CloseDialog open={open === "decline"} onOpenChange={set("decline")} applicationId={props.applicationId} to="DECLINED" label={props.labels.declined} />
      <CloseDialog open={open === "withdraw"} onOpenChange={set("withdraw")} applicationId={props.applicationId} to="WITHDRAWN" label={props.labels.withdrawn} />
      <AssessmentDialog open={open === "assessment"} onOpenChange={set("assessment")} applicationId={props.applicationId} hosts={props.hosts} defaultHost={props.defaultHost} />
      <OutcomeDialog open={open === "outcome"} onOpenChange={set("outcome")} applicationId={props.applicationId} current={props.outcome} notes={props.outcomeNotes} />
    </div>
  );
}

/** Staff conversation: family messages and staff-only notes, with the choice of who sees a new message. */
export function StaffConversation({ applicationId, messages, manage, draft }: { applicationId: string; messages: Array<{ id: string; body: string; createdAt: string; visibility: string; author: string; family: boolean }>; manage: boolean; draft: boolean }) {
  const t = useTranslations("admissions.detail");
  const locale = useLocale();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"SHARED" | "STAFF">(draft ? "STAFF" : "SHARED");
  const [pending, start] = useTransition();
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
  const send = () =>
    start(async () => {
      const r = await staffMessageAction({ applicationId, body, visibility });
      if (!r.ok) return void toast.error(t("errors.generic"));
      toast.success(visibility === "SHARED" ? t("messageSent") : t("noteSaved"));
      setBody("");
      router.refresh();
    });
  return (
    <div className="space-y-3" data-testid="staff-conversation">
      {messages.length ? (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className={cn("rounded-xl border px-3 py-2 text-sm", m.visibility === "STAFF" ? "border-dashed border-warning/50 bg-warning-soft/40" : m.family ? "bg-card" : "bg-brand-soft/40")}>
              <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{m.author}</span>
                <span>{fmt(m.createdAt)}</span>
                {m.visibility === "STAFF" && (
                  <Pill tone="warning" className="text-[10px]">
                    <Lock className="size-3" />
                    {t("staffOnly")}
                  </Pill>
                )}
              </div>
              <div className="whitespace-pre-wrap break-words" dir="auto">{m.body}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
      )}
      {manage && (
        <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs" role="tablist">
            {(["SHARED", "STAFF"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={visibility === v} disabled={draft && v === "SHARED"} title={draft && v === "SHARED" ? t("draftNoFamily") : undefined} onClick={() => setVisibility(v)} className={cn("rounded-md px-2 py-1.5 font-medium transition disabled:opacity-50", visibility === v ? "bg-card shadow-xs" : "text-muted-foreground")} data-testid={`vis-${v}`}>
                {t(v === "SHARED" ? "toFamily" : "staffNote")}
              </button>
            ))}
          </div>
          <Textarea rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={visibility === "SHARED" ? t("familyPlaceholder") : t("notePlaceholder")} data-testid="staff-message" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{visibility === "SHARED" ? t("familyHint") : t("noteHint")}</span>
            <Button size="sm" disabled={pending || !body.trim()} onClick={send} data-testid="staff-send">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t(visibility === "SHARED" ? "send" : "saveNote")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Uploaded documents with review buttons. Health documents open only for staff with medical access. */
export function DocumentReview({ docs, types, manage, missing }: { docs: Array<{ id: string; typeKey: string; fileName: string; sizeBytes: number; status: string; reviewNote: string | null; canOpen: boolean }>; types: Array<{ key: string; label: string; required: boolean }>; manage: boolean; missing: string[] }) {
  const t = useTranslations("admissions.detail");
  const td = useTranslations("admissions.docs");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const review = (id: string, status: "ACCEPTED" | "REJECTED" | "RECEIVED") =>
    start(async () => {
      const note = status === "REJECTED" ? window.prompt(t("rejectPrompt")) ?? "" : null;
      const r = await reviewDocumentAction({ documentId: id, status, note });
      if (!r.ok) return void toast.error(t("errors.generic"));
      router.refresh();
    });
  return (
    <div className="space-y-2" data-testid="document-review">
      {missing.length > 0 && <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs">{t("missingDocs", { list: missing.join(locale === "ar" ? "، " : ", ") })}</p>}
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noDocs")}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{types.find((x) => x.key === d.typeKey)?.label ?? d.typeKey}</span>
                <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                  {d.fileName} · {formatBytes(d.sizeBytes, locale)}
                </span>
                {d.reviewNote && <span className="block text-xs text-danger">{d.reviewNote}</span>}
              </span>
              <Pill tone={d.status === "ACCEPTED" ? "success" : d.status === "REJECTED" ? "danger" : "neutral"}>{td(`status.${d.status}`)}</Pill>
              {d.canOpen ? (
                <Button asChild size="sm" variant="ghost" className="h-7">
                  <a href={`/api/admissions/doc/${d.id}`}>
                    <Eye className="size-3.5" />
                    {t("open")}
                  </a>
                </Button>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title={t("medicalOnly")}>
                  <Lock className="size-3" />
                  {t("medicalOnlyShort")}
                </span>
              )}
              {manage && d.status !== "ACCEPTED" && (
                <Button size="icon" variant="ghost" className="size-7 text-success" disabled={pending} onClick={() => review(d.id, "ACCEPTED")} aria-label={t("accept")} data-testid="doc-accept">
                  <Check className="size-4" />
                </Button>
              )}
              {manage && d.status !== "REJECTED" && (
                <Button size="icon" variant="ghost" className="size-7 text-danger" disabled={pending} onClick={() => review(d.id, "REJECTED")} aria-label={t("reject")}>
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Health and learning support: only staff with medical access may open it, and every view is recorded. */
export function HealthPanel({ applicationId, canSee, hasMedical, hasSupport }: { applicationId: string; canSee: boolean; hasMedical: boolean; hasSupport: boolean }) {
  const t = useTranslations("admissions.detail");
  const [data, setData] = useState<{ medical: { allergies?: string; conditions?: string; medications?: string } | null; support: { needed?: boolean; details?: string; previousAssessment?: boolean } | null } | null>(null);
  const [pending, start] = useTransition();
  if (!hasMedical && !hasSupport) return <p className="text-sm text-muted-foreground">{t("noHealth")}</p>;
  return (
    <div className="space-y-2 text-sm" data-testid="health-panel">
      <div className="flex flex-wrap gap-1.5">
        {hasMedical && <Pill tone="warning">{t("healthGiven")}</Pill>}
        {hasSupport && <Pill tone="violet">{t("supportGiven")}</Pill>}
      </div>
      {!canSee ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          {t("healthLocked")}
        </p>
      ) : data ? (
        <dl className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
          {data.medical?.allergies && <Row k={t("allergies")} v={data.medical.allergies} />}
          {data.medical?.conditions && <Row k={t("conditions")} v={data.medical.conditions} />}
          {data.medical?.medications && <Row k={t("medications")} v={data.medical.medications} />}
          {data.support?.needed && <Row k={t("support")} v={data.support.details || t("supportNoDetails")} />}
          {data.support?.previousAssessment && <Row k={t("previousAssessment")} v={t("yes")} />}
        </dl>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await revealHealthAction({ applicationId });
              if (!r.ok) return void toast.error(t("errors.generic"));
              setData({ medical: r.medical, support: r.support });
            })
          }
          data-testid="reveal-health"
        >
          <Eye className="size-4" />
          {t("revealHealth")}
        </Button>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="whitespace-pre-wrap">{v}</dd>
    </div>
  );
}

/** Masked identifier with an audited reveal for staff who may see full numbers. */
export function RevealIdButton({ applicationId, field, masked, canReveal }: { applicationId: string; field: "emiratesId" | "passport"; masked: string; canReveal: boolean }) {
  const t = useTranslations("admissions.detail");
  const [value, setValue] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <span dir="ltr" className="font-mono text-sm">
        {value ?? masked}
      </span>
      {canReveal && !value && (
        <button
          type="button"
          className="text-xs text-brand hover:underline disabled:opacity-50"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await revealApplicantIdAction({ applicationId, field });
              if (r.ok) setValue(r.value);
              else toast.error(t("errors.generic"));
            })
          }
        >
          {t("reveal")}
        </button>
      )}
    </span>
  );
}

/** Waitlist priority: confirm siblings at the school, verify a staff child, and adjust with a reason. */
export function PriorityEditor({ applicationId, siblings, staffChild, staffChildVerified, boost, manage }: { applicationId: string; siblings: Opt[]; staffChild: boolean; staffChildVerified: boolean; boost: number; manage: boolean }) {
  const t = useTranslations("admissions.detail");
  const grade = useGrade();
  const locale = useLocale();
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [list, setList] = useState<Opt[]>(siblings);
  const [verified, setVerified] = useState(staffChildVerified);
  const [b, setB] = useState(boost);
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Opt[]>([]);
  const [pending, start] = useTransition();
  const search = (v: string) => {
    setQ(v);
    if (v.trim().length < 2) return setFound([]);
    start(async () => {
      const rows = await searchStudentsAction({ q: v });
      setFound(rows.map((r) => ({ value: r.id, label: `${locale === "ar" ? `${r.firstNameAr} ${r.lastNameAr}` : `${r.firstNameEn} ${r.lastNameEn}`} · ${grade(r.gradeLevel)}${r.section ?? ""}` })));
    });
  };
  const save = () =>
    start(async () => {
      const r = await setPriorityAction({ applicationId, siblingStudentIds: list.map((x) => x.value), staffChildVerified: verified, priorityBoost: b, reason });
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(t("prioritySaved"));
      setEdit(false);
      router.refresh();
    });
  if (!edit)
    return (
      <div className="space-y-1.5 text-sm" data-testid="priority">
        <div className="flex flex-wrap gap-1.5">
          {siblings.length ? siblings.map((s) => <Pill key={s.value} tone="info">{t("siblingIs", { name: s.label })}</Pill>) : <span className="text-muted-foreground">{t("noSiblings")}</span>}
        </div>
        {staffChild && <Pill tone={staffChildVerified ? "success" : "warning"}>{staffChildVerified ? t("staffChildVerified") : t("staffChildClaimed")}</Pill>}
        {boost !== 0 && <p className="text-xs text-muted-foreground">{t("boostIs", { n: boost > 0 ? `+${boost}` : String(boost) })}</p>}
        {manage && (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEdit(true)} data-testid="edit-priority">
            {t("editPriority")}
          </Button>
        )}
      </div>
    );
  return (
    <div className="space-y-3 text-sm" data-testid="priority-editor">
      <div className="flex flex-wrap gap-1.5">
        {list.map((s) => (
          <span key={s.value} className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-xs text-info">
            {s.label}
            <button type="button" onClick={() => setList(list.filter((x) => x.value !== s.value))} aria-label={t("remove")}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <Input value={q} onChange={(e) => search(e.target.value)} placeholder={t("findSibling")} className="h-9" />
        {found.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
            {found.map((f) => (
              <li key={f.value}>
                <button type="button" className="w-full rounded px-2 py-1.5 text-start text-sm hover:bg-muted" onClick={() => { if (!list.some((x) => x.value === f.value)) setList([...list, f]); setFound([]); setQ(""); }}>
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="flex items-center gap-2">
        <Checkbox checked={verified} onCheckedChange={(v) => setVerified(v === true)} />
        {t("verifyStaffChild")}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("boost")}</span>
        <select className="h-8 rounded-md border bg-card px-2 text-sm" value={b} onChange={(e) => setB(Number(e.target.value))}>
          {[-3, -2, -1, 0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n > 0 ? `+${n}` : n}
            </option>
          ))}
        </select>
      </div>
      {b !== boost && <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("boostReason")} />}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || (b !== boost && !reason.trim())} onClick={save}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
