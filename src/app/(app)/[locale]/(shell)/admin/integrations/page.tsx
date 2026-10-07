import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, BookOpen, CalendarClock, FileJson, History, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { API_AREAS, choiceFromScopes } from "@/lib/integrations/scopes";
import { SYNC_COLUMNS, SYNC_KINDS, isSyncKind } from "@/lib/integrations/kinds";
import { FAILURE_ALERT_AFTER } from "@/lib/integrations/schedule";
import { MAX_BATCH } from "@/lib/integrations/api-records";
import { cleanMapping } from "@/lib/integrations/mapping";
import { MAX_ACTIVE_KEYS, RATE_LIMIT_PER_MINUTE } from "@/server/integrations/keys";
import { MAX_SOURCES } from "@/server/integrations/sync";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill, type Tone } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { AccessTabs } from "@/components/access/access-tabs";
import { CodeBlock, CopyValue, CreateKeyButton, RevokeKeyButton } from "@/components/integrations/api-keys";
import { SourceDialogButton, SourceRowActions, type SourceValue } from "@/components/integrations/sync-sources";

export async function generateMetadata() {
  const t = await getTranslations("integrations");
  return { title: t("title") };
}

type Tab = "keys" | "sync" | "docs";
const RUN_TONE: Record<string, Tone> = { QUEUED: "info", RUNNING: "info", SUCCEEDED: "success", PARTIAL: "warning", FAILED: "danger" };

