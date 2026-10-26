// Administration > Rostering: where the school's roster comes from (ClassLink Roster Server, Clever or another
// OneRoster server, or uploaded OneRoster CSV files), a preview before anything changes, and the sync log.
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarClock, FileArchive, History, PlugZap, RefreshCw } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { DEFAULT_OPTIONS, readOptions } from "@/lib/rostering/options";
import { opensSensitiveRecords, audienceOfRole } from "@/server/access/permission-catalog";
import { MAX_CONNECTIONS } from "@/server/rostering/connections";
import { isDemoFeed } from "@/server/rostering/demo-feed";
import type { Counts } from "@/server/rostering/plan";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { RUN_TONE } from "@/components/rostering/tones";
import { EmptyState } from "@/components/app/empty-state";
import { AccessTabs } from "@/components/access/access-tabs";
import { MethodMark } from "@/components/sso/brand";
import { ConnectionDialogButton, DeleteConnectionButton, type ConnectionValue } from "@/components/rostering/connection-dialog";
import { CsvUploadForm, PreviewButton, RunProgress } from "@/components/rostering/run-controls";

export async function generateMetadata() {
  const t = await getTranslations("roster");
  return { title: t("title") };
}

const ACTIVE = ["QUEUED", "FETCHING", "PLANNING", "APPLYING"];
const PAGE = 20;

