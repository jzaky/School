"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Check, CreditCard, Download, ExternalLink, Loader2, MessageSquare, PartyPopper, Send } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill, type Tone } from "@/components/app/badges";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { familyMessageAction, respondToOfferAction, withdrawApplicationAction } from "@/server/admissions/apply-actions";
import { filsToAed } from "@/server/admissions/rules";
import { DocumentUploads, type DocRow, type DocTypeOpt } from "./apply-docs";
import { useGrade } from "./ui";

type Status = "draft" | "received" | "assessment" | "offer" | "accepted" | "enrolled" | "waitlisted" | "declined" | "withdrawn";
const TONE: Record<Status, Tone> = { draft: "neutral", received: "info", assessment: "brand", offer: "gold", accepted: "success", enrolled: "success", waitlisted: "violet", declined: "neutral", withdrawn: "neutral" };

export function FamilyStatusPill({ status }: { status: string }) {
  const t = useTranslations("admissions.familyStatus");
  return (
    <Pill tone={TONE[status as Status] ?? "neutral"} dot>
      {t(status)}
    </Pill>
  );
}

type AppView = {
  id: string;
  number: string;
  stage: string;
  status: Status;
  child: string;
  grade: number;
  year: string;
  submittedAt: string | null;
  offerMadeAt: string | null;
  offerDeadline: string | null;
  offerRespondedAt: string | null;
  seatFeeFils: number;
  seatPaidAt: string | null;
  payUrl: string | null;
  closedBy: string | null;
  enrolledAt: string | null;
};

const PATH: Status[] = ["received", "assessment", "offer", "accepted", "enrolled"];

