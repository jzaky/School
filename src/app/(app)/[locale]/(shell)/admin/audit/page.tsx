import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Download, ScrollText, ShieldCheck } from "lucide-react";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { SensitivityBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { auditWhere, entityHref } from "@/server/admin/audit-query";

export async function generateMetadata() {
  const t = await getTranslations("adminAudit");
  return { title: t("title") };
}

const PAGE = 50;
const ENTITIES = ["Case", "Request", "Document", "Student", "ApprovalRequest", "Appointment", "Organization", "Membership", "AuditEvent"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string; sens?: string; days?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePermission("audit.view");
  const t = await getTranslations("adminAudit");
  const prefs = await formatPrefs(ctx);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const where = auditWhere(ctx, sp);
  const [rows, total] = await Promise.all([
    ctx.db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    ctx.db.auditEvent.count({ where }),
  ]);
  const actors = await ctx.db.membership.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])] } }, include: { user: true } });
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const Prev = ctx.locale === "ar" ? ChevronRight : ChevronLeft;
  const Next = ctx.locale === "ar" ? ChevronLeft : ChevronRight;
  const actionLabel = (a: string) => (t.has(`actions.${a.replace(/\./g, "_")}`) ? t(`actions.${a.replace(/\./g, "_")}`) : a);

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button variant="outline" asChild>
            <a href={`/api/admin/audit/export?${qs({ page: undefined })}`} data-testid="audit-export">
              <Download className="size-4" />
              {t("export")}
            </a>
          </Button>
        }
      />
      <p className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-success" />
        {t("immutable")}
      </p>
      <FilterBar
        tabs={[
          { value: "30", label: t("days30") },
          { value: "7", label: t("days7") },
          { value: "90", label: t("days90") },
          { value: "0", label: t("allTime") },
        ]}
        tabParam="days"
        chips={[{ value: "", label: t("allEntries") }, { value: "sensitive", label: t("sensitiveOnly") }]}
        chipParam="sens"
        searchPlaceholder={t("search")}
      />
      <FilterBar chips={[{ value: "", label: t("allTypes") }, ...ENTITIES.map((e) => ({ value: e, label: t(`entities.${e}`) }))]} chipParam="entity" />
      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-5" />} title={t("empty")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[170px_190px_minmax(0,1fr)_180px_130px] gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
            <span>{t("colTime")}</span>
            <span>{t("colActor")}</span>
            <span>{t("colAction")}</span>
            <span>{t("colRecord")}</span>
            <span>{t("colSensitivity")}</span>
          </div>
          <ul className="divide-y text-sm">
            {rows.map((r) => {
              const a = actors.find((m) => m.id === r.actorId);
              const href = entityHref(r.entityType, r.entityId);
              return (
                <li key={r.id} className="grid gap-1 px-4 py-3 sm:px-5 lg:grid-cols-[170px_190px_minmax(0,1fr)_180px_130px] lg:items-center lg:gap-3" data-testid="audit-row">
                  <span className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(prefs, r.createdAt)}</span>
                  <span className="truncate">{a ? pick(ctx.locale, a.user.nameEn, a.user.nameAr) : <span className="text-muted-foreground">{t("system")}</span>}</span>
                  <span className="min-w-0">
                    <span className="font-medium">{actionLabel(r.action)}</span>
                    {r.reason && <span className="block truncate text-xs text-muted-foreground">{t("reason", { reason: r.reason })}</span>}
                  </span>
                  <span className="truncate text-xs">
                    <span className="text-muted-foreground">{t.has(`entities.${r.entityType}`) ? t(`entities.${r.entityType}`) : r.entityType}</span>
                    {r.entityId &&
                      (href ? (
                        <Link href={href} className="ms-1.5 font-mono hover:text-brand" dir="ltr">
                          {r.entityId.slice(-8)}
                        </Link>
                      ) : (
                        <span className="ms-1.5 font-mono" dir="ltr">
                          {r.entityId.slice(-8)}
                        </span>
                      ))}
                  </span>
                  <span>{r.sensitivity === "STANDARD" ? <span className="text-xs text-muted-foreground">{t("standard")}</span> : <SensitivityBadge sensitivity={r.sensitivity} />}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("count", { total: fmtNumber(prefs, total) })}</span>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/audit?${qs({ page: page - 1 })}`}>
                <Prev className="size-4" />
                {t("previous")}
              </Link>
            </Button>
          ) : null}
          <span className="tabular-nums">{t("pageOf", { page: fmtNumber(prefs, page), pages: fmtNumber(prefs, pages) })}</span>
          {page < pages ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/audit?${qs({ page: page + 1 })}`}>
                {t("next")}
                <Next className="size-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </PageBody>
  );
}
