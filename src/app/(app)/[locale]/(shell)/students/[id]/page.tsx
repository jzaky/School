import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, CalendarClock, ChevronLeft, Compass, FileText, FolderKanban, Inbox, Mail, Phone, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { dubaiDayKey, fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { initials, personName, pick, userName } from "@/lib/i18n-data";
import { mask } from "@/lib/crypto";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { CaseStatusBadge, Pill, RequestStatusBadge, SensitivityBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { RevealId } from "@/components/students/reveal-id";
import { listableCaseWhere } from "@/server/access/case-access";
import { requestWhere, isRestrictedForViewer } from "@/server/access/request-access";
import { audit } from "@/server/audit/audit";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx();
  if (!ctx.can("people.view")) notFound();
  const t = await getTranslations("students");
  const ts = await getTranslations("status");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const s = await db.student.findUnique({ where: { id }, include: { guardians: { include: { guardian: true } }, careerProf: true } });
  if (!s || s.orgId !== orgId) notFound();
  const since = new Date(Date.now() - 42 * 86400_000);
  const [cases, requests, appts, enrollments, attendance, docs, recs] = await Promise.all([
    db.case.findMany({ where: { AND: [listableCaseWhere(ctx, "dashboard"), { studentId: s.id }] }, orderBy: { openedAt: "desc" }, take: 8 }),
    db.request.findMany({ where: { AND: [requestWhere(ctx), { studentId: s.id }] }, include: { service: true }, orderBy: { submittedAt: "desc" }, take: 6 }),
    db.case
      .findMany({ where: { AND: [listableCaseWhere(ctx, "dashboard"), { studentId: s.id }] }, select: { id: true } })
      .then((visible) => db.appointment.findMany({ where: { orgId, studentId: s.id, OR: [{ caseId: null }, { caseId: { in: visible.map((v) => v.id) } }] }, include: { type: true }, orderBy: { startsAt: "desc" }, take: 6 })),
    db.enrollment.findMany({ where: { studentId: s.id }, include: { class: { include: { subject: true } } } }),
    db.attendanceRecord.findMany({ where: { studentId: s.id, date: { gte: since } }, orderBy: { date: "asc" } }),
    db.document.findMany({ where: { studentId: s.id, caseId: null, sensitivity: { in: ctx.can("documents.sensitive") || ctx.can("people.reveal_ids") ? ["STANDARD", "CONFIDENTIAL"] : ["STANDARD"] } }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.careerRecommendation.findMany({ where: { studentId: s.id }, include: { career: true }, orderBy: { rank: "asc" }, take: 3 }),
  ]);
  await audit(db, orgId, { actorId: ctx.membershipId, action: "student.view", entityType: "Student", entityId: s.id });
  const teacherIds = enrollments.map((e) => e.class.teacherMembershipId).filter(Boolean) as string[];
  const hostIds = appts.map((a) => a.hostId);
  const people = await db.membership.findMany({ where: { id: { in: [...teacherIds, ...hostIds] } }, include: { user: true } });
  const nameOf = (mid: string | null) => (mid ? userName(people.find((p) => p.id === mid)?.user, locale) : "");
  const homeroom = enrollments.find((e) => e.class.isHomeroom);
  const present = attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const pct = attendance.length ? Math.round((present / attendance.length) * 100) : 100;
  const chosen = s.careerProf?.chosenCareerId ? recs.find((r) => r.careerId === s.careerProf!.chosenCareerId) : null;
  const canReveal = ctx.can("people.reveal_ids");

  return (
    <PageBody>
      <Link href="/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>
      <Panel className="p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <div className="grid size-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand to-[oklch(0.5_0.12_240)] text-2xl font-semibold text-white shadow-sm">{initials(`${s.firstNameEn} ${s.lastNameEn}`)}</div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="student-name">
              {personName(s, locale)}
            </h1>
            <p className="text-muted-foreground">{locale === "ar" ? `${s.firstNameEn} ${s.lastNameEn}` : `${s.firstNameAr} ${s.lastNameAr}`}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill tone="brand">{t("gradeN", { grade: `${s.gradeLevel}${s.section ?? ""}` })}</Pill>
              {homeroom && <Pill>{t("tutor", { name: nameOf(homeroom.class.teacherMembershipId) })}</Pill>}
              {s.houseEn && <Pill tone="gold" >{t("house", { house: pick(locale, s.houseEn, s.houseAr) })}</Pill>}
              {s.hasSen && <Pill tone="info">{t("sen")}</Pill>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/book?student=${s.id}`}>
                <CalendarClock className="size-4" />
                {t("book")}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/services/academic_concern?student=${s.id}`}>{t("refer")}</Link>
            </Button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("cases")} icon={<FolderKanban className="size-4" />} description={t("casesHint")} />
            {cases.length ? (
              <ul className="divide-y">
                {cases.map((c) => (
                  <li key={c.id}>
                    <Link href={`/cases/${c.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{pick(locale, c.titleEn, c.titleAr)}</span>
                        <span className="text-xs text-muted-foreground">
                          {ts(`caseType.${c.type}`)} · {fmtRelative(prefs, c.openedAt)}
                        </span>
                      </span>
                      <SensitivityBadge sensitivity={c.sensitivity} />
                      <CaseStatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noCases")}</p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title={t("attendance")} description={t("attendanceHint", { pct })} />
            <div className="flex flex-wrap gap-1" aria-label={t("attendance")}>
              {attendance.map((a) => (
                <span
                  key={a.id}
                  title={`${dubaiDayKey(a.date)}: ${t(`att.${a.status}`)}`}
                  className={cn("size-4 rounded-sm", a.status === "PRESENT" ? "bg-success/70" : a.status === "LATE" ? "bg-warning/80" : a.status === "EXCUSED" ? "bg-info/60" : "bg-danger/80")}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              {(["PRESENT", "LATE", "EXCUSED", "ABSENT"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-sm", k === "PRESENT" ? "bg-success/70" : k === "LATE" ? "bg-warning/80" : k === "EXCUSED" ? "bg-info/60" : "bg-danger/80")} />
                  {t(`att.${k}`)} {attendance.filter((a) => a.status === k).length}
                </span>
              ))}
            </div>
          </Panel>
          <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
            <Panel>
              <PanelHeader title={t("requests")} icon={<Inbox className="size-4" />} />
              {requests.length ? (
                <ul className="space-y-2">
                  {requests.map((r) => (
                    <li key={r.id}>
                      <Link href={`/requests/${r.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-brand">
                        <span className="truncate">{pick(locale, r.service.nameEn, r.service.nameAr)}</span>
                        <RequestStatusBadge status={r.status} restricted={isRestrictedForViewer(ctx, r)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("none")}</p>
              )}
            </Panel>
            <Panel>
              <PanelHeader title={t("meetings")} icon={<CalendarClock className="size-4" />} />
              {appts.length ? (
                <ul className="space-y-2">
                  {appts.map((a) => (
                    <li key={a.id}>
                      <Link href={`/meetings/${a.id}`} className="block text-sm hover:text-brand">
                        <span className="block truncate">{pick(locale, a.type.nameEn, a.type.nameAr)}</span>
                        <span className="text-xs text-muted-foreground">
                          {fmtDateTime(prefs, a.startsAt)} · {nameOf(a.hostId)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("none")}</p>
              )}
            </Panel>
          </div>
          <Panel>
            <PanelHeader title={t("career")} icon={<Compass className="size-4" />} action={ctx.can("career.advise") ? <Link href={`/career/students/${s.id}`} className="text-xs font-medium text-brand hover:underline">{t("openCareer")}</Link> : undefined} />
            {recs.length ? (
              <div className="flex flex-wrap gap-2">
                {recs.map((r) => (
                  <Pill key={r.id} tone={chosen?.id === r.id ? "brand" : "neutral"}>
                    {pick(locale, r.career.titleEn, r.career.titleAr)} · {r.matchScore}%
                  </Pill>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noCareer")}</p>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title={t("details")} />
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("studentNo")}</dt>
                <dd className="font-mono" dir="ltr">
                  {s.studentNo}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("dob")}</dt>
                <dd>{fmtDate(prefs, s.dateOfBirth)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("nationality")}</dt>
                <dd>{pick(locale, s.nationalityEn, s.nationalityAr)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("enrolled")}</dt>
                <dd>{fmtDate(prefs, s.enrolledOn)}</dd>
              </div>
              {s.emiratesIdEnc && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("emiratesId")}</dt>
                  <dd>
                    <RevealId studentId={s.id} field="emiratesId" masked={mask(s.emiratesIdLast4, "eid")} allowed={canReveal} />
                  </dd>
                </div>
              )}
              {s.passportEnc && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("passport")}</dt>
                  <dd>
                    <RevealId studentId={s.id} field="passport" masked={mask(s.passportLast4, "passport")} allowed={canReveal} />
                  </dd>
                </div>
              )}
            </dl>
          </Panel>
          <Panel>
            <PanelHeader title={t("family")} icon={<Users className="size-4" />} />
            <ul className="space-y-3">
              {s.guardians.map((g) => (
                <li key={g.id} className="text-sm">
                  <div className="font-medium">
                    {personName(g.guardian, locale)} <span className="text-xs font-normal text-muted-foreground">· {pick(locale, g.relationshipEn, g.relationshipAr)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {g.guardian.phone && (
                      <a href={`tel:${g.guardian.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 hover:text-foreground" dir="ltr">
                        <Phone className="size-3" />
                        {g.guardian.phone}
                      </a>
                    )}
                    {g.guardian.email && (
                      <a href={`mailto:${g.guardian.email}`} className="flex items-center gap-1 hover:text-foreground" dir="ltr">
                        <Mail className="size-3" />
                        {g.guardian.email}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title={t("classes")} icon={<BookOpen className="size-4" />} />
            <ul className="space-y-1.5 text-sm">
              {enrollments
                .filter((e) => !e.class.isHomeroom)
                .map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span>{pick(locale, e.class.subject?.nameEn, e.class.subject?.nameAr)}</span>
                    <span className="truncate text-xs text-muted-foreground">{nameOf(e.class.teacherMembershipId)}</span>
                  </li>
                ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title={t("documents")} icon={<FileText className="size-4" />} />
            {docs.length ? (
              <ul className="space-y-2 text-sm">
                {docs.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/documents/${d.id}/download?inline=1`} target="_blank" rel="noreferrer" className="hover:text-brand">
                      {pick(locale, d.titleEn, d.titleAr)}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            )}
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
