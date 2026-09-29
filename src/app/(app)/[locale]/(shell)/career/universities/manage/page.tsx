import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, Database, Landmark, ListChecks, ShieldCheck, TriangleAlert } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { ImportButton, MarkCheckedButton, ProgramDialog, UniversityDialog } from "@/components/pathways/pathway-admin";
import { countryLabel, subjectLabel } from "@/components/pathways/pathway-ui";
import { loadSnapshot } from "@/server/pathways/us-data";
import { PATHWAY_SUBJECTS } from "@/server/pathways/subjects";
import { APPLY_ROUTES, DEGREES, FIELDS } from "@/server/pathways/types";

export async function generateMetadata() {
  const t = await getTranslations("pathways.admin");
  return { title: t("title") };
}

const EXAMPLE = JSON.stringify(
  {
    route: { via: "UCAS", deadlines: [{ kind: "equal", month: 1, day: 14 }] },
    admissionsTests: [],
    BRITISH: { grades: "AAA", subjects: [{ code: "MATH", min: "A" }] },
    IB: { points: 36, hl: [{ code: "MATH", min: "6" }] },
    AMERICAN: { testPolicy: "OPTIONAL" },
    JORDAN_TAWJIHI: { streams: ["SCIENTIFIC"] },
  },
  null,
  2,
);

