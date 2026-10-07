import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ClipboardList, Download, Eye, EyeOff, FileSpreadsheet, Info, Lock } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber, type FormatPrefs } from "@/lib/format";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildEvidencePack, referencedCaseIds, type Metric } from "@/server/inspection/evidence";
import { dubaiDayKey, lastDays, parseDayRange, type DayRange } from "@/server/inspection/range";
import { audit } from "@/server/audit/audit";

export async function generateMetadata() {
  const t = await getTranslations("inspection");
  return { title: t("title") };
}

type SP = { from?: string; to?: string; preset?: string; refs?: string };

export default async function InspectionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.isStaff || !ctx.can("inspection.view")) notFound();
  const t = await getTranslations("inspection");
  const prefs = await formatPrefs(ctx);
  const now = new Date();

  const year = await ctx.db.academicYear.findFirst({ where: { isCurrent: true }, select: { startsOn: true } });
  const yearRange = year ? parseDayRange(year.startsOn.toISOString().slice(0, 10), dubaiDayKey(now)) : null;
  const preset = sp.preset ?? (sp.from || sp.to ? "custom" : "last30");
  let range: DayRange | null = null;
  if (preset === "last90") range = lastDays(now, 90);
  else if (preset === "year" && yearRange) range = yearRange;
  else if (preset === "custom") range = parseDayRange(sp.from, sp.to);
  else range = lastDays(now, 30);
  const invalid = !range || range.to.getTime() - range.from.getTime() > 400 * 86_400_000;
  const showRefs = sp.refs === "1";

  const pack = invalid ? null : await buildEvidencePack(ctx, { from: range!.from, to: range!.to, now, withReferences: showRefs });
  if (pack && showRefs) {
    // Rule 6: every view of a sensitive record is audited. One event per listed case.
    const cases = await referencedCaseIds(ctx, range!.from, range!.to);
    for (const c of cases) {
      await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "inspection.case_reference_view", entityType: "Case", entityId: c.id, sensitivity: c.sensitivity, meta: { from: range!.fromKey, to: range!.toKey } });
    }
  }

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { preset, from: preset === "custom" ? range?.fromKey : undefined, to: preset === "custom" ? range?.toKey : undefined, refs: showRefs ? "1" : undefined };
    for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportHref = (format: "pdf" | "csv") => (range ? `/api/inspection/export?format=${format}&from=${range.fromKey}&to=${range.toKey}` : "#");
  const presets = [
    { key: "last30", label: t("presets.last30") },
    { key: "last90", label: t("presets.last90") },
    ...(yearRange ? [{ key: "year", label: t("presets.year") }] : []),
  ];

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          pack ? (
            <>
              <Button variant="outline" asChild>
                <a href={exportHref("csv")} data-testid="inspection-csv">
                  <FileSpreadsheet className="size-4" />
                  {t("exportCsv")}
                </a>
              </Button>
              <Button asChild>
                <a href={exportHref("pdf")} data-testid="inspection-pdf">
                  <Download className="size-4" />
                  {t("exportPdf")}
                </a>
              </Button>
            </>
          ) : null
        }
      />
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground" data-testid="inspection-disclaimer">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="space-y-1">
          <p>{t("disclaimer")}</p>
          <p className="text-muted-foreground">
            {t("aggregatesOnly")} {t("exportHint")}
          </p>
        </div>
      </div>

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("presets.label")}>
            {presets.map((p) => (
              <Button key={p.key} variant={preset === p.key ? "default" : "outline"} size="sm" asChild>
                <Link href={`/admin/inspection${qs({ preset: p.key, from: undefined, to: undefined })}`} data-testid={`preset-${p.key}`}>
                  {p.label}
                </Link>
              </Button>
            ))}
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2 sm:ms-auto">
            <input type="hidden" name="preset" value="custom" />
            {showRefs && <input type="hidden" name="refs" value="1" />}
            <label className="space-y-1 text-xs font-medium">
              <span className="block text-muted-foreground">{t("from")}</span>
              <Input type="date" name="from" defaultValue={range?.fromKey} className="h-8 w-40" data-testid="range-from" />
            </label>
            <label className="space-y-1 text-xs font-medium">
              <span className="block text-muted-foreground">{t("to")}</span>
              <Input type="date" name="to" defaultValue={range?.toKey} className="h-8 w-40" data-testid="range-to" />
            </label>
            <Button type="submit" size="sm" variant="outline" data-testid="range-apply">
              {t("apply")}
            </Button>
          </form>
        </div>
      </Panel>

      {!pack ? (
        <EmptyState icon={<ClipboardList className="size-5" />} title={t("error.INVALID_RANGE")} />
      ) : (
        pack.sections.map((s) => (
          <Panel key={s.key} className="space-y-4" padded>
            <div data-testid={`section-${s.key}`}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("headingPrefix")}</div>
              <h2 className="text-base font-semibold">{t(`headings.${s.key}`)}</h2>
            </div>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.metrics.map((m) => (
                <div key={m.key} className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2" data-testid={`metric-${m.key}`}>
                  <dt className="text-xs text-muted-foreground">{t(`metrics.${m.key}`)}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">{valueText(m, prefs, t)}</dd>
                  {m.breakdown && m.breakdown.length > 0 && (
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {m.breakdown.map((b) => (
                        <Pill key={b.key} tone="neutral">
                          {t(`breakdown.${b.key}`)} {fmtNumber(prefs, b.value)}
                        </Pill>
                      ))}
                    </dd>
                  )}
                  {m.note === "snapshot" && m.value !== null && <dd className="mt-1 text-[11px] text-muted-foreground">{t("notes.snapshot")}</dd>}
                </div>
              ))}
            </dl>

            {(s.key === "safeguarding" || s.key === "wellbeing") && (
              <div className="rounded-lg border border-dashed p-3" data-testid={`refs-${s.key}`}>
                {s.referencesAllowed ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{t("references.hint")}</p>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/inspection${qs({ refs: showRefs ? undefined : "1" })}`} data-testid={`toggle-refs-${s.key}`}>
                          {showRefs ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          {showRefs ? t("references.hide") : t("references.show")}
                        </Link>
                      </Button>
                    </div>
                    {showRefs && s.references && (
                      <div className="mt-2 overflow-x-auto">
                        {s.references.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t("references.none")}</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="text-xs text-muted-foreground">
                              <tr className="border-b">
                                <th className="py-1.5 pe-3 text-start font-medium">{t("references.number")}</th>
                                <th className="py-1.5 pe-3 text-start font-medium">{t("references.status")}</th>
                                <th className="py-1.5 pe-3 text-start font-medium">{t("references.opened")}</th>
                                <th className="py-1.5 pe-3 text-start font-medium">{t("references.firstResponse")}</th>
                                <th className="py-1.5 text-start font-medium">{t("references.closed")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.references.map((r) => (
                                <tr key={r.number} className="border-b last:border-0" data-testid="case-ref">
                                  <td className="py-1.5 pe-3 font-mono text-xs" dir="ltr">
                                    {r.number}
                                  </td>
                                  <td className="py-1.5 pe-3">{t(`breakdown.${r.status}`)}</td>
                                  <td className="py-1.5 pe-3">{fmtDate(prefs, new Date(r.openedAt))}</td>
                                  <td className="py-1.5 pe-3">{r.firstResponseHours === null ? "-" : t("units.hours", { n: fmtNumber(prefs, r.firstResponseHours) })}</td>
                                  <td className="py-1.5">{r.closedAt ? fmtDate(prefs, new Date(r.closedAt)) : "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lock className="size-3.5 shrink-0" />
                    {t("references.notAllowed")}
                  </p>
                )}
              </div>
            )}

            <div className="border-t pt-3">
              <div className="text-xs font-semibold">{t("mapping.title")}</div>
              <p className="text-[11px] text-muted-foreground">{t("mapping.hint")}</p>
              <ul className="mt-2 space-y-1.5" data-testid={`mapping-${s.key}`}>
                {s.mapping.map((r) => (
                  <li key={r.framework} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-start sm:gap-3">
                    <span className="flex shrink-0 items-center gap-1.5 font-medium sm:w-56">
                      {t(`mapping.frameworks.${r.framework}`)}
                      {r.framework === pack.regulator && <Pill tone="brand">{t("mapping.yours")}</Pill>}
                      {r.customized && <Pill tone="info">{t("mapping.customized")}</Pill>}
                    </span>
                    <span className="min-w-0 text-muted-foreground">
                      {ctx.locale === "ar" ? r.areaAr : r.areaEn}
                      {(ctx.locale === "ar" ? r.noteAr : r.noteEn) && <span className="block text-[11px] italic">{ctx.locale === "ar" ? r.noteAr : r.noteEn}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        ))
      )}
    </PageBody>
  );
}

function valueText(m: Metric, prefs: FormatPrefs, t: Awaited<ReturnType<typeof getTranslations<"inspection">>>) {
  if (m.value === null) return <span className="text-sm font-normal text-muted-foreground">{m.note ? t(`notes.${m.note}`) : "-"}</span>;
  if (m.unit === "date") return fmtDate(prefs, new Date(String(m.value)));
  const n = (v: number) => fmtNumber(prefs, v, { maximumFractionDigits: 1 });
  const v = Number(m.value);
  if (m.unit === "hours") return t("units.hours", { n: n(v) });
  if (m.unit === "days") return t("units.days", { n: n(v) });
  if (m.unit === "percent") return t("units.percent", { n: n(v) });
  if (m.unit === "ratio") return t("units.ratio", { value: n(v), of: n(m.of ?? 0) });
  return n(v);
}
