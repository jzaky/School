import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FilePen, FileCheck2, ListChecks, Plus, Sparkles } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { fieldCount } from "@/server/forms/builder";
import type { FormSchema } from "@/server/forms/schema";

export async function generateMetadata() {
  const t = await getTranslations("adminForms");
  return { title: t("title") };
}

export default async function AdminFormsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("forms.manage")) notFound();
  const t = await getTranslations("adminForms");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const q = sp.q?.trim().toLowerCase();
  const tab = sp.tab ?? "all";

  const forms = await db.form.findMany({
    include: {
      versions: { select: { id: true, version: true, schema: true, publishedAt: true, _count: { select: { submissions: true } } }, orderBy: { version: "desc" } },
      services: { select: { id: true, nameEn: true, nameAr: true, isActive: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows = forms.map((f) => {
    const published = f.versions.find((v) => v.id === f.publishedVersionId) ?? null;
    const draft = (f.draftSchema ?? published?.schema ?? null) as FormSchema | null;
    const changed = Boolean(published && f.draftSchema && JSON.stringify(f.draftSchema) !== JSON.stringify(published.schema));
    const state: "published" | "changed" | "draft" = !published ? "draft" : changed ? "changed" : "published";
    return {
      f,
      published,
      state,
      fields: fieldCount(draft),
      submissions: f.versions.reduce((s, v) => s + v._count.submissions, 0),
      name: pick(locale, f.nameEn, f.nameAr),
      category: pick(locale, f.categoryEn, f.categoryAr),
    };
  });
  const counts = { all: rows.length, published: rows.filter((r) => r.state !== "draft").length, draft: rows.filter((r) => r.state !== "published").length };
  const shown = rows
    .filter((r) => (tab === "published" ? r.state !== "draft" : tab === "draft" ? r.state !== "published" : true))
    .filter((r) => !q || `${r.f.nameEn} ${r.f.nameAr} ${r.f.categoryEn ?? ""} ${r.f.categoryAr ?? ""}`.toLowerCase().includes(q));

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/admin/forms/new?ai=1" data-testid="forms-ai">
                <Sparkles className="size-4" />
                {t("draftWithAi")}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/forms/new" data-testid="forms-create">
                <Plus className="size-4" />
                {t("create")}
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("statForms")} value={fmtNumber(prefs, counts.all)} icon={<ListChecks className="size-4" />} />
        <StatCard label={t("statPublished")} value={fmtNumber(prefs, counts.published)} icon={<FileCheck2 className="size-4" />} tone="success" />
        <StatCard label={t("statDrafts")} value={fmtNumber(prefs, counts.draft)} icon={<FilePen className="size-4" />} tone={counts.draft ? "warning" : "brand"} />
      </div>
      <FilterBar
        tabs={[
          { value: "all", label: t("tabAll"), count: counts.all },
          { value: "published", label: t("tabPublished"), count: counts.published },
          { value: "draft", label: t("tabDraft"), count: counts.draft },
        ]}
        searchPlaceholder={t("search")}
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title={rows.length ? t("noMatch") : t("empty")}
          body={rows.length ? t("noMatchBody") : t("emptyBody")}
          action={
            rows.length ? null : (
              <Button asChild>
                <Link href="/admin/forms/new">
                  <Plus className="size-4" />
                  {t("create")}
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1fr)_150px_90px_minmax(0,220px)_110px] gap-3 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
            <span>{t("colForm")}</span>
            <span>{t("colStatus")}</span>
            <span>{t("colFields")}</span>
            <span>{t("colServices")}</span>
            <span>{t("colUpdated")}</span>
          </div>
          <ul className="divide-y">
            {shown.map((r) => (
              <li key={r.f.id} data-testid="form-row">
                <Link href={`/admin/forms/${r.f.id}`} className="grid gap-2 px-4 py-3.5 transition hover:bg-muted/30 sm:px-5 lg:grid-cols-[minmax(0,1fr)_150px_90px_minmax(0,220px)_110px] lg:items-center lg:gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {r.category && <span>{r.category}</span>}
                      {r.submissions > 0 && <span>· {t("submissions", { count: r.submissions })}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.state === "draft" ? (
                      <Pill tone="warning" dot>
                        {t("stateDraft")}
                      </Pill>
                    ) : (
                      <Pill tone="success" dot>
                        {t("versionN", { version: r.published!.version })}
                      </Pill>
                    )}
                    {r.state === "changed" && <Pill tone="info">{t("stateChanged")}</Pill>}
                  </div>
                  <div className="text-sm tabular-nums text-muted-foreground">
                    <span className="lg:hidden">{t("fieldsN", { count: r.fields })}</span>
                    <span className="hidden lg:inline">{fmtNumber(prefs, r.fields)}</span>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {r.f.services.length ? (
                      r.f.services.slice(0, 2).map((s) => (
                        <Pill key={s.id} tone={s.isActive ? "brand" : "neutral"} className="max-w-full truncate">
                          {pick(locale, s.nameEn, s.nameAr)}
                        </Pill>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("noServices")}</span>
                    )}
                    {r.f.services.length > 2 && <Pill>{t("moreN", { count: r.f.services.length - 2 })}</Pill>}
                  </div>
                  <div className="text-xs text-muted-foreground">{fmtDate(prefs, r.f.updatedAt)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageBody>
  );
}
