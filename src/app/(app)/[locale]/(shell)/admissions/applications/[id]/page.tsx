import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, CalendarClock, ChevronLeft, Copy, Download, FileText, GraduationCap, HeartPulse, History, MessageSquare, School, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { canEnroll, canManageAdmissions, canOpenAdmissionDoc, canRevealIds, canSeeHealth, canViewAdmissions } from "@/server/admissions/access";
import { applicationDetail } from "@/server/admissions/queries";
import { gradeSeats } from "@/server/admissions/capacity";
import { asTx } from "@/server/admissions/settings";
import { canOffer, filsToAed, seatsAvailable, sectionName } from "@/server/admissions/rules";
import { checkMove, nextMoves, phaseOf, seatFeeRequired } from "@/server/admissions/stages";
import { countryName, languageName, docTypesFor } from "@/server/admissions/config";
import { authorityNames } from "@/server/admissions/page-data";
import { DocumentReview, HealthPanel, NextSteps, PriorityEditor, RevealIdButton, StaffConversation } from "@/components/admissions/detail-panels";
import { StagePill } from "@/components/admissions/ui";
import { RegistrationBadge } from "@/components/admissions/registration";

export async function generateMetadata() {
  const t = await getTranslations("admissions.detail");
  return { title: t("metaTitle") };
}

