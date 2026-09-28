import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Blocks, CircleOff, FileWarning, ListChecks, Workflow } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill, SensitivityBadge } from "@/components/app/badges";
import { Icon } from "@/components/icon";
import { ServiceActiveToggle, ServiceEditor, type EditorOptions, type ServiceDraft } from "@/components/admin/service-admin";
import { STAFF_ROLE_KEYS } from "@/server/identity/permissions";
import type { AudienceGroup } from "@/server/admin/services-actions";

export async function generateMetadata() {
  const t = await getTranslations("adminServices");
  return { title: t("title") };
}

function groupsOf(audience: string[]): AudienceGroup[] {
  const out: AudienceGroup[] = [];
  if (audience.includes("student")) out.push("student");
  if (audience.includes("parent")) out.push("parent");
  if (audience.some((a) => STAFF_ROLE_KEYS.includes(a))) out.push("staff");
  return out;
}

export default async function AdminServicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("services.manage")) notFound();
  const t = await getTranslations("adminServices");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const q = sp.q?.trim().toLowerCase();
  const tab = sp.tab ?? "all";

  const [categories, services, forms, workflows] = await Promise.all([
    db.serviceCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.serviceDefinition.findMany({
      include: {
        form: { select: { id: true, nameEn: true, nameAr: true, publishedVersionId: true, versions: { select: { id: true, version: true } } } },
        workflow: { select: { id: true, nameEn: true, nameAr: true, publishedVersionId: true } },
        _count: { select: { requests: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    }),
    db.form.findMany({ where: { publishedVersionId: { not: null } }, select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: "asc" } }),
    db.workflow.findMany({ where: { publishedVersionId: { not: null } }, select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: "asc" } }),
  ]);

  const options: EditorOptions = {
    categories: categories.map((c) => ({ id: c.id, label: pick(locale, c.nameEn, c.nameAr), icon: c.icon })),
    forms: forms.map((f) => ({ id: f.id, label: pick(locale, f.nameEn, f.nameAr) })),
    workflows: workflows.map((w) => ({ id: w.id, label: pick(locale, w.nameEn, w.nameAr) })),
  };

  const counts = { all: services.length, active: services.filter((s) => s.isActive).length, inactive: services.filter((s) => !s.isActive).length };
  const noForm = services.filter((s) => !s.formId).length;
  const shown = services
    .filter((s) => (tab === "active" ? s.isActive : tab === "inactive" ? !s.isActive : true))
    .filter((s) => !q || `${s.nameEn} ${s.nameAr} ${s.descEn} ${s.key}`.toLowerCase().includes(q));
  const grouped = categories.map((c) => ({ c, items: shown.filter((s) => s.categoryId === c.id) })).filter((g) => g.items.length);

  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<ServiceEditor options={options} />} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("statActive")} value={fmtNumber(prefs, counts.active)} icon={<Blocks className="size-4" />} tone="success" />
        <StatCard label={t("statInactive")} value={fmtNumber(prefs, counts.inactive)} icon={<CircleOff className="size-4" />} tone={counts.inactive ? "warning" : "brand"} />
        <StatCard label={t("statNoForm")} value={fmtNumber(prefs, noForm)} hint={t("statNoFormHint")} icon={<FileWarning className="size-4" />} tone="info" />
      </div>
      <FilterBar
        tabs={[
          { value: "all", label: t("tabAll"), count: counts.all },
          { value: "active", label: t("tabActive"), count: counts.active },
          { value: "inactive", label: t("tabInactive"), count: counts.inactive },
        ]}
        searchPlaceholder={t("search")}
      />
      {grouped.length === 0 ? (
        <EmptyState icon={<Blocks className="size-5" />} title={services.length ? t("noMatch") : t("empty")} body={services.length ? t("noMatchBody") : t("emptyBody")} />
      ) : (
        grouped.map(({ c, items }) => (
          <section key={c.id} className="space-y-2" data-testid="service-category">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Icon name={c.icon} className="size-4 text-muted-foreground" />
              {pick(locale, c.nameEn, c.nameAr)}
              <span className="text-xs font-normal text-muted-foreground">{t("servicesN", { count: items.length })}</span>
            </h2>
            <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <ul className="divide-y">
                {items.map((s) => {
                  const groups = groupsOf(s.audience);
                  const formVersion = s.form?.versions.find((v) => v.id === s.form?.publishedVersionId)?.version;
                  const draft: ServiceDraft = {
                    id: s.id,
                    nameEn: s.nameEn,
                    nameAr: s.nameAr,
                    descEn: s.descEn,
                    descAr: s.descAr,
                    icon: s.icon,
                    categoryId: s.categoryId,
                    audience: groups,
                    slaHours: s.slaHours,
                    formId: s.form?.publishedVersionId ? s.formId : null,
                    workflowId: s.workflow?.publishedVersionId ? s.workflowId : null,
                    isFeatured: s.isFeatured,
                    requiresStudent: s.requiresStudent,
                    sensitivity: s.sensitivity,
                  };
                  return (
                    <li key={s.id} className="grid gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_170px_110px_minmax(0,230px)_100px] lg:items-center" data-testid="service-row" data-service-key={s.key}>
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={s.isActive ? "grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" : "grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"}>
                          <Icon name={s.icon} className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={s.isActive ? "text-sm font-medium" : "text-sm font-medium text-muted-foreground"}>{pick(locale, s.nameEn, s.nameAr)}</span>
                            <SensitivityBadge sensitivity={s.sensitivity} />
                            {s.isFeatured && <Pill tone="gold">{t("featured")}</Pill>}
                            {!s.isActive && <Pill>{t("off")}</Pill>}
                          </div>
                          <p className="line-clamp-1 text-xs text-muted-foreground">{pick(locale, s.descEn, s.descAr)}</p>
                          <p className="text-xs text-muted-foreground">{t("requestsN", { count: s._count.requests })}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {groups.map((g) => (
                          <Pill key={g} tone={g === "staff" ? "neutral" : "info"}>
                            {t(`audience.${g}`)}
                          </Pill>
                        ))}
                      </div>
                      <div className="text-sm">
                        <span className="text-xs text-muted-foreground lg:hidden">{t("sla")}: </span>
                        {s.slaHours <= 8 ? t("sameDay") : s.slaHours < 48 ? t("hoursN", { count: s.slaHours }) : t("daysN", { count: Math.round(s.slaHours / 24) })}
                      </div>
                      <div className="min-w-0 space-y-1 text-xs">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <ListChecks className="size-3.5 shrink-0 text-muted-foreground" />
                          {s.form ? (
                            <Link href={`/admin/forms/${s.form.id}`} className="truncate hover:text-brand">
                              {pick(locale, s.form.nameEn, s.form.nameAr)}
                              {formVersion ? <span className="text-muted-foreground"> · {t("versionN", { version: formVersion })}</span> : null}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{t("noForm")}</span>
                          )}
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Workflow className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className={s.workflow ? "truncate" : "text-muted-foreground"}>{s.workflow ? pick(locale, s.workflow.nameEn, s.workflow.nameAr) : t("noWorkflow")}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <ServiceActiveToggle id={s.id} active={s.isActive} locked={s.sensitivity === "SAFEGUARDING"} name={pick(locale, s.nameEn, s.nameAr)} />
                        <ServiceEditor options={options} service={draft} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ))
      )}
    </PageBody>
  );
}
