import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, Download, FileText, FolderOpen, Lock, MapPin, Phone } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { RequestStatusBadge, PriorityBadge } from "@/components/app/badges";
import { Timeline } from "@/components/app/timeline";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { RequestStepper } from "@/components/requests/request-stepper";
import { ApprovalPanel } from "@/components/requests/approval-panel";
import { CancelRequestButton } from "@/components/requests/cancel-button";
import { requestWhere, isRestrictedForViewer } from "@/server/access/request-access";
import { requestStages } from "@/server/requests/stages";
import { formatAnswers } from "@/server/forms/answers";
import { canViewCase } from "@/server/access/case-access";
import type { FormSchema } from "@/server/forms/schema";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string; danger?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("requests");
  const { db, locale } = ctx;
  const prefs = await formatPrefs(ctx);
  const request = await db.request.findFirst({
    where: { AND: [{ id }, requestWhere(ctx)] },
    include: { service: true, student: true, submission: { include: { formVersion: true } } },
  });
  if (!request) notFound();

  const restricted = isRestrictedForViewer(ctx, request);
  const requester = await db.membership.findUnique({ where: { id: request.requesterId }, include: { user: true } });
  const title = pick(locale, request.titleEn, request.titleAr);

  const [myApprovals, appointments, documents, events] = await Promise.all([
    db.approvalAssignee.findMany({ where: { membershipId: ctx.membershipId, status: "PENDING", approval: { requestId: request.id, status: "PENDING" } } }),
    restricted ? [] : db.appointment.findMany({ where: { requestId: request.id }, include: { type: true }, orderBy: { startsAt: "asc" } }),
    restricted ? [] : db.document.findMany({ where: { requestId: request.id }, orderBy: { createdAt: "desc" } }),
    restricted
      ? []
      : db.timelineEvent.findMany({ where: { requestId: request.id, ...(ctx.isStaff ? {} : { staffOnly: false }) }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const stages = restricted ? [] : await requestStages(ctx, request);
  const answers = !restricted && request.submission ? await formatAnswers(ctx, request.submission.formVersion.schema as unknown as FormSchema, request.submission.data as Record<string, unknown>) : [];
  const hosts = appointments.length ? await db.membership.findMany({ where: { id: { in: appointments.map((a) => a.hostId) } }, include: { user: true } }) : [];
  const theCase = request.caseId && ctx.isStaff ? await db.case.findUnique({ where: { id: request.caseId } }) : null;
  const caseVisible = theCase ? await canViewCase(ctx, theCase, { audit: false }) : false;
  const open = !["COMPLETED", "REJECTED", "CANCELLED"].includes(request.status);
  const actorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))] as string[];
  const actors = actorIds.length ? await db.membership.findMany({ where: { id: { in: actorIds } }, include: { user: true } }) : [];

  let dsl: { name: string; phone: string | null } | null = null;
  if (sp.danger === "1") {
    const role = await db.membershipRole.findFirst({ where: { role: { key: "dsl" } }, include: { membership: { include: { user: true, staffProfile: true } } } });
    if (role) dsl = { name: userName(role.membership.user, locale), phone: role.membership.staffProfile?.phone ?? null };
  }

  return (
    <PageBody className="max-w-6xl">
      <Link href="/requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>

      {sp.danger === "1" && (
        <div className="rounded-xl border-2 border-danger bg-danger-soft p-5 text-danger" role="alert" data-testid="emergency-guidance">
          <div className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-5" />
            {t("emergencyTitle")}
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-sm text-foreground">
            <li>{t("emergency1")}</li>
            <li>{t("emergency2", { name: dsl?.name ?? "" })}</li>
            <li>{t("emergency3")}</li>
            <li>{t("emergency4")}</li>
          </ol>
          {dsl?.phone && (
            <a href={`tel:${dsl.phone.replace(/\s/g, "")}`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white">
              <Phone className="size-4" />
              <span dir="ltr">{dsl.phone}</span>
            </a>
          )}
          <p className="mt-3 text-xs">{t("emergencyAlerted")}</p>
        </div>
      )}
      {sp.submitted === "1" && sp.danger !== "1" && (
        <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success-soft p-4" data-testid="submitted-banner">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <div>
            <div className="text-sm font-semibold">{t("submittedTitle")}</div>
            <div className="text-sm text-muted-foreground">{t("submittedBody", { number: request.number })}</div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Icon name={request.service.icon} className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono" dir="ltr">
                {request.number}
              </span>
              <span>·</span>
              <span>{pick(locale, request.service.nameEn, request.service.nameAr)}</span>
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl" data-testid="request-title" data-status={request.status}>
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RequestStatusBadge status={request.status} restricted={restricted} />
              {!restricted && request.priority !== "MEDIUM" && <PriorityBadge priority={request.priority} />}
              {!restricted && request.currentStepEn && open && <span className="text-sm text-muted-foreground">{pick(locale, request.currentStepEn, request.currentStepAr)}</span>}
            </div>
          </div>
        </div>
        {open && request.requesterId === ctx.membershipId && !restricted && <CancelRequestButton requestId={request.id} />}
      </div>

      {restricted ? (
        <Panel className="flex items-start gap-4 p-6" >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-700">
            <Lock className="size-5" />
          </span>
          <div>
            <div className="text-sm font-semibold">{t("restrictedTitle")}</div>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("restrictedBody")}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("submittedOn", { date: fmtDateTime(prefs, request.submittedAt) })}
            </p>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Panel className="p-6">
              <PanelHeader title={t("progress")} description={request.slaDueAt && open ? t("expectedBy", { date: fmtDate(prefs, request.slaDueAt) }) : undefined} />
              <RequestStepper
                stages={stages.map((s) => ({ id: s.id, label: s.label, state: s.state, who: s.who, comment: s.comment, signed: s.signed, when: s.at ? fmtDateTime(prefs, s.at) : null }))}
              />
            </Panel>
            {answers.length > 0 && (
              <Panel className="p-6">
                <PanelHeader title={t("details")} />
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {answers.map((a) => (
                    <div key={a.id} className={a.kind !== "text" ? "sm:col-span-2" : undefined}>
                      <dt className="text-xs text-muted-foreground">{a.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-line text-sm">
                        {a.kind === "signature" && a.value.startsWith("data:image") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.value} alt={a.label} className="h-16 rounded border bg-white" />
                        ) : (
                          a.value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}
            <Panel className="p-6">
              <PanelHeader title={t("activity")} />
              <Timeline
                items={events.map((e) => {
                  const actor = actors.find((a) => a.id === e.actorId);
                  return {
                    id: e.id,
                    kind: e.kind,
                    title: pick(locale, e.titleEn, e.titleAr),
                    body: pick(locale, e.bodyEn, e.bodyAr) || null,
                    when: fmtRelative(prefs, e.createdAt),
                    whenTitle: fmtDateTime(prefs, e.createdAt),
                    actor: actor ? userName(actor.user, locale) : null,
                  };
                })}
              />
            </Panel>
          </div>

          <aside className="space-y-4">
            {myApprovals.map((a) => (
              <Panel key={a.id} className="border-warning/40 bg-warning-soft/40">
                <ApprovalPanel assigneeRowId={a.id} label={pick(locale, a.labelEn, a.labelAr)} requireSignature={a.requireSignature} signerName={userName(ctx.user, locale)} />
              </Panel>
            ))}
            <Panel>
              <dl className="space-y-3 text-sm">
                {request.student && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("student")}</dt>
                    <dd className="font-medium">
                      {ctx.isStaff ? (
                        <Link href={`/students/${request.student.id}`} className="hover:text-brand">
                          {personName(request.student, locale)}
                        </Link>
                      ) : (
                        personName(request.student, locale)
                      )}
                      <span className="ms-2 text-xs text-muted-foreground">
                        {request.student.gradeLevel}
                        {request.student.section}
                      </span>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">{t("requestedBy")}</dt>
                  <dd className="font-medium">{requester ? userName(requester.user, locale) : ""}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("submittedAt")}</dt>
                  <dd>{fmtDateTime(prefs, request.submittedAt)}</dd>
                </div>
                {request.completedAt && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("closedAt")}</dt>
                    <dd>{fmtDateTime(prefs, request.completedAt)}</dd>
                  </div>
                )}
              </dl>
            </Panel>
            {appointments.map((a) => {
              const host = hosts.find((h) => h.id === a.hostId);
              return (
                <Panel key={a.id}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <CalendarClock className="size-3.5" />
                    {pick(locale, a.type.nameEn, a.type.nameAr)}
                  </div>
                  <div className="text-base font-semibold">{fmtDateTime(prefs, a.startsAt)}</div>
                  <div className="text-sm text-muted-foreground">{host ? userName(host.user, locale) : ""}</div>
                  {a.locationEn && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5" />
                      {pick(locale, a.locationEn, a.locationAr)}
                    </div>
                  )}
                  <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                    <Link href={`/meetings/${a.id}`} data-testid="view-meeting">{t("viewMeeting")}</Link>
                  </Button>
                </Panel>
              );
            })}
            {documents.length > 0 && (
              <Panel>
                <div className="mb-3 text-xs font-medium text-muted-foreground">{t("documents")}</div>
                <ul className="space-y-2">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 rounded-lg border p-3" data-testid="generated-document">
                      <FileText className="size-5 shrink-0 text-brand" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{pick(locale, d.titleEn, d.titleAr)}</div>
                        <div className="text-xs text-muted-foreground">{fmtDate(prefs, d.createdAt)}</div>
                      </div>
                      <Button asChild size="icon" variant="ghost" aria-label={t("download")}>
                        <a href={`/api/documents/${d.id}/download`} data-testid="download-document">
                          <Download className="size-4" />
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {theCase && caseVisible && (
              <Panel>
                <Link href={`/cases/${theCase.id}`} className="flex items-center gap-3 text-sm hover:text-brand" data-testid="linked-case">
                  <FolderOpen className="size-5 text-brand" />
                  <span className="flex-1">
                    <span className="block font-medium">{t("linkedCase")}</span>
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {theCase.number}
                    </span>
                  </span>
                </Link>
              </Panel>
            )}
          </aside>
        </div>
      )}
    </PageBody>
  );
}
