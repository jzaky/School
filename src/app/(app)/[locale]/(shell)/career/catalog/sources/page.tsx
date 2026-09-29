import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { ChevronLeft, ChevronRight, ExternalLink, Globe } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/app/filter-bar";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { canonicalSourceType } from "@/server/catalog-pipeline/sources";
import { Pill, type Tone } from "@/components/app/badges";
import { AddSourceDialog, CheckNowButton } from "@/components/catalog/catalog-client";
import { catalogUiState } from "@/server/catalog-pipeline/access";
import { programLabels, shortHash } from "@/server/catalog-pipeline/page-data";

const STATUS_TONE: Record<string, Tone> = { PENDING: "neutral", FETCHED: "info", UNCHANGED: "success", CHANGED: "warning", FAILED: "danger" };

const PAGE = 40;
const STATUSES = ["FAILED", "CHANGED", "FETCHED", "UNCHANGED", "PENDING"] as const;
type SP = { status?: string; q?: string; page?: string };

export default async function CatalogSourcesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("catalog");
  const tc = await getTranslations("common");
  const prefs = await formatPrefs(ctx);
  const ui = catalogUiState(ctx);
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : null;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.RequirementSourceWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ url: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, counts, sources] = await Promise.all([
    ctx.db.requirementSource.count({ where }),
    ctx.db.requirementSource.groupBy({ by: ["status"], _count: { _all: true } }),
    ctx.db.requirementSource.findMany({ where, orderBy: [{ retrievedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  const countOf = new Map(counts.map((c) => [c.status, c._count._all]));
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageHref = (n: number) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string" && v) as Array<[string, string]>);
    p.set("page", String(n));
    return `/career/catalog/sources?${p.toString()}`;
  };
  const labels = await programLabels(ctx, sources.map((s) => s.programId ?? ""));
  const unis = await ctx.db.university.findMany({ where: { id: { in: [...new Set(sources.map((s) => s.universityId))] } }, select: { id: true, nameEn: true, nameAr: true } });
  const uniName = new Map(unis.map((u) => [u.id, pick(ctx.locale, u.nameEn, u.nameAr)]));
  // Programmes for the add dialog: the shared catalog plus this school's own.
  const programs = await ctx.db.universityProgram.findMany({ select: { id: true, nameEn: true, nameAr: true, universityId: true }, orderBy: { nameEn: "asc" }, take: 1000 });
  const pUnis = await ctx.db.university.findMany({ where: { id: { in: [...new Set(programs.map((p) => p.universityId))] } }, select: { id: true, nameEn: true, nameAr: true } });
  const pUni = new Map(pUnis.map((u) => [u.id, pick(ctx.locale, u.nameEn, u.nameAr)]));
  const options = programs
    .map((p) => ({ value: p.id, label: `${pUni.get(p.universityId) ?? ""}: ${pick(ctx.locale, p.nameEn, p.nameAr)}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Panel>
      <PanelHeader
        title={t("sources.title")}
        description={t("sources.desc")}
        icon={<Globe className="size-4" />}
        action={<AddSourceDialog programs={options} denial={ui.writeDenial} />}
      />
      <div className="mb-4">
        <FilterBar
          chipParam="status"
          chips={[{ value: "", label: t("changes.all") }, ...STATUSES.filter((x) => countOf.get(x)).map((x) => ({ value: x, label: `${t(`sources.status.${x}`)} (${countOf.get(x)})` }))]}
          searchPlaceholder={t("sources.search")}
        />
      </div>
      {sources.length === 0 ? (
        <EmptyState icon={<Globe className="size-5" />} title={t("sources.emptyTitle")} body={t("sources.emptyBody")} />
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="sources-list">
          {sources.map((s) => {
            const l = s.programId ? labels.get(s.programId) : null;
            return (
              <li key={s.id} className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center lg:gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-sm font-medium">{l ? l.program : uniName.get(s.universityId) ?? s.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{l ? l.university : t("sources.universityLevel")}</div>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 text-xs text-brand hover:underline" dir="ltr">
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="truncate">{s.url}</span>
                  </a>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={STATUS_TONE[s.status] ?? "neutral"} dot>
                      {t(`sources.status.${s.status}`)}
                    </Pill>
                    <Pill tone={s.sourceType === "MIRROR" ? "neutral" : "info"}>{t(`sources.sourceType.${canonicalSourceType(s.sourceType)}`)}</Pill>
                    <span className="text-xs text-muted-foreground">{s.retrievedAt ? t("sources.lastChecked", { date: fmtDate(prefs, s.retrievedAt) }) : t("sources.never")}</span>
                    {s.contentHash && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {t("sources.hash", { hash: shortHash(s.contentHash) })}
                      </span>
                    )}
                  </div>
                  {s.lastError && <p className="text-xs text-danger">{t("sources.lastError", { error: s.lastError })}</p>}
                </div>
                <CheckNowButton sourceId={s.id} denial={ui.checkDenial} />
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2 text-sm" data-testid="sources-pages">
          <span className="text-muted-foreground">{t("sources.pageOf", { page, pages, total })}</span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)}>
                  <ChevronLeft className="size-4 rtl:rotate-180" />
                  {tc("back")}
                </Link>
              </Button>
            ) : null}
            {page < pages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)}>
                  {tc("next")}
                  <ChevronRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