type Guardian = { relationship: string; firstNameEn: string; lastNameEn: string; firstNameAr?: string; lastNameAr?: string; email: string; phone: string; occupation?: string; employer?: string; livesWith?: boolean; primary?: boolean };
type Schooling = { attended: boolean; schoolName?: string; city?: string; country?: string; curriculum?: string; lastGrade?: string; fromYear?: number | null; toYear?: number | null; leavingReason?: string };

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const d = await applicationDetail(ctx, id);
  if (!d) notFound();
  const t = await getTranslations("admissions.detail");
  const ts = await getTranslations("admissions.stage");
  const tg = await getTranslations("gradeLevel");
  const tf = await getTranslations("admissions.form");
  const trel = await getTranslations("admissions.relationship");
  const tm = await getTranslations("admissions");
  const { app, settings, year } = d;
  const L = ctx.locale;
  const grade = (g: number) => tg("label", gradeLevelValues(g));
  const stageLabel = (k: string) => {
    const s = settings.stages.find((x) => x.key === k);
    return pick(L, s?.labelEn, s?.labelAr) || (ts.has(k) ? ts(k) : k);
  };
  const fmt = (dt: Date | null | undefined, time = false) => (dt ? new Intl.DateTimeFormat(L === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", ...(time ? { hour: "numeric", minute: "2-digit" } : {}), timeZone: "Asia/Dubai" }).format(dt) : "");
  const manage = canManageAdmissions(ctx);
  const seats = year ? await gradeSeats(asTx(ctx.db), ctx.orgId, year, app.gradeLevel) : null;
  const fee = app.seatFeeFils ?? d.capacity?.seatFeeFils ?? 0;
  const feeDue = seatFeeRequired(settings.stages, fee);
  const phase = phaseOf(app.stage, settings.stages);
  const moves = nextMoves(app.stage, settings.stages, { seatFeeRequired: feeDue });
  const simpleMoves = moves.filter((m) => !m.action).map((m) => ({ key: m.key, label: stageLabel(m.key) }));
  const can = {
    offer: checkMove(app.stage, "OFFER_MADE", settings.stages, { seatFeeRequired: feeDue }).ok,
    paid: checkMove(app.stage, "SEAT_PAID", settings.stages, { seatFeeRequired: feeDue }).ok,
    enroll: checkMove(app.stage, "ENROLLED", settings.stages, { seatFeeRequired: feeDue }).ok,
    declined: checkMove(app.stage, "DECLINED", settings.stages, { seatFeeRequired: feeDue }).ok,
    withdrawn: checkMove(app.stage, "WITHDRAWN", settings.stages, { seatFeeRequired: feeDue }).ok,
    assessment: phase === "review" || phase === "waitlist",
  };
  const free = seats ? seatsAvailable(seats) : null;
  const seatsText = seats ? (seats.capacity === null ? t("seatsUnset") : t("seatsLine", { capacity: seats.capacity, enrolled: seats.enrolled, holding: seats.holding, offered: seats.offered, free: free ?? 0 })) : "";
  const guardians = (app.guardians as Guardian[] | null) ?? [];
  const schooling = app.schooling as Schooling | null;
  const declared = (app.siblings as Array<{ name: string; gradeLevel: number | null; studentNo?: string }> | null) ?? [];
  const types = docTypesFor(settings.docTypes, app.gradeLevel, app.nationality).map((x) => ({ key: x.key, label: pick(L, x.labelEn, x.labelAr), required: x.required, category: x.category }));
  const allTypes = settings.docTypes.map((x) => ({ key: x.key, label: pick(L, x.labelEn, x.labelAr), required: x.required, category: x.category }));
  const memberName = (mid: string | null) => {
    const m = d.members.find((x) => x.id === mid);
    return m ? pick(L, m.user.nameEn, m.user.nameAr) : "";
  };
  const name = L === "ar" && app.firstNameAr ? `${app.firstNameAr} ${app.lastNameAr ?? ""}` : `${app.firstNameEn} ${app.lastNameEn}`;
  const altName = L === "ar" ? `${app.firstNameEn} ${app.lastNameEn}` : app.firstNameAr ? `${app.firstNameAr} ${app.lastNameAr ?? ""}` : null;
  const authority = await authorityNames(ctx, settings);
  const registration = app.studentId ? await ctx.db.govRegistration.findFirst({ where: { orgId: ctx.orgId, studentId: app.studentId, kind: "ENROLLMENT" }, orderBy: { createdAt: "desc" } }) : null;
  const startsLater = year ? year.startsOn.getTime() > Date.now() : false;
  const cutoffDate = year ? new Date(Date.UTC(year.entryYear, settings.cutoff.month - 1, settings.cutoff.day)) : null;
  const readmit = d.dupStudents.filter((s) => s.status !== "ACTIVE").map((s) => ({ value: s.id, label: `${pick(L, `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`)} · ${s.studentNo}` }));

  return (
    <PageBody className="max-w-6xl">
      <Link href="/admissions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("back")}
      </Link>
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="app-name">
                {name}
              </h1>
              <span data-testid="app-stage">
                <StagePill stage={app.stage} label={stageLabel(app.stage)} />
              </span>
            </div>
            {altName && <p className="text-sm text-muted-foreground">{altName}</p>}
            <p className="mt-1 text-sm text-muted-foreground">
              {grade(app.gradeLevel)} · {year ? pick(L, year.nameEn, year.nameAr) : ""} · <span dir="ltr">{app.number}</span> · {t("submitted", { date: fmt(app.submittedAt) })}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.age?.flag && (
                <Pill tone="warning">
                  <AlertTriangle className="size-3" />
                  {t(d.age.flag === "UNDER" ? "ageUnder" : "ageOver", { age: d.age.age ?? 0, expected: d.age.expected, grade: grade(app.gradeLevel), date: fmt(cutoffDate) })}
                </Pill>
              )}
              {app.assessmentOutcome && <Pill tone={app.assessmentOutcome === "NOT_RECOMMENDED" ? "danger" : "success"}>{t(`outcome.${app.assessmentOutcome}`)}</Pill>}
              {app.stage === "OFFER_MADE" && app.offerDeadline && <Pill tone={app.offerDeadline.getTime() < Date.now() ? "danger" : "gold"}>{app.offerDeadline.getTime() < Date.now() ? t("offerExpired") : t("offerDue", { date: fmt(app.offerDeadline) })}</Pill>}
              {app.closeReason && <Pill>{t(`closeReason.${app.closeReason}`)}</Pill>}
              {registration && <RegistrationBadge status={registration.status} authority={authority.short} />}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {app.offerMadeAt && (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/admissions/offer/${app.id}`} target="_blank" rel="noopener" data-testid="staff-offer-letter">
                  <Download className="size-4" />
                  {t("offerLetter")}
                </a>
              </Button>
            )}
            {app.studentId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/students/${app.studentId}`}>
                  <GraduationCap className="size-4" />
                  {t("studentRecord")}
                </Link>
              </Button>
            )}
          </div>
        </div>
        {d.flags.length > 0 && (
          <div className="mt-4 space-y-1 rounded-lg border border-danger/30 bg-danger-soft/40 p-3 text-sm" data-testid="duplicates">
            <p className="flex items-center gap-1.5 font-medium text-danger">
              <Copy className="size-4" />
              {t("duplicatesTitle")}
            </p>
            {d.dupApps.map((a) => (
              <p key={a.id}>
                <Link href={`/admissions/applications/${a.id}`} className="text-brand hover:underline">
                  {pick(L, `${a.firstNameEn} ${a.lastNameEn}`, a.firstNameAr ? `${a.firstNameAr} ${a.lastNameAr ?? ""}` : null)} · <span dir="ltr">{a.number}</span>
                </Link>{" "}
                <span className="text-muted-foreground">({d.flags.find((f) => f.id === a.id)?.kind === "eid" ? t("sameEid") : t("sameNameDob")} · {stageLabel(a.stage)})</span>
              </p>
            ))}
            {d.dupStudents.map((s) => (
              <p key={s.id}>
                <Link href={`/students/${s.id}`} className="text-brand hover:underline">
                  {pick(L, `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`)} · {s.studentNo}
                </Link>{" "}
                <span className="text-muted-foreground">({d.flags.find((f) => f.id === s.id)?.kind === "eid" ? t("sameEid") : t("sameNameDob")} · {t(`studentStatus.${s.status}`)})</span>
              </p>
            ))}
          </div>
        )}
        {manage && (
          <div className="mt-4 border-t pt-4">
            <NextSteps
              applicationId={app.id}
              phase={phase}
              stage={app.stage}
              manage={manage}
              enroll={canEnroll(ctx)}
              simpleMoves={simpleMoves}
              can={can}
              labels={{ declined: stageLabel("DECLINED"), withdrawn: stageLabel("WITHDRAWN") }}
              offer={{ days: settings.offerDays, sections: (seats?.sectionSeats ?? []).map((n, i) => ({ value: sectionName(i), label: t("sectionSeats", { name: sectionName(i), n }) })), full: seats ? !canOffer(seats) : false, seats: seatsText, deadline: app.offerDeadline?.toISOString() ?? null }}
              paidAmount={tm("money", { amount: filsToAed(fee) })}
              hosts={d.hosts.map((h) => ({ value: h.id, label: pick(L, h.user.nameEn, h.user.nameAr) }))}
              defaultHost={d.hosts.find((h) => h.id === ctx.membershipId)?.id ?? null}
              outcome={app.assessmentOutcome}
              outcomeNotes={app.assessmentNotes ?? ""}
              homerooms={d.homerooms.map((h) => ({ value: h.id, label: `${pick(L, h.nameEn, h.nameAr)}${h.capacity ? ` (${h._count.enrollments}/${h.capacity})` : ` (${h._count.enrollments})`}` }))}
              readmit={readmit}
              defaultSection={app.offerSection}
              startsLater={startsLater}
            />
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("child")} icon={<GraduationCap className="size-4" />} />
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item k={tf("dateOfBirth")} v={`${fmt(app.dateOfBirth)}${d.age?.age !== null && d.age?.age !== undefined ? ` · ${t("ageOnCutoff", { age: d.age.age, date: fmt(cutoffDate) })}` : ""}`} />
              <Item k={tf("gender")} v={app.gender ? tf(app.gender === "F" ? "girl" : "boy") : ""} />
              <Item k={tf("nationality")} v={countryName(app.nationality, L)} />
              <Item k={tf("homeLanguage")} v={languageName(app.homeLanguage, L)} />
              <div>
                <dt className="text-xs text-muted-foreground">{tf("emiratesId")}</dt>
                <dd>{app.emiratesIdLast4 ? <RevealIdButton applicationId={app.id} field="emiratesId" masked={`784-••••-•••${app.emiratesIdLast4}`} canReveal={canRevealIds(ctx)} /> : <span className="text-muted-foreground">{t("notGiven")}</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{tf("passport")}</dt>
                <dd>{app.passportLast4 ? <RevealIdButton applicationId={app.id} field="passport" masked={`•••••${app.passportLast4}`} canReveal={canRevealIds(ctx)} /> : <span className="text-muted-foreground">{t("notGiven")}</span>}</dd>
              </div>
              {app.curriculum && <Item k={tf("track")} v={tf(`curriculum.${app.curriculum}`)} />}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title={t("schooling")} icon={<School className="size-4" />} />
            {schooling?.attended ? (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item k={tf("schoolName")} v={schooling.schoolName ?? ""} />
                <Item k={tf("country")} v={[schooling.city, countryName(schooling.country, L)].filter(Boolean).join(L === "ar" ? "، " : ", ")} />
                <Item k={tf("previousCurriculum")} v={schooling.curriculum ?? ""} />
                <Item k={tf("lastGrade")} v={schooling.lastGrade ?? ""} />
                <Item k={t("years")} v={[schooling.fromYear, schooling.toYear].filter(Boolean).join(" - ")} />
                <Item k={tf("leavingReason")} v={schooling.leavingReason ?? ""} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t("firstSchool")}</p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title={t("family")} icon={<Users className="size-4" />} />
            <ul className="grid gap-3 sm:grid-cols-2">
              {guardians.map((g, i) => (
                <li key={i} className="rounded-lg border p-3 text-sm" data-testid="guardian-card">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{L === "ar" && g.firstNameAr ? `${g.firstNameAr} ${g.lastNameAr ?? ""}` : `${g.firstNameEn} ${g.lastNameEn}`}</span>
                    <Pill>{trel(g.relationship)}</Pill>
                    {g.primary && <Pill tone="brand">{t("primary")}</Pill>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground" dir="ltr">
                    {g.email}
                  </div>
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {g.phone}
                  </div>
                  {(g.occupation || g.employer) && <div className="text-xs text-muted-foreground">{[g.occupation, g.employer].filter(Boolean).join(" · ")}</div>}
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t pt-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("priorityTitle")}</h3>
              {declared.length > 0 && <p className="mb-2 text-xs text-muted-foreground">{t("declaredSiblings", { list: declared.map((s) => `${s.name}${s.gradeLevel !== null ? ` (${grade(s.gradeLevel)})` : ""}`).join(L === "ar" ? "، " : ", ") })}</p>}
              <PriorityEditor
                applicationId={app.id}
                siblings={d.siblings.map((s) => ({ value: s.id, label: `${pick(L, `${s.firstNameEn} ${s.lastNameEn}`, `${s.firstNameAr} ${s.lastNameAr}`)} · ${grade(s.gradeLevel)}${s.section ?? ""}` }))}
                staffChild={app.staffChild}
                staffChildVerified={app.staffChildVerified}
                boost={app.priorityBoost}
                manage={manage}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t("documents")} icon={<FileText className="size-4" />} description={t("documentsHint")} />
            <DocumentReview
              docs={d.documents.map((x) => ({ id: x.id, typeKey: x.typeKey, fileName: x.fileName, sizeBytes: x.sizeBytes, status: x.status, reviewNote: x.reviewNote, canOpen: canOpenAdmissionDoc(ctx, allTypes.find((ty) => ty.key === x.typeKey)?.category ?? "identity") }))}
              types={allTypes}
              manage={manage}
              missing={d.missing.map((m) => pick(L, m.labelEn, m.labelAr))}
            />
            {types.length === 0 && <p className="text-sm text-muted-foreground">{t("noDocTypes")}</p>}
          </Panel>

          <Panel>
            <div id="conversation" />
            <PanelHeader title={t("conversation")} icon={<MessageSquare className="size-4" />} description={t("conversationHint")} />
            <StaffConversation
              applicationId={app.id}
              manage={manage}
              draft={app.stage === "DRAFT"}
              messages={d.messages.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt.toISOString(), visibility: m.visibility, family: !m.authorMembershipId, author: m.authorMembershipId ? memberName(m.authorMembershipId) : t("theFamily") }))}
            />
          </Panel>
        </div>

        <div className="space-y-6">
          {seats && (
            <Panel>
              <PanelHeader title={t("seatsTitle", { grade: grade(app.gradeLevel) })} />
              {seats.capacity === null ? (
                <p className="text-sm text-muted-foreground">{t("seatsUnset")}</p>
              ) : (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Stat k={t("capacity")} v={seats.capacity} />
                  <Stat k={t("enrolledSeats")} v={seats.enrolled} />
                  <Stat k={t("holdingSeats")} v={seats.holding} />
                  <Stat k={t("offeredSeats")} v={seats.offered} />
                  <Stat k={t("freeSeats")} v={free ?? 0} tone={free !== null && free <= 0 ? "danger" : "success"} />
                  <Stat k={t("waitlisted")} v={seats.waitlisted} />
                </dl>
              )}
              {fee > 0 && <p className="mt-3 text-xs text-muted-foreground">{t("seatFee", { amount: filsToAed(fee) })}{app.seatPaidAt ? ` · ${t("paidOn", { date: fmt(app.seatPaidAt) })}` : ""}{app.seatPaymentRef ? ` · ${app.seatPaymentRef}` : ""}</p>}
            </Panel>
          )}

          {d.appointment && (
            <Panel>
              <PanelHeader title={t("assessment")} icon={<CalendarClock className="size-4" />} />
              <p className="text-sm font-medium">{fmt(d.appointment.startsAt, true)}</p>
              <p className="text-xs text-muted-foreground">{memberName(d.appointment.hostId)} · {pick(L, d.appointment.locationEn, d.appointment.locationAr)}</p>
              <Link href={`/meetings/${d.appointment.id}`} className="mt-1 inline-block text-xs text-brand hover:underline">
                {t("openMeeting")}
              </Link>
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t("health")} icon={<HeartPulse className="size-4" />} />
            <HealthPanel applicationId={app.id} canSee={canSeeHealth(ctx)} hasMedical={app.hasMedical} hasSupport={app.hasSupport} />
          </Panel>

          <Panel>
            <PanelHeader title={t("history")} icon={<History className="size-4" />} />
            <ol className="space-y-2.5 text-sm" data-testid="history">
              {d.events.map((e) => (
                <li key={e.id} className="relative ps-4">
                  <span className="absolute start-0 top-1.5 size-2 rounded-full bg-brand/60" />
                  <div>{e.toStage ? t("eventStage", { stage: stageLabel(e.toStage) }) : t(`event.${e.kind}`)}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmt(e.createdAt, true)} · {e.actorMembershipId ? memberName(e.actorMembershipId) : t("theFamily")}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="break-words">{v || "-"}</dd>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: number; tone?: "danger" | "success" }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{k}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}>{v}</dd>
    </div>
  );
}
