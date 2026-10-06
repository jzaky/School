import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2, CircleAlert, Database, Globe, Layers, Server } from "lucide-react";
import { isLocale } from "@/i18n/routing";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { AutoRefresh } from "@/components/marketing/auto-refresh";
import { fmtDate, fmtNumber, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COMPONENTS, overallUptime, type Component, type DayStatus } from "@/server/status/status";
import { history, liveChecks } from "@/server/status/live";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("growth.statusPage");
  return { title: t("metaTitle") };
}

const ICONS: Record<Component, typeof Globe> = { web: Globe, database: Database, redis: Layers, worker: Server };

function tone(d: DayStatus) {
  if (d.uptime == null) return "bg-muted";
  if (d.uptime >= 99.5) return "bg-success";
  if (d.uptime >= 95) return "bg-warning";
  return "bg-danger";
}

export default async function StatusPage() {
  const t = await getTranslations("growth.statusPage");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const now = new Date();
  const [checks, days] = await Promise.all([liveChecks(now), history(now)]);
  const up = (c: Component) => checks[c] !== false;
  const allUp = COMPONENTS.every(up);
  const overall = days ? overallUptime(days) : null;
  const pct = (n: number) => fmtNumber({ locale }, n, { maximumFractionDigits: 2 });

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader active="status" />
      <AutoRefresh seconds={60} />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("checkedAt", { time: fmtTime({ locale }, now) })}</p>

        <div
          className={cn("mt-6 flex items-center gap-3 rounded-2xl border p-5", allUp ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft")}
          data-testid="status-summary"
          data-state={allUp ? "up" : "degraded"}
        >
          {allUp ? <CheckCircle2 className="size-6 shrink-0 text-success" /> : <CircleAlert className="size-6 shrink-0 text-danger" />}
          <p className="font-semibold">{allUp ? t("allUp") : t("someDown")}</p>
        </div>

        <ul className="mt-6 divide-y rounded-2xl border bg-card shadow-xs">
          {COMPONENTS.map((c) => {
            const I = ICONS[c];
            return (
              <li key={c} className="flex items-center justify-between gap-3 px-5 py-4" data-testid={`status-${c}`} data-state={up(c) ? "up" : "down"}>
                <span className="flex min-w-0 items-center gap-3">
                  <I className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(`component.${c}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`componentDesc.${c}`)}</span>
                  </span>
                </span>
                <span className={cn("flex shrink-0 items-center gap-1.5 text-sm", up(c) ? "text-success" : "text-danger")}>
                  <span className={cn("size-2 rounded-full", up(c) ? "bg-success" : "bg-danger")} />
                  {up(c) ? t("up") : t("down")}
                </span>
              </li>
            );
          })}
        </ul>

        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-semibold">{t("history")}</h2>
            <p className="text-sm text-muted-foreground" data-testid="status-uptime">
              {overall == null ? t("noHistory") : t("uptime", { pct: pct(overall) })}
            </p>
          </div>
          {days ? (
            <>
              <div className="mt-4 flex h-10 items-stretch gap-px sm:gap-[2px]" data-testid="status-history" aria-label={t("history")} role="img">
                {days.map((d) => {
                  const label = d.uptime == null ? t("dayNoData", { day: fmtDate({ locale }, new Date(`${d.day}T12:00:00Z`)) }) : t("dayUptime", { day: fmtDate({ locale }, new Date(`${d.day}T12:00:00Z`)), pct: pct(d.uptime) });
                  return <span key={d.day} title={label} className={cn("min-w-0 flex-1 rounded-[2px]", tone(d))} />;
                })}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{t("daysAgo", { n: days.length })}</span>
                <span>{t("today")}</span>
              </div>
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[2px] bg-success" />
                  {t("legendUp")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[2px] bg-warning" />
                  {t("legendMinor")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[2px] bg-danger" />
                  {t("legendMajor")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[2px] bg-muted" />
                  {t("legendNoData")}
                </li>
              </ul>
            </>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("historyUnavailable")}</p>
          )}
          <p className="mt-6 text-xs text-muted-foreground">{t("method")}</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