export default async function ManagePathwaysPage() {
  const ctx = await getCtx();
  if (!ctx.can("pathways.manage")) notFound();
  const t = await getTranslations("pathways");
  const ta = await getTranslations("pathways.admin");
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { db, orgId, locale } = ctx;
  const [uniCount, usCount, programs, runs] = await Promise.all([
    db.university.count({ where: { orgId } }),
    db.university.count({ where: { orgId, scorecardId: { not: null } } }),
    db.universityProgram.findMany({ where: { orgId }, orderBy: [{ lastVerifiedAt: { sort: "asc", nulls: "first" } }, { nameEn: "asc" }] }),
    db.jobRun.findMany({ where: { orgId, queue: "pathways", name: "scorecard_import" }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const unis = await db.university.findMany({ where: { orgId, OR: [{ id: { in: [...new Set(programs.map((p) => p.universityId))] } }, { key: { startsWith: "custom-" } }, { scorecardId: null }] }, orderBy: [{ countryCode: "asc" }, { nameEn: "asc" }] });
  const uniById = new Map(unis.map((u) => [u.id, u]));
  const checked = programs.filter((p) => p.lastVerifiedAt && !p.indicative).length;
  const snapshot = loadSnapshot();
  const keySet = !!process.env.COLLEGE_SCORECARD_API_KEY;
  const routes = APPLY_ROUTES.map((r) => ({ value: r, label: t(`route.${r}`) }));
  const months = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2001, i, 15))) }));
  const uniOpts = unis.map((u) => ({ value: u.id, label: `${pick(locale, u.nameEn, u.nameAr)} (${u.countryCode})` }));
  const subjects = PATHWAY_SUBJECTS.map((c) => ({ value: c, label: subjectLabel(t, c) }));
  const fields = FIELDS.map((f) => ({ value: f, label: t(`field.${f}`) }));
  const degrees = DEGREES.map((d) => ({ value: d, label: d }));

  return (
    <PageBody>
      <Link href="/career/universities" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>
      <PageHeader
        title={ta("title")}
        description={ta("subtitle")}
        actions={
          <>
            <UniversityDialog initial={null} routes={routes} months={months} />
            <ProgramDialog initial={null} universities={uniOpts} fields={fields} degrees={degrees} subjects={subjects} example={EXAMPLE} />
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={ta("statUniversities")} value={fmt(uniCount)} icon={<Landmark className="size-4" />} />
        <StatCard label={ta("statUs")} value={fmt(usCount)} icon={<Database className="size-4" />} tone="info" />
        <StatCard label={ta("statChecked")} value={fmt(checked)} icon={<ShieldCheck className="size-4" />} tone="success" />
        <StatCard label={ta("statUnchecked")} value={fmt(programs.length - checked)} icon={<TriangleAlert className="size-4" />} tone="warning" />
      </div>

      <Panel>
        <PanelHeader title={ta("scorecardTitle")} icon={<Database className="size-4" />} description={ta("scorecardDesc")} action={<ImportButton />} />
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground">{ta("apiKey")}</div>
            <div>{keySet ? ta("keySet") : ta("keyDemo")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{ta("snapshot")}</div>
            <div>{snapshot ? ta("snapshotRows", { n: fmt(snapshot.rows.length), date: fmtDate(prefs, snapshot.fetchedAt) }) : ta("noSnapshot")}</div>
          </div>
        </div>
        {runs.length > 0 && (
          <ul className="mt-4 divide-y rounded-lg border text-sm" data-testid="import-runs">
            {runs.map((r) => {
              const res = (r.result ?? {}) as { created?: number; updated?: number; linked?: number; error?: string };
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="flex-1 text-muted-foreground">{fmtDateTime(prefs, r.createdAt)}</span>
                  {r.status === "COMPLETED" ? (
                    <Pill tone="success">{ta("runDone", { created: res.created ?? 0, updated: res.updated ?? 0, linked: res.linked ?? 0 })}</Pill>
                  ) : r.status === "FAILED" ? (
                    <Pill tone="danger">{ta(`importError.${res.error ?? "unreachable"}`)}</Pill>
                  ) : (
                    <Pill tone="info">{ta("importing")}</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{ta("scorecardHelp")}</p>
      </Panel>

      <Panel>
        <PanelHeader title={ta("programmes")} icon={<ListChecks className="size-4" />} description={ta("programmesDesc")} />
        <ul className="divide-y rounded-lg border" data-testid="manage-programs">
          {programs.map((p) => {
            const u = uniById.get(p.universityId);
            const isChecked = !!p.lastVerifiedAt && !p.indicative;
            return (
              <li key={p.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link href={`/career/universities/programs/${p.id}`} className="block truncate text-sm font-medium hover:text-brand">
                    {pick(locale, p.nameEn, p.nameAr)}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">{u ? `${pick(locale, u.nameEn, u.nameAr)} · ${countryLabel(u.countryCode, locale)}` : ""}</span>
                </div>
                <Pill tone={isChecked ? "success" : "warning"}>{isChecked ? t("checkedOn", { date: fmtDate(prefs, p.lastVerifiedAt) }) : t("indicative")}</Pill>
                <div className="flex items-center gap-1">
                  <MarkCheckedButton programId={p.id} hasSource={!!p.sourceUrl} />
                  <ProgramDialog
                    initial={{
                      id: p.id,
                      universityId: p.universityId,
                      nameEn: p.nameEn,
                      nameAr: p.nameAr,
                      field: p.field,
                      degree: p.degree,
                      durationYears: String(p.durationYears),
                      requiredSubjects: p.requiredSubjects,
                      recommendedSubjects: p.recommendedSubjects,
                      requirementsJson: JSON.stringify(p.requirements ?? {}, null, 2),
                      englishJson: p.englishReq ? JSON.stringify(p.englishReq) : "",
                      notesEn: p.notesEn ?? "",
                      notesAr: p.notesAr ?? "",
                      sourceUrl: p.sourceUrl ?? "",
                    }}
                    universities={uniOpts}
                    fields={fields}
                    degrees={degrees}
                    subjects={subjects}
                    example={EXAMPLE}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title={ta("universities")} icon={<Landmark className="size-4" />} description={ta("universitiesDesc")} />
        <ul className="divide-y rounded-lg border" data-testid="manage-universities">
          {unis.map((u) => (
            <li key={u.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <Link href={`/career/universities/${u.id}`} className="block truncate text-sm font-medium hover:text-brand">
                  {pick(locale, u.nameEn, u.nameAr)}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {pick(locale, u.cityEn, u.cityAr)}, {countryLabel(u.countryCode, locale)}
                </span>
              </div>
              <UniversityDialog
                initial={{ id: u.id, nameEn: u.nameEn, nameAr: u.nameAr, countryCode: u.countryCode, cityEn: u.cityEn, cityAr: u.cityAr, website: u.website ?? "", applyVia: u.applyVia ?? "none", deadlineMonth: u.deadlineMonth ? String(u.deadlineMonth) : "none" }}
                routes={routes}
                months={months}
              />
            </li>
          ))}
        </ul>
      </Panel>
    </PageBody>
  );
}
