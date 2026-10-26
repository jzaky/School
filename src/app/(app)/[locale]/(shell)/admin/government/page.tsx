import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarClock, ChevronRight, FileCheck2, FileClock, Info, Landmark, ScrollText } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtRelative } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link, redirect } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Pill, type Tone } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { canPrepare, canView } from "@/server/govreports/access";
import { authorityFor, overviewData } from "@/server/govreports/queries";
import { todayKey } from "@/server/govreports/kinds";
import { dateKey } from "@/server/timetable/cover";
import { DueDateButton, DueDeleteButton, DueDoneButton, NewReturnButton } from "@/components/government/dialogs";

export async function generateMetadata() {
  const t = await getTranslations("govReports");
  return { title: t("title") };
}

const STATUS_TONE: Record<string, Tone> = { DRAFT: "neutral", SIGNED_OFF: "brand", SUBMITTED: "success" };
const TABS = ["returns", "due", "log"] as const;
type Tab = (typeof TABS)[number];
const DAY = 86_400_000;

export default async function GovernmentPage({ searchParams }: { searchParams: Promise<{ tab?: string; open?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canView(ctx)) notFound();
  // Guide links: open the latest return still being prepared (or the latest one sent).
  if (sp.open === "draft" || sp.open === "submitted") {
    const r = await ctx.db.govReturn.findFirst({ where: sp.open === "draft" ? { status: { not: "SUBMITTED" } } : { status: "SUBMITTED" }, orderBy: [{ createdAt: "desc" }], select: { id: true } });
    if (r) redirect({ href: `/admin/government/${r.id}`, locale: ctx.locale });
  }
  const t = await getTranslations("govReports");
  const prefs = await formatPrefs(ctx);
  const prepare = canPrepare(ctx);
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "returns";
  const [authority, data] = await Promise.all([authorityFor(ctx), overviewData(ctx)]);
  const today = todayKey(new Date());
  const daysTo = (d: Date) => Math.round((new Date(`${dateKey(d)}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY);
  const open = data.due.filter((d) => !d.doneAt);
  const next = open.find((d) => daysTo(d.dueOn) >= 0) ?? null;
  const drafts = data.returns.filter((r) => r.status !== "SUBMITTED").length;
  const yearAgo = new Date(Date.now() - 365 * DAY);
  const sentThisYear = data.log.filter((s) => s.submittedOn >= yearAgo).length;
  const dueTitle = (d: { titleEn: string; titleAr: string }) => pick(ctx.locale, d.titleEn, d.titleAr);
  const dueOptions = open.map((d) => ({ id: d.id, title: `${dueTitle(d)} (${fmtDate(prefs, d.dueOn)})`, kind: d.kind, dueOn: dateKey(d.dueOn) }));
  const returnForDue = (id: string) => data.returns.find((r) => r.dueDateId === id);
  const dueLabel = (d: Date) => {
    const n = daysTo(d);
    return n === 0 ? t("stats.dueToday", { date: fmtDate(prefs, d) }) : n > 0 ? t("stats.dueIn", { date: fmtDate(prefs, d), n }) : t("stats.overdue", { date: fmtDate(prefs, d), n: -n });
  };

  return (
    <PageBody className="max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle", { authority: authority.full })} actions={prepare ? <NewReturnButton dues={dueOptions} /> : undefined} />

      <div className="flex flex-col gap-3 rounded-xl border bg-info-soft/40 px-4 py-3 sm:flex-row sm:items-start" data-testid="gov-authority">
        <Landmark className="size-5 shrink-0 text-info" />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-medium">{t("authorityCard.title", { authority: authority.full })}</p>
          <p className="text-muted-foreground">{t("authorityCard.body", { authority: authority.short })}</p>
        </div>
        {ctx.can("admissions.manage") && (
          <Link href="/admissions/settings" className="shrink-0 text-sm font-medium text-brand hover:underline">
            {t("authorityCard.change")}
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("stats.nextDue")} value={<span className="block text-base leading-snug">{next ? dueTitle(next) : t("stats.noneDue")}</span>} hint={next ? dueLabel(next.dueOn) : undefined} icon={<CalendarClock className="size-5" />} tone={next && daysTo(next.dueOn) <= 3 ? "warning" : "info"} href="/admin/government?tab=due" testId="gov-stat-next" />
        <StatCard label={t("stats.drafts")} value={drafts} icon={<FileClock className="size-5" />} tone="brand" />
        <StatCard label={t("stats.submitted")} value={sentThisYear} icon={<FileCheck2 className="size-5" />} tone="success" href="/admin/government?tab=log" />
      </div>

      <nav className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-fit" aria-label={t("title")}>
        {TABS.map((k) => (
          <Link key={k} href={k === "returns" ? "/admin/government" : `/admin/government?tab=${k}`} className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition", tab === k ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")} aria-current={tab === k ? "page" : undefined} data-testid={`gov-tab-${k}`}>
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>

      {tab === "returns" &&
        (data.returns.length === 0 ? (
          <EmptyState icon={<Landmark className="size-5" />} title={t("list.empty")} body={prepare ? t("list.emptyBody") : t("list.emptyView")} action={prepare ? <NewReturnButton dues={dueOptions} /> : undefined} />
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="gov-returns">
            {data.returns.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/government/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40" data-testid="gov-return-row">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                    <ScrollText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.latestSubmission
                        ? t("list.reference", { ref: r.latestSubmission.reference })
                        : r.latestExport
                          ? t("list.lastFile", { version: r.latestExport.version, when: fmtRelative(prefs, r.latestExport.createdAt) })
                          : t("list.noFile")}
                    </div>
                  </div>
                  <Pill tone={STATUS_TONE[r.status] ?? "neutral"} dot>
                    {t(`status.${r.status}`)}
                  </Pill>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {tab === "due" && (
        <Panel>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>{t("due.body")}</p>
            </div>
            {prepare && <DueDateButton />}
          </div>
          {data.due.length === 0 ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title={t("due.empty")} body={t("due.emptyBody")} />
          ) : (
            <ul className="divide-y rounded-lg border" data-testid="gov-due-list">
              {[...open, ...data.due.filter((d) => d.doneAt).reverse()].map((d) => {
                const n = daysTo(d.dueOn);
                const linked = returnForDue(d.id);
                const tone: Tone = d.doneAt ? "success" : n < 0 ? "danger" : n <= 3 ? "warning" : n <= 14 ? "info" : "neutral";
                return (
                  <li key={d.id} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center" data-testid="gov-due-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{dueTitle(d)}</span>
                        <Pill tone="neutral">{t(`kind.${d.kind}`)}</Pill>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmtDate(prefs, d.dueOn, "long")}
                        {d.notes ? ` · ${d.notes}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={tone} dot>
                        {d.doneAt ? t("due.doneOn", { date: fmtDate(prefs, d.doneAt) }) : n === 0 ? t("due.today") : n > 0 ? t("due.inDays", { n }) : t("due.overdue", { n: -n })}
                      </Pill>
                      {linked ? (
                        <Link href={`/admin/government/${linked.id}`} className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-brand hover:bg-brand-soft/50">
                          {t("due.openReturn")}
                        </Link>
                      ) : (
                        prepare && !d.doneAt && d.kind !== "OTHER" && <NewReturnButton dues={dueOptions} preset={{ dueId: d.id, kind: d.kind, dueOn: dateKey(d.dueOn) }} variant="ghost" label={t("due.start")} />
                      )}
                      {prepare && (
                        <>
                          <DueDoneButton id={d.id} done={Boolean(d.doneAt)} />
                          <DueDateButton initial={{ id: d.id, titleEn: d.titleEn, titleAr: d.titleAr, kind: d.kind, dueOn: dateKey(d.dueOn), notes: d.notes }} />
                          <DueDeleteButton id={d.id} />
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {tab === "log" &&
        (data.log.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-5" />} title={t("log.empty")} body={t("log.emptyBody")} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <table className="w-full min-w-[640px] text-sm" data-testid="gov-log">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t("log.sentOn")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("log.return")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("log.file")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("log.reference")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("log.recordedBy")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.log.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(prefs, s.submittedOn)}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/government/${s.returnId}`} className="font-medium hover:text-brand">
                        {s.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {s.file ? (
                        <>
                          {t("detail.version", { version: s.file.version })} · {s.file.format} ·{" "}
                          <span dir="ltr" className="font-mono text-xs">
                            {s.file.fileSha256.slice(0, 12)}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs" dir="ltr">
                      {s.reference}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{s.by ? pick(ctx.locale, s.by.en, s.by.ar) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </PageBody>
  );
}
