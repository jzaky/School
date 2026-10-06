import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Archive, ArrowLeft, Download, Info } from "lucide-react";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { AutoRefresh, RequestSchoolExport } from "@/components/privacy/school-exit";
import { EXPORT_TTL_HOURS } from "@/server/privacy/school-export";

export async function generateMetadata() {
  const t = await getTranslations("privacy");
  return { title: t("exitTitle") };
}

const TONE = { QUEUED: "info", RUNNING: "brand", READY: "success", FAILED: "danger", EXPIRED: "neutral" } as const;

export default async function SchoolExitPage() {
  const ctx = await requirePermission("compliance.manage");
  if (!ctx.can("school.manage")) notFound();
  const t = await getTranslations("privacy");
  const tc = await getTranslations("adminCompliance");
  const prefs = await formatPrefs(ctx);
  const now = new Date();
  const exports = await ctx.db.dataExport.findMany({ where: { orgId: ctx.orgId, kind: "SCHOOL" }, orderBy: { createdAt: "desc" }, take: 10 });
  const busy = exports.some((e) => e.status === "QUEUED" || e.status === "RUNNING");
  const mb = (b: number | null) => fmtNumber(prefs, Math.max(0.1, Math.round(((b ?? 0) / 1_048_576) * 10) / 10));

  return (
    <PageBody>
      <AutoRefresh active={busy} />
      <PageHeader
        title={t("exitTitle")}
        description={t("exitSubtitle")}
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
        <PanelHeader title={t("exitWhatTitle")} description={t("exitWhatHint", { hours: EXPORT_TTL_HOURS })} icon={<Info className="size-4" />} />
        <ul className="mb-4 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t("exitWhat1")}</li>
          <li>{t("exitWhat2")}</li>
          <li>{ctx.can("safeguarding.view") ? t("exitWhatRestrictedIncluded") : t("exitWhatRestrictedExcluded")}</li>
          <li>{t("exitWhat4")}</li>
        </ul>
        <RequestSchoolExport slug={ctx.org.slug} busy={busy} />
      </Panel>

      <Panel padded={false}>
        <div className="p-5 pb-0">
          <PanelHeader title={t("exitHistory")} icon={<Archive className="size-4" />} />
        </div>
        {exports.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("exitNone")}</p>
        ) : (
          <ul className="divide-y">
            {exports.map((e) => {
              const live = e.status === "READY" && e.expiresAt && e.expiresAt > now;
              const status = e.status === "READY" && !live ? "EXPIRED" : e.status;
              return (
                <li key={e.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between" data-testid="exit-row">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {fmtDateTime(prefs, e.createdAt)}
                      <Pill tone={TONE[status as keyof typeof TONE] ?? "neutral"} dot>
                        {t(`exitStatus.${status}`)}
                      </Pill>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.status === "READY" && e.sizeBytes !== null
                        ? t("exitStats", { rows: fmtNumber(prefs, e.rowCount ?? 0), files: fmtNumber(prefs, e.fileCount ?? 0), mb: mb(e.sizeBytes) })
                        : e.status === "FAILED"
                          ? t("exitFailed")
                          : e.status === "EXPIRED"
                            ? t("exitExpiredHint")
                            : t("exitWorking")}
                    </p>
                    {live && <p className="text-xs text-muted-foreground">{t("exitExpires", { date: fmtDateTime(prefs, e.expiresAt!) })}</p>}
                  </div>
                  {live && (
                    <Button size="sm" asChild>
                      <a href={`/api/admin/school-export/${e.id}`} data-testid="exit-download">
                        <Download className="size-4" />
                        {t("exitDownload")}
                      </a>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PageBody>
  );
}