export default async function RosteringPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("integrations.manage")) notFound();
  const t = await getTranslations("roster");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const tab = sp.tab === "log" ? "log" : "connections";
  const now = new Date();
  const n = (x: number) => fmtNumber(prefs, x);

  const [connections, roles, active, runCount] = await Promise.all([
    db.rosterConnection.findMany({ orderBy: { createdAt: "asc" } }),
    db.role.findMany({ select: { key: true, nameEn: true, nameAr: true, permissions: true } }),
    db.rosterRun.findMany({ where: { status: { in: ACTIVE } }, orderBy: { startedAt: "desc" }, take: 5 }),
    db.rosterRun.count(),
  ]);
  const roleOptions = roles.filter((r) => audienceOfRole(r.key) === "staff" && r.key !== "school_admin" && !opensSensitiveRecords(r.permissions)).map((r) => ({ key: r.key, label: pick(locale, r.nameEn, r.nameAr) }));
  const blank: ConnectionValue = { provider: "classlink", name: t("providers.classlink"), baseUrl: "", authMode: "OAUTH1", tokenUrl: "", hasCredentials: false, schoolIds: [], schedule: "DAILY", hour: 3, enabled: true, options: { ...DEFAULT_OPTIONS } };
  const valueOf = (c: (typeof connections)[number]): ConnectionValue => ({
    id: c.id,
    provider: c.provider as ConnectionValue["provider"],
    name: c.name,
    baseUrl: c.baseUrl ?? "",
    authMode: c.authMode as ConnectionValue["authMode"],
    tokenUrl: c.tokenUrl ?? "",
    hasCredentials: !!c.credentialsEnc,
    schoolIds: c.schoolIds,
    schedule: c.schedule as ConnectionValue["schedule"],
    hour: c.hour,
    enabled: c.enabled,
    options: readOptions(c.options),
  });

  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={tab === "connections" ? <ConnectionDialogButton initial={blank} roles={roleOptions} disabledReason={connections.length >= MAX_CONNECTIONS ? t("tooMany", { max: MAX_CONNECTIONS }) : null} /> : null}
      />
      <AccessTabs
        current={tab}
        label={t("title")}
        tabs={[
          { value: "connections", label: t("tabs.connections"), href: "/admin/rostering", count: connections.length },
          { value: "log", label: t("tabs.log"), href: "/admin/rostering?tab=log", count: runCount },
        ]}
      />
      {tab === "connections" ? await connectionsTab() : await logTab()}
    </PageBody>
  );

  async function connectionsTab() {
    const lastRuns = connections.length ? await db.rosterRun.findMany({ where: { connectionId: { in: connections.map((c) => c.id) } }, orderBy: { startedAt: "desc" }, take: 30, select: { id: true, connectionId: true, status: true, dryRun: true, startedAt: true } }) : [];
    // What each feed keeps in step today (active links per kind).
    const linked = connections.length ? await db.rosterLink.groupBy({ by: ["provider", "kind"], where: { deactivatedAt: null, kind: { in: ["student", "staff", "guardian", "class", "enrollment"] } }, _count: { _all: true } }) : [];
    const linkedOf = (provider: string, kind: string) => linked.find((l) => l.provider === provider && l.kind === kind)?._count._all ?? 0;
    return (
      <div className="space-y-4">
        {active.map((r) => (
          <Panel key={r.id}>
            <PanelHeader
              title={r.dryRun ? t("activePreview") : t("activeSync")}
              description={connections.find((c) => c.id === r.connectionId)?.name ?? t("upload")}
              icon={<RefreshCw className="size-4" />}
              action={
                <Link href={`/admin/rostering/runs/${r.id}`} className="text-xs font-medium text-brand hover:underline">
                  {t("openRun")}
                </Link>
              }
            />
            <RunProgress runId={r.id} initial={{ status: r.status, done: r.progressDone, total: r.progressTotal, phase: r.phase }} />
          </Panel>
        ))}
        {connections.length === 0 ? (
          <EmptyState icon={<PlugZap className="size-5" />} title={t("empty")} body={t("emptyBody")} />
        ) : (
          <ul className="space-y-3">
            {connections.map((c) => {
              const last = lastRuns.find((r) => r.connectionId === c.id);
              const lastPreview = lastRuns.find((r) => r.connectionId === c.id && r.status === "PREVIEWED");
              let host = "";
              try {
                host = isDemoFeed(c.baseUrl) ? t("demoFeed") : c.baseUrl ? new URL(c.baseUrl).host : "api.clever.com";
              } catch {
                host = c.baseUrl ?? "";
              }
              const inSync = (["student", "staff", "guardian", "class", "enrollment"] as const).map((k) => [k, linkedOf(c.provider, k)] as const).filter(([, v]) => v > 0);
              return (
                <li key={c.id} className="rounded-xl border bg-card p-4 shadow-xs sm:p-5" data-testid="connection-row">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 shrink-0">{c.provider === "oneroster" ? <PlugZap className="size-6 text-brand" /> : <MethodMark method={c.provider as "classlink" | "clever"} className="size-6" />}</span>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{c.name}</span>
                          {c.name !== t(`providers.${c.provider}`) && <Pill tone="brand">{t(`providers.${c.provider}`)}</Pill>}
                          {!c.enabled && <Pill>{t("paused")}</Pill>}
                          {c.lastStatus && (
                            <Pill tone={RUN_TONE[c.lastStatus] ?? "neutral"} dot>
                              {t(`status.${c.lastStatus}`)}
                            </Pill>
                          )}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                          {host}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <CalendarClock className="size-3.5" />
                          <span>{c.schedule === "OFF" ? t("scheduleOff") : c.schedule === "HOURLY" ? t("scheduleHourly", { time: `${String(c.hour).padStart(2, "0")}:00` }) : t("scheduleDaily", { time: `${String(c.hour).padStart(2, "0")}:00` })}</span>
                          <span>·</span>
                          <span>{c.schoolIds.length ? t("schoolsChosen", { count: c.schoolIds.length }) : t("allSchools")}</span>
                          <span>·</span>
                          <span>{c.lastRunAt ? t("lastRun", { when: fmtRelative(prefs, c.lastRunAt, now) }) : t("neverRun")}</span>
                        </div>
                        {inSync.length > 0 && (
                          <p className="text-xs text-muted-foreground" data-testid="in-sync">
                            {t("inSync", { list: inSync.map(([k, v]) => t(`linkedKinds.${k}`, { count: n(v) })).join(locale === "ar" ? "، " : ", ") })}
                          </p>
                        )}
                        {c.consecutiveFailures >= 3 && <p className="text-xs text-danger">{t("failing", { count: c.consecutiveFailures })}</p>}
                        {lastPreview && (
                          <Link href={`/admin/rostering/runs/${lastPreview.id}`} className="text-xs font-medium text-brand hover:underline" data-testid="open-preview">
                            {t("openPreview")}
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <PreviewButton connectionId={c.id} busy={!!last && ACTIVE.includes(last.status)} />
                      <ConnectionDialogButton variant="edit" initial={valueOf(c)} roles={roleOptions} />
                      <DeleteConnectionButton id={c.id} name={c.name} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Panel>
          <PanelHeader title={t("csvTitle")} description={t("csvBody")} icon={<FileArchive className="size-4" />} />
          <CsvUploadForm connections={connections.filter((c) => c.provider !== "clever").map((c) => ({ id: c.id, name: c.name }))} />
        </Panel>
      </div>
    );
  }

  async function logTab() {
    const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
    const runs = await db.rosterRun.findMany({ orderBy: { startedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, select: { id: true, connectionId: true, provider: true, source: true, trigger: true, mode: true, dryRun: true, status: true, startedAt: true, finishedAt: true, counts: true, issues: true, errorCode: true, actorId: true } });
    const pages = Math.max(1, Math.ceil(runCount / PAGE));
    const actorIds = [...new Set(runs.map((r) => r.actorId).filter((x): x is string => !!x))];
    const members = actorIds.length ? await db.membership.findMany({ where: { id: { in: actorIds } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [];
    const nameOf = (id: string | null) => userName(members.find((m) => m.id === id)?.user, locale) || t("someone");
    const sum = (c: Counts | null, k: "create" | "update" | "remove") => (c ? (["staff", "students", "guardians", "classes", "enrollments"] as const).reduce((s, x) => s + (c[x]?.[k] ?? 0), 0) : 0);
    if (runs.length === 0) return <EmptyState icon={<History className="size-5" />} title={t("logEmpty")} body={t("logEmptyBody")} />;
    return (
      <Panel padded={false}>
        <ul className="divide-y" data-testid="sync-log">
          {runs.map((r) => {
            const c = r.counts as Counts | null;
            const issues = Array.isArray(r.issues) ? r.issues.length : 0;
            return (
              <li key={r.id}>
                <Link href={`/admin/rostering/runs/${r.id}`} className="grid gap-1 px-4 py-3 text-sm transition hover:bg-muted/40 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1.6fr)] sm:items-center sm:gap-3 sm:px-5" data-testid="log-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      {r.dryRun ? t("kind.preview") : t("kind.sync")}
                      <span className="text-xs font-normal text-muted-foreground">
                        {t(`providers.${r.provider}`)} · {t(`source.${r.source}`)} · {t(`mode.${r.mode}`)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDateTime(prefs, r.startedAt)} · {r.trigger === "SCHEDULE" ? t("trigger.SCHEDULE") : t("trigger.byPerson", { name: nameOf(r.actorId) })}
                    </div>
                  </div>
                  <div>
                    <Pill tone={RUN_TONE[r.status] ?? "neutral"} dot>
                      {t(`status.${r.status}`)}
                    </Pill>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.status === "FAILED" ? (
                      <span className="text-danger">{t.has(`errors.${r.errorCode}`) ? t(`errors.${r.errorCode}`) : t("errors.generic")}</span>
                    ) : (
                      t("logCounts", { created: n(sum(c, "create")), updated: n(sum(c, "update")), removed: n(sum(c, "remove")), issues: n(issues) })
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-5 py-3 text-sm">
            <span className="text-xs text-muted-foreground">{t("pageOf", { page: n(page), pages: n(pages) })}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/admin/rostering?tab=log&page=${page - 1}`} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted">
                  {t("newer")}
                </Link>
              )}
              {page < pages && (
                <Link href={`/admin/rostering?tab=log&page=${page + 1}`} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted" data-testid="log-older">
                  {t("older")}
                </Link>
              )}
            </div>
          </div>
        )}
      </Panel>
    );
  }
}