export function ApplyStatus(props: {
  slug: string;
  app: AppView;
  appointment: { startsAt: string; location: string } | null;
  messages: Array<{ id: string; body: string; createdAt: string; mine: boolean; author: string | null }>;
  docTypes: DocTypeOpt[];
  docs: DocRow[];
  missing: string[];
  schoolName: string;
}) {
  const t = useTranslations("admissions.status");
  const locale = useLocale();
  const grade = useGrade();
  const router = useRouter();
  const { app } = props;
  const [pending, start] = useTransition();
  const [reply, setReply] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const fmt = (iso: string, time = false) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", ...(time ? { hour: "numeric", minute: "2-digit", weekday: "long" } : {}), timeZone: "Asia/Dubai" }).format(new Date(iso));
  const open = !["enrolled", "declined", "withdrawn"].includes(app.status);
  const expired = app.status === "offer" && app.offerDeadline && new Date(app.offerDeadline).getTime() < Date.now();
  const step = app.status === "waitlisted" ? 0 : Math.max(0, PATH.indexOf(app.status));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t("errors.generic"));
      toast.success(ok);
      after?.();
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight" data-testid="status-child">
              {app.child}
            </h1>
            <p className="text-sm text-muted-foreground">
              {grade(app.grade)} · {app.year} · <span dir="ltr">{app.number}</span>
            </p>
          </div>
          <span data-testid="family-status">
            <FamilyStatusPill status={app.status} />
          </span>
        </div>
        {app.status !== "declined" && app.status !== "withdrawn" && (
          <ol className="mt-5 grid grid-cols-5 gap-1" aria-label={t("progress")}>
            {PATH.map((s, i) => (
              <li key={s} className="min-w-0">
                <div className={cn("h-1.5 rounded-full", i <= step && app.status !== "waitlisted" ? "bg-brand" : "bg-muted")} />
                <div className={cn("mt-1.5 truncate text-[11px]", i <= step && app.status !== "waitlisted" ? "font-medium text-foreground" : "text-muted-foreground")}>{t(`path.${s}`)}</div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-sm text-muted-foreground" data-testid="status-explainer">
          {t(`explain.${app.status}`, { school: props.schoolName })}
        </p>
        {app.submittedAt && <p className="mt-1 text-xs text-muted-foreground">{t("submittedOn", { date: fmt(app.submittedAt) })}</p>}
      </section>

      {props.appointment && open && (
        <section className="flex items-start gap-3 rounded-2xl border bg-card p-5 shadow-sm" data-testid="assessment-card">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
            <CalendarClock className="size-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">{t("assessmentTitle")}</h2>
            <p className="text-sm">{fmt(props.appointment.startsAt, true)}</p>
            {props.appointment.location && <p className="text-xs text-muted-foreground">{props.appointment.location}</p>}
          </div>
        </section>
      )}

      {(app.status === "offer" || app.status === "accepted" || app.status === "enrolled") && app.offerMadeAt && (
        <section className="rounded-2xl border border-gold/40 bg-card p-5 shadow-sm sm:p-6" data-testid="offer-card">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gold-soft text-[oklch(0.5_0.1_80)]">
              <PartyPopper className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{t("offerTitle")}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("offerBody", { grade: grade(app.grade), year: app.year })}</p>
              {app.status === "offer" && app.offerDeadline && (
                <p className={cn("mt-2 text-sm font-medium", expired ? "text-danger" : "")}>{expired ? t("offerExpired") : t("offerDeadline", { date: fmt(app.offerDeadline) })}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/admissions/offer/${app.id}?slug=${props.slug}`} target="_blank" rel="noopener" data-testid="offer-letter">
                <Download className="size-4" />
                {t("offerLetter")}
              </a>
            </Button>
            {app.status === "offer" && !expired && (
              <>
                <Button size="sm" disabled={pending} onClick={() => run(() => respondToOfferAction({ slug: props.slug, locale, applicationId: app.id, accept: true }), t("accepted"))} data-testid="accept-offer">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {t("accept")}
                </Button>
                <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="ghost" disabled={pending}>
                      {t("decline")}
                    </Button>
                  </DialogTrigger>
                  <ReasonDialog title={t("declineTitle")} body={t("declineBody")} confirm={t("declineConfirm")} pending={pending} onConfirm={(reason) => run(() => respondToOfferAction({ slug: props.slug, locale, applicationId: app.id, accept: false, reason }), t("declined"), () => setDeclineOpen(false))} />
                </Dialog>
              </>
            )}
          </div>
          {(app.status === "accepted" || app.status === "enrolled") && app.seatFeeFils > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-3 text-sm" data-testid="seat-fee">
              <CreditCard className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                {t("seatFee", { amount: filsToAed(app.seatFeeFils) })}
                <span className="block text-xs text-muted-foreground">{app.seatPaidAt ? t("seatPaid", { date: fmt(app.seatPaidAt) }) : t("seatUnpaid")}</span>
              </span>
              {!app.seatPaidAt && app.payUrl && (
                <Button asChild size="sm">
                  <a href={app.payUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    {t("payNow")}
                  </a>
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {open && (
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-testid="status-documents">
          <h2 className="text-base font-semibold">{t("documentsTitle")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{props.missing.length ? t("documentsMissing", { n: props.missing.length }) : t("documentsComplete")}</p>
          <div className="mt-3">
            <DocumentUploads slug={props.slug} applicationId={app.id} docTypes={props.docTypes} docs={props.docs} editable />
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" id="conversation" data-testid="family-conversation">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <MessageSquare className="size-4" />
          {t("messagesTitle")}
        </h2>
        {props.messages.length ? (
          <ul className="mt-3 space-y-2">
            {props.messages.map((m) => (
              <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.mine ? "ms-auto bg-brand text-brand-foreground" : "bg-muted")}>
                <div className={cn("text-[11px]", m.mine ? "text-brand-foreground/80" : "text-muted-foreground")}>
                  {m.mine ? t("you") : (m.author ?? t("admissionsTeam"))} · {fmt(m.createdAt)}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("noMessages")}</p>
        )}
        <div className="mt-3 space-y-2">
          <Textarea rows={3} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("replyPlaceholder")} data-testid="family-reply" />
          <Button size="sm" disabled={pending || !reply.trim()} onClick={() => run(() => familyMessageAction({ slug: props.slug, locale, applicationId: app.id, body: reply }), t("sent"), () => setReply(""))} data-testid="family-send">
            <Send className="size-4" />
            {t("send")}
          </Button>
        </div>
      </section>

      {open && (
        <div className="text-center">
          <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                {t("withdraw")}
              </Button>
            </DialogTrigger>
            <ReasonDialog title={t("withdrawTitle")} body={t("withdrawBody")} confirm={t("withdrawConfirm")} pending={pending} onConfirm={(reason) => run(() => withdrawApplicationAction({ slug: props.slug, locale, applicationId: app.id, reason }), t("withdrawn"), () => setWithdrawOpen(false))} />
          </Dialog>
        </div>
      )}
    </div>
  );
}

function ReasonDialog({ title, body, confirm, pending, onConfirm }: { title: string; body: string; confirm: string; pending: boolean; onConfirm: (reason: string) => void }) {
  const t = useTranslations("admissions.status");
  const [reason, setReason] = useState("");
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
      </DialogHeader>
      <Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} />
      <DialogFooter>
        <Button variant="destructive" disabled={pending} onClick={() => onConfirm(reason)}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {confirm}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
