import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  CalendarClock,
  Download,
  Eye,
  FileLock2,
  HeartHandshake,
  IdCard,
  KeyRound,
  Plug,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { buildAccessReport, canSeeAccessReport, reportMemberSelect, reportMemberWhere } from "@/server/access/report";
import { daysLeft } from "@/server/access/until";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { AccessTabs } from "@/components/access/access-tabs";
import { Button } from "@/components/ui/button";

export async function generateMetadata() {
  const t = await getTranslations("accessReport");
  return { title: t("title") };
}

const ICONS: Record<string, LucideIcon> = {
  safeguarding: ShieldAlert,
  wellbeing: HeartHandshake,
  medical: Stethoscope,
  reasons: UserX,
  identity: IdCard,
  audit: ScrollText,
  roles: KeyRound,
  integrations: Plug,
  other: FileLock2,
};

export default async function AccessReportPage() {
  const ctx = await getCtx();
  if (!canSeeAccessReport((p) => ctx.can(p))) notFound();
  const t = await getTranslations("accessReport");
  const tr = await getTranslations("adminRoles");
  const ta = await getTranslations("access");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const now = new Date();
  const members = await db.membership.findMany({ where: reportMemberWhere(now), select: reportMemberSelect, take: 3000 });
  const areas = buildAccessReport(members, now);
  const managesRoles = ctx.can("roles.manage");
  const people = new Set(areas.flatMap((a) => a.entries.map((e) => e.membershipId))).size;
  const limited = new Set(areas.flatMap((a) => a.entries.filter((e) => e.until).map((e) => e.membershipId))).size;
  const area = (key: string, part: "title" | "help") => (t.has(`areas.${key}.${part}`) ? t(`areas.${key}.${part}`) : key);
  const permLabel = (p: string) => (ta.has(`perms.${p}.label`) ? ta(`perms.${p}.label`) : p);

  return (
    <PageBody>
      {managesRoles && (
        <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
          <Link href="/admin/roles">
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {tr("backToRoles")}
          </Link>
        </Button>
      )}
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button variant="outline" asChild>
            <a href="/api/admin/access-report/export" download data-testid="access-report-export">
              <Download className="size-4" />
              {t("export")}
            </a>
          </Button>
        }
      />
      {managesRoles && (
        <AccessTabs
          current="report"
          tabs={[
            { value: "roles", label: tr("tabRoles"), href: "/admin/roles" },
            { value: "check", label: tr("tabCheck"), href: "/admin/roles?tab=check" },
            { value: "report", label: tr("tabReport"), href: "/admin/roles/report" },
          ]}
        />
      )}
      <p className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        <span>{t("peopleOnly", { people: fmtNumber(prefs, people), limited: fmtNumber(prefs, limited) })}</span>
      </p>

      <nav aria-label={t("jumpTo")} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="access-report-summary">
        {areas.map((a) => {
          const Icon = ICONS[a.key] ?? FileLock2;
          const timed = a.entries.filter((e) => e.until).length;
          return (
            <a key={a.key} href={`#area-${a.key}`} className="group min-w-0 rounded-xl border bg-card p-3 shadow-xs transition hover:border-brand/40 hover:shadow-sm" data-testid={`area-card-${a.key}`}>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{area(a.key, "title")}</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tabular-nums group-hover:text-brand">{fmtNumber(prefs, a.entries.length)}</span>
                <span className="text-xs text-muted-foreground">{t("peopleLabel")}</span>
              </div>
              {timed > 0 && <div className="mt-0.5 truncate text-xs text-warning">{t("timeLimited", { count: timed })}</div>}
            </a>
          );
        })}
      </nav>

      {areas.map((a) => {
        const Icon = ICONS[a.key] ?? FileLock2;
        return (
          <Panel key={a.key} padded={false} className="scroll-mt-20 overflow-hidden">
            <div id={`area-${a.key}`} className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 sm:px-5" data-testid={`area-${a.key}`}>
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{area(a.key, "title")}</h2>
                  <p className="text-xs text-muted-foreground">{area(a.key, "help")}</p>
                </div>
              </div>
              <Pill tone={a.entries.length ? "info" : "neutral"}>{t("people", { count: a.entries.length })}</Pill>
            </div>
            {a.entries.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">{t("nobody")}</p>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_150px_130px] gap-3 border-b bg-muted/30 px-5 py-2 text-xs font-medium text-muted-foreground lg:grid">
                  <span>{t("colPerson")}</span>
                  <span>{t("colAccess")}</span>
                  <span>{t("colRole")}</span>
                  <span>{t("colEnds")}</span>
                  <span>{t("colLastActive")}</span>
                </div>
                <ul className="divide-y">
                  {a.entries.map((e) => (
                    <li key={e.membershipId} className="grid gap-2 px-4 py-3 text-sm sm:px-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_150px_130px] lg:items-center lg:gap-3" data-testid="access-report-row">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          <span className="truncate">{pick(locale, e.nameEn, e.nameAr)}</span>
                          {e.membershipId === ctx.membershipId && <Pill>{tr("you")}</Pill>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground" dir="ltr">
                          {e.email}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1">
                        {e.permissions.map((p) => (
                          <Pill key={p} tone={p.startsWith("safeguarding.") || p === "cases.wellbeing" ? "danger" : "neutral"}>
                            {p === "safeguarding.view" || p === "cases.wellbeing" || p === "people.medical" ? <Eye className="size-3" /> : null}
                            {permLabel(p)}
                          </Pill>
                        ))}
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1">
                        <span className="me-1 text-xs text-muted-foreground lg:hidden">{t("colRole")}:</span>
                        {e.via.map((v) =>
                          managesRoles ? (
                            <Link key={v.roleId} href={`/admin/roles/${v.roleId}`}>
                              <Pill tone={v.expiresAt ? "warning" : "brand"}>{pick(locale, v.nameEn, v.nameAr)}</Pill>
                            </Link>
                          ) : (
                            <Pill key={v.roleId} tone={v.expiresAt ? "warning" : "brand"}>
                              {pick(locale, v.nameEn, v.nameAr)}
                            </Pill>
                          ),
                        )}
                      </div>
                      <div className="text-xs">
                        {e.until ? (
                          <span className="inline-flex flex-col">
                            <span className="inline-flex items-center gap-1 font-medium text-warning" data-testid="access-report-until">
                              <CalendarClock className="size-3.5" />
                              {tr("untilPill", { date: fmtDate(prefs, e.until, "medium") })}
                            </span>
                            <span className="text-muted-foreground">{tr("daysLeft", { count: daysLeft(e.until, now) })}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("noEnd")}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="lg:hidden">{t("colLastActive")}: </span>
                        {e.lastSeenAt ? <span title={fmtDate(prefs, e.lastSeenAt, "medium")}>{fmtRelative(prefs, e.lastSeenAt, now)}</span> : t("neverActive")}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        );
      })}
    </PageBody>
  );
}
