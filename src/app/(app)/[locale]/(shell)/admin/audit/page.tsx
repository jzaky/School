import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Download, ScrollText, ShieldCheck } from "lucide-react";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
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
const ENTITIES = ["Case", "Request", "Document", "Student", "ApprovalRequest", "Appointment", "Organization", "Membership", "Role", "AuditEvent"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string; sens?: string; days?: string; page?: string; preset?: string }> }) {
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
  // Whose access changed, for access entries on a member (names only, never record content).
  const subjects = await ctx.db.membership.findMany({ where: { id: { in: [...new Set(rows.filter((r) => r.entityType === "Membership" && r.entityId).map((r) => r.entityId!))] } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } });
  const subjectName = (id: string | null) => {
    const m = id ? subjects.find((x) => x.id === id) : null;
    return m ? pick(ctx.locale, m.user.nameEn, m.user.nameAr) : null;
  };
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const Prev = ctx.locale === "ar" ? ChevronRight : ChevronLeft;
  const Next = ctx.locale === "ar" ? ChevronLeft : ChevronRight;
  const actionLabel = (a: string) => (t.has(`actions.${a.replace(/\./g, "_")}`) ? t(`actions.${a.replace(/\./g, "_")}`) : a);
  const ta = await getTranslations("access");
  const roleNames = new Map((await ctx.db.role.findMany({ select: { key: true, nameEn: true, nameAr: true } })).map((r) => [r.key, pick(ctx.locale, r.nameEn, r.nameAr)]));
  // One plain line for access changes: which role, which permission, and any end date. Never record content.
  const accessDetail = (action: string, meta: unknown): string | null => {
    const m = (meta ?? {}) as { role?: string; permission?: string; before?: unknown; after?: unknown; until?: Record<string, string>; roles?: string[]; permissions?: string[]; path?: string; endedEarly?: boolean };
    const role = (k?: string) => (k ? (roleNames.get(k) ?? k) : "");
    const perm = (p: string) => (ta.has(`perms.${p}.label`) ? ta(`perms.${p}.label`) : p);
    const keys = (v: unknown) => (Array.isArray(v) ? (v as string[]).map(role).join(", ") : "");
    if (action === "roles.permission_grant" || action === "roles.permission_revoke") return t("detail.permission", { role: role(m.role), permission: perm(m.permission ?? "") });
    if (action === "people.roles_change") {
      const base = t("detail.roles", { before: keys(m.before) || "-", after: keys(m.after) || "-" });
      const until = m.until ? Object.entries(m.until).map(([k, d]) => t("detail.until", { role: role(k), date: fmtDate(prefs, d, "medium") })).join(" · ") : "";
      return [base, until, m.endedEarly ? t("detail.endedEarly") : ""].filter(Boolean).join(" · ");
    }
    if (action === "people.role_end_change") {
      const d = (v: unknown) => (typeof v === "string" ? fmtDate(prefs, v, "medium") : t("detail.noEnd"));
      return t("detail.endChange", { role: role(m.role), before: d(m.before), after: d(m.after) });
    }
    if (action === "people.role_expired") return t("detail.expired", { roles: keys(m.roles) });
    if (action === "access.self_grant_blocked") return t("detail.blocked", { permissions: (m.permissions ?? []).map(perm).join(", ") });
    if (action === "roles.restore_default" || action === "roles.create" || action === "roles.delete" || action === "roles.rename") return m.role ? role(m.role) : null;
    return null;
  };

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
      <FilterBar chips={[{ value: "", label: t("allActivity") }, { value: "access", label: t("presetAccess") }]} chipParam="preset" />
      {sp.preset === "access" && <p className="-mt-1 text-xs text-muted-foreground" data-testid="audit-preset-help">{t("presetAccessHelp")}</p>}
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
                    {(() => {
                      const raw = accessDetail(r.action, r.meta);
                      const who = r.entityType === "Membership" && r.action !== "access.self_grant_blocked" ? subjectName(r.entityId) : null;
                      const detail = raw && who ? `${who}: ${raw}` : raw;
                      return detail ? (
                        <span className="block text-xs text-muted-foreground" data-testid="audit-detail">
                          {detail}
                        </span>
                      ) : null;
                    })()}
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
