import { getTranslations } from "next-intl/server";
import { ArrowLeft, Download, FileArchive, ShieldOff, Trash2, UserRound, UserSearch } from "lucide-react";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { ErasureFlow, LogDsrButton, SubjectFinder } from "@/components/privacy/subject-tools";
import { isSubjectKind, resolveSubject } from "@/server/privacy/subject";

export async function generateMetadata() {
  const t = await getTranslations("privacy");
  return { title: t("personTitle") };
}

export default async function PersonDataPage({ searchParams }: { searchParams: Promise<{ kind?: string; id?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePermission("compliance.manage");
  const t = await getTranslations("privacy");
  const tc = await getTranslations("adminCompliance");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const subject = isSubjectKind(sp.kind) && sp.id ? await resolveSubject(db, orgId, { kind: sp.kind, id: sp.id }) : null;
  const dsrs = subject
    ? await db.dataSubjectRequest.findMany({
        where: { orgId, ...(subject.kind === "student" ? { studentId: subject.id } : subject.kind === "guardian" ? { guardianId: subject.id } : { membershipId: subject.id }) },
        orderBy: { receivedAt: "desc" },
      })
    : [];
  const demoPersona = subject?.membershipId && ctx.org.isDemo ? (await db.demoPersona.count({ where: { orgId, membershipId: subject.membershipId } })) > 0 : false;
  const self = subject?.membershipId === ctx.membershipId;
  const exportHref = (dsrId?: string) => `/api/admin/privacy/export?kind=${subject!.kind}&id=${subject!.id}${dsrId ? `&dsr=${dsrId}` : ""}`;

  return (
    <PageBody>
      <PageHeader
        title={t("personTitle")}
        description={t("personSubtitle")}
        actions={
          <Button size="sm" variant="ghost" asChild>
            <Link href="/admin/compliance">
              <ArrowLeft className="size-4 rtl:rotate-180" />
              {tc("title")}
            </Link>
          </Button>
        }
      />
      <Panel>
        <PanelHeader title={t("findPerson")} description={t("findPersonHint")} icon={<UserSearch className="size-4" />} />
        <SubjectFinder />
      </Panel>

      {!subject ? (
        sp.id ? (
          <EmptyState icon={<UserRound className="size-5" />} title={t("personNotFound")} body={t("personNotFoundHint")} />
        ) : (
          <EmptyState icon={<UserSearch className="size-5" />} title={t("pickPerson")} body={t("pickPersonHint")} />
        )
      ) : (
        <>
          <Panel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold" data-testid="person-name">
                  {pick(locale, subject.name.en, subject.name.ar)}
                  <Pill tone={subject.kind === "student" ? "brand" : subject.kind === "guardian" ? "info" : "neutral"}>{t(`kind.${subject.kind}`)}</Pill>
                  {subject.anonymisedAt && <Pill tone="warning">{t("anonymisedOn", { date: fmtDate(prefs, subject.anonymisedAt) })}</Pill>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("reference")}: <span dir="ltr">{subject.reference}</span>
                </p>
              </div>
              <LogDsrButton preset={{ kind: subject.kind, id: subject.id, name: pick(locale, subject.name.en, subject.name.ar) }} />
            </div>
          </Panel>

          <Panel padded={false}>
            <div className="p-5 pb-0">
              <PanelHeader title={t("requestsTitle")} description={t("requestsHint")} icon={<FileArchive className="size-4" />} />
            </div>
            {dsrs.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">{t("noRequests")}</p>
            ) : (
              <ul className="divide-y">
                {dsrs.map((d) => (
                  <li key={d.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="person-dsr">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="font-mono text-xs" dir="ltr">
                          {d.number}
                        </span>
                        {tc(`dsrType.${d.type}`)}
                        <Pill tone={d.status === "COMPLETED" ? "success" : d.status === "REJECTED" ? "neutral" : "info"}>{tc(`dsrStatus.${d.status}`)}</Pill>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.requesterName} · {tc("due", { date: fmtDate(prefs, d.dueAt) })}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" asChild>
                      <a href={exportHref(d.id)} download data-testid="export-for-dsr">
                        <Download className="size-4" />
                        {t("exportForRequest", { number: d.number })}
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel>
              <PanelHeader title={t("exportTitle")} description={t("exportHint")} icon={<Download className="size-4" />} />
              <ul className="mb-4 list-disc space-y-1 ps-5 text-xs text-muted-foreground">
                <li>{t("exportIncludes1")}</li>
                <li>{t("exportIncludes2")}</li>
                <li>{t("exportIncludes3")}</li>
              </ul>
              <Button variant="outline" asChild>
                <a href={exportHref()} download data-testid="export-no-request">
                  <Download className="size-4" />
                  {t("exportWithoutRequest")}
                </a>
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">{t("exportWithoutRequestHint")}</p>
            </Panel>
            <Panel>
              <PanelHeader title={t("eraseTitle")} description={t("eraseHint")} icon={<Trash2 className="size-4" />} />
              {subject.anonymisedAt ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldOff className="size-4" />
                  {t("alreadyAnonymised")}
                </p>
              ) : demoPersona ? (
                <p className="text-sm text-muted-foreground">{t("error.DEMO_PERSONA")}</p>
              ) : self ? (
                <p className="text-sm text-muted-foreground">{t("error.SELF")}</p>
              ) : (
                <ErasureFlow kind={subject.kind} id={subject.id} reference={subject.reference} dsrs={dsrs.filter((d) => d.type === "DELETION" && d.status !== "COMPLETED" && d.status !== "REJECTED").map((d) => ({ id: d.id, number: d.number }))} />
              )}
            </Panel>
          </div>
        </>
      )}
    </PageBody>
  );
}