async function baseUrl() {
  const env = process.env.APP_URL || process.env.AUTH_URL;
  if (env) return env.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("integrations.manage")) notFound();
  const t = await getTranslations("integrations");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const tab: Tab = sp.tab === "sync" || sp.tab === "docs" ? sp.tab : "keys";
  const now = new Date();
  const n = (x: number) => fmtNumber(prefs, x);

  const [keys, sources, runs] = await Promise.all([
    db.apiKey.findMany({ orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], take: 100 }),
    db.syncSource.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, kind: true, url: true, authType: true, secretEnc: true, mapping: true, schedule: true, hour: true, enabled: true, lastRunAt: true, lastStatus: true, consecutiveFailures: true } }),
    db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 40, select: { id: true, sourceId: true, trigger: true, status: true, startedAt: true, finishedAt: true, total: true, created: true, updated: true, unchanged: true, failed: true, errorCode: true, actorId: true } }),
  ]);
  const memberIds = [...new Set([...keys.map((k) => k.createdById), ...runs.map((r) => r.actorId).filter((x): x is string => !!x)])];
  const members = memberIds.length ? await db.membership.findMany({ where: { id: { in: memberIds } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [];
  const nameOf = (id: string | null) => userName(members.find((m) => m.id === id)?.user, locale) || t("someone");
  const activeKeys = keys.filter((k) => !k.revokedAt).length;
  const base = await baseUrl();

  const sourceValues: SourceValue[] = sources
    .filter((s) => isSyncKind(s.kind))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind as SourceValue["kind"],
      url: s.url,
      authType: (["NONE", "BASIC", "BEARER"].includes(s.authType) ? s.authType : "NONE") as SourceValue["authType"],
      hasSecret: !!s.secretEnc,
      mapping: cleanMapping(s.mapping, SYNC_COLUMNS[s.kind as SourceValue["kind"]]),
      schedule: s.schedule === "HOURLY" ? "HOURLY" : "DAILY",
      hour: s.hour,
      enabled: s.enabled,
    }));
  const runningIds = new Set(runs.filter((r) => (r.status === "QUEUED" || r.status === "RUNNING") && now.getTime() - r.startedAt.getTime() < 10 * 60_000).map((r) => r.sourceId));
  const failing = sources.filter((s) => s.consecutiveFailures >= FAILURE_ALERT_AFTER);

  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          tab === "keys" ? (
            <CreateKeyButton disabledReason={activeKeys >= MAX_ACTIVE_KEYS ? t("keys.tooMany", { max: MAX_ACTIVE_KEYS }) : null} />
          ) : tab === "sync" ? (
            <SourceDialogButton disabledReason={sources.length >= MAX_SOURCES ? t("sync.tooMany", { max: MAX_SOURCES }) : null} />
          ) : (
            <Button variant="outline" asChild>
              <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" data-testid="openapi-link">
                <FileJson className="size-4" />
                {t("docs.openapi")}
              </a>
            </Button>
          )
        }
      />
      <AccessTabs
        current={tab}
        label={t("title")}
        tabs={[
          { value: "keys", label: t("tabs.keys"), href: "/admin/integrations", count: activeKeys },
          { value: "sync", label: t("tabs.sync"), href: "/admin/integrations?tab=sync", count: sources.length },
          { value: "docs", label: t("tabs.docs"), href: "/admin/integrations?tab=docs" },
        ]}
      />

      {tab === "keys" && (
        <div className="space-y-4">
          <Panel padded={false}>
            <div className="flex items-start gap-3 p-4 text-sm sm:p-5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
              <p className="text-muted-foreground">{t("keys.intro", { limit: RATE_LIMIT_PER_MINUTE })}</p>
            </div>
          </Panel>
          {keys.length === 0 ? (
            <EmptyState icon={<KeyRound className="size-5" />} title={t("keys.empty")} body={t("keys.emptyBody")} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="hidden gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_120px]">
                <span>{t("keys.colKey")}</span>
                <span>{t("keys.colScopes")}</span>
                <span>{t("keys.colUse")}</span>
                <span className="text-end">{t("colActions")}</span>
              </div>
              <ul className="divide-y">
                {keys.map((k) => {
                  const choice = choiceFromScopes(k.scopes);
                  return (
                    <li key={k.id} className="grid gap-2 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_120px] lg:items-center lg:gap-3" data-testid="api-key-row">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{k.label}</span>
                          {k.revokedAt ? <Pill tone="danger" dot>{t("keys.revokedState")}</Pill> : <Pill tone="success" dot>{t("keys.active")}</Pill>}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                          {`${k.prefix}…`}
                        </div>
                        <div className="text-xs text-muted-foreground">{t("keys.createdBy", { name: nameOf(k.createdById), date: fmtDateTime(prefs, k.createdAt) })}</div>
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1">
                        {API_AREAS.filter((a) => choice[a] !== "none").map((a) => (
                          <Pill key={a} tone={choice[a] === "write" ? "brand" : "neutral"}>
                            {t("keys.scopeChip", { area: t(`areas.${a}`), level: t(`levels.${choice[a]}`) })}
                          </Pill>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {k.lastUsedAt ? t("keys.lastUsed", { when: fmtRelative(prefs, k.lastUsedAt, now), count: n(k.useCount) }) : t("keys.neverUsed")}
                        {k.revokedAt && <div>{t("keys.revokedOn", { date: fmtDateTime(prefs, k.revokedAt) })}</div>}
                      </div>
                      <div className="flex lg:justify-end">{!k.revokedAt && <RevokeKeyButton id={k.id} label={k.label} />}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "sync" && (
        <div className="space-y-4">
          <Panel padded={false}>
            <div className="flex items-start gap-3 p-4 text-sm sm:p-5">
              <RefreshCw className="mt-0.5 size-4 shrink-0 text-brand" />
              <div className="min-w-0 flex-1 space-y-1 text-muted-foreground">
                <p>{t("sync.intro")}</p>
                <p className="text-xs">{t("sync.sftpNote")}</p>
                <p className="pt-1 text-xs">{t("sync.sampleNote")}</p>
                <div className="max-w-xl">
                  <CopyValue value={`${base}/api/v1/samples/sis-students.csv`} testId="sample-url" />
                </div>
              </div>
            </div>
          </Panel>
          {failing.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert" data-testid="sync-failing">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{t("sync.failingBanner", { names: failing.map((s) => s.name).join(locale === "ar" ? "، " : ", "), count: FAILURE_ALERT_AFTER })}</span>
            </div>
          )}
          {sourceValues.length === 0 ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title={t("sync.empty")} body={t("sync.emptyBody")} />
          ) : (
            <ul className="space-y-3">
              {sourceValues.map((s) => {
                const raw = sources.find((x) => x.id === s.id)!;
                let host = "";
                try {
                  host = new URL(s.url).host;
                } catch {
                  host = s.url;
                }
                return (
                  <li key={s.id} className="rounded-xl border bg-card p-4 shadow-xs sm:p-5" data-testid="source-row">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{s.name}</span>
                          <Pill tone="brand">{t(`kinds.${s.kind}`)}</Pill>
                          {!s.enabled && <Pill>{t("sync.paused")}</Pill>}
                          {raw.lastStatus && (
                            <Pill tone={RUN_TONE[raw.lastStatus] ?? "neutral"} dot>
                              {t(`runStatus.${raw.lastStatus}`)}
                            </Pill>
                          )}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                          {host}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {s.schedule === "HOURLY" ? t("sync.everyHour") : t("sync.everyDay", { time: `${String(s.hour).padStart(2, "0")}:00` })}
                          {" · "}
                          {t(`authTypes.${s.authType}`)}
                          {" · "}
                          {Object.keys(s.mapping).length ? t("sync.mapped", { count: Object.keys(s.mapping).length }) : t("sync.templateFormat")}
                        </div>
                        <div className="text-xs text-muted-foreground">{raw.lastRunAt ? t("sync.lastRun", { when: fmtRelative(prefs, raw.lastRunAt, now) }) : t("sync.neverRun")}</div>
                      </div>
                      <SourceRowActions source={s} running={runningIds.has(s.id)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <Panel>
            <PanelHeader title={t("runs.title")} description={t("runs.body")} icon={<History className="size-4" />} />
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("runs.empty")}</p>
            ) : (
              <ul className="divide-y rounded-lg border" data-testid="run-history">
                {runs.map((r) => {
                  const src = sources.find((s) => s.id === r.sourceId);
                  return (
                    <li key={r.id} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)] sm:items-center sm:gap-3" data-testid="run-row">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{src?.name ?? t("runs.deletedSource")}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDateTime(prefs, r.startedAt)} · {r.trigger === "MANUAL" ? t("runs.manual", { name: nameOf(r.actorId) }) : t("runs.scheduled")}
                        </div>
                      </div>
                      <div>
                        <Pill tone={RUN_TONE[r.status] ?? "neutral"} dot>
                          {t(`runStatus.${r.status}`)}
                        </Pill>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.errorCode && r.status === "FAILED" ? (
                          <span className="text-danger">{t.has(`runError.${r.errorCode}`) ? t(`runError.${r.errorCode}`) : t("runError.INTERNAL")}</span>
                        ) : r.status === "QUEUED" || r.status === "RUNNING" ? (
                          t("runs.inProgress")
                        ) : (
                          t("runs.counts", { total: n(r.total), created: n(r.created), updated: n(r.updated + r.unchanged), failed: n(r.failed) })
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {t("runs.importHistory")}{" "}
              <Link href="/admin/import" className="font-medium text-brand hover:underline">
                {t("runs.openImport")}
              </Link>
            </p>
          </Panel>
        </div>
      )}

      {tab === "docs" && docs()}
    </PageBody>
  );

  function docs() {
    const api = `${base}/api/v1`;
    const studentExample = JSON.stringify(
      {
        students: [
          {
            student_no: "S-10001",
            first_name_en: "Maya",
            last_name_en: "Haddad",
            first_name_ar: "مايا",
            last_name_ar: "حداد",
            grade: 10,
            section: "A",
            date_of_birth: "2010-03-18",
            guardians: [{ first_name_en: "Nour", last_name_en: "Haddad", email: "nour.haddad@example.com", phone: "+971 50 000 0000", relationship: "mother" }],
          },
        ],
      },
      null,
      2,
    );
    const curlPost = `curl -X POST ${api}/students \\\n  -H "Authorization: Bearer hzk_..." \\\n  -H "Content-Type: application/json" \\\n  -d '${studentExample.replace(/'/g, "'\\''")}'`;
    const curlGet = `curl "${api}/students?limit=100" \\\n  -H "Authorization: Bearer hzk_..."\n\n# ${t("docs.nextPage")}\ncurl "${api}/students?limit=100&cursor=NEXT_CURSOR" \\\n  -H "Authorization: Bearer hzk_..."`;
    const response = JSON.stringify({ import_id: "clx...", total: 1, created: 1, updated: 0, unchanged: 0, failed: 0, errors: [], unknown_fields: [] }, null, 2);
    const errorExample = JSON.stringify({ errors: [{ index: 3, field: "guardians[0].email", code: "email" }] }, null, 2);
    const endpoints: Array<{ path: string; area: string; max: number; match: string }> = [
      { path: "/students", area: "students", max: MAX_BATCH.students, match: "student_no" },
      { path: "/staff", area: "staff", max: MAX_BATCH.staff, match: "email" },
      { path: "/classes", area: "classes", max: MAX_BATCH.classes, match: "class_code" },
      { path: "/enrollments", area: "classes", max: MAX_BATCH.enrollments, match: "class_code + student_no" },
      { path: "/attendance", area: "attendance", max: MAX_BATCH.attendance, match: "student_no + date" },
    ];
    return (
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("docs.startTitle")} description={t("docs.startBody")} icon={<BookOpen className="size-4" />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">{t("docs.baseUrl")}</div>
              <CopyValue value={api} testId="api-base-url" />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">{t("docs.openapi")}</div>
              <CopyValue value={`${api}/openapi.json`} />
            </div>
          </div>
          <ol className="mt-4 list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t("docs.step1")}</li>
            <li>{t("docs.step2")}</li>
            <li>{t("docs.step3")}</li>
            <li>{t("docs.step4", { limit: RATE_LIMIT_PER_MINUTE })}</li>
          </ol>
        </Panel>
        <Panel>
          <PanelHeader title={t("docs.endpointsTitle")} description={t("docs.endpointsBody")} />
          <ul className="divide-y rounded-lg border text-sm">
            {endpoints.map((e) => (
              <li key={e.path} className="space-y-0.5 px-3 py-2">
                <div className="font-mono text-xs" dir="ltr">
                  {`GET, POST ${e.path}`}
                </div>
                <div className="text-xs text-muted-foreground">{t("docs.endpointLine", { area: t(`areas.${e.area}`), max: n(e.max) })}</div>
                <div className="text-xs text-muted-foreground">
                  {t("docs.matchOn")}{" "}
                  <span className="font-mono" dir="ltr">
                    {e.match}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title={t("docs.fieldsTitle")} description={t("docs.fieldsBody")} />
          <div className="space-y-3">
            {SYNC_KINDS.map((k) => (
              <div key={k}>
                <div className="mb-1 text-xs font-medium">{t(`kinds.${k}`)}</div>
                <div className="flex flex-wrap gap-1" dir="ltr">
                  {SYNC_COLUMNS[k]
                    .filter((c) => k !== "students" || (!c.key.startsWith("guardian_") && c.key !== "relationship"))
                    .map((c) => (
                      <span key={c.key} title={locale === "ar" ? c.ar : c.en} className={c.required ? "rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[11px] text-brand" : "rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"}>
                        {c.key}
                      </span>
                    ))}
                  {k === "students" && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{"guardians[]"}</span>}
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t("docs.fieldsNote")}</p>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("docs.examplePost")} />
          <CodeBlock code={curlPost} testId="example-post" />
          <div className="mt-3 text-xs text-muted-foreground">{t("docs.responseLabel")}</div>
          <div className="mt-1">
            <CodeBlock code={response} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("docs.exampleGet")} />
          <CodeBlock code={curlGet} />
          <div className="mt-3 text-xs text-muted-foreground">{t("docs.errorsLabel")}</div>
          <div className="mt-1">
            <CodeBlock code={errorExample} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("docs.errorsNote")}</p>
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("docs.sisTitle")} description={t("docs.sisBody")} icon={<RefreshCw className="size-4" />} />
          <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t("docs.sis1")}</li>
            <li>{t("docs.sis2")}</li>
            <li>{t("docs.sis3")}</li>
            <li>{t("docs.sis4")}</li>
          </ol>
        </Panel>
      </div>
    );
  }
}
