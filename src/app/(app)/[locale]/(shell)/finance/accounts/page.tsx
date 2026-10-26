import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Building2, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Pill } from "@/components/app/badges";
import { Link } from "@/i18n/navigation";
import { pick } from "@/lib/i18n-data";
import { FinanceTabs, Money, Pager, qs } from "@/components/fees/shared";
import { SyncAccountsButton } from "@/components/fees/setup-dialogs";
import { canFinance, listAccounts, PAGE_SIZE, studentsWithoutAccount } from "@/server/fees/queries";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("accounts.title") };
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx)) notFound();
  const t = await getTranslations("finance");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filter = ["owing", "overdue", "credit", "sponsor"].includes(sp.filter ?? "") ? sp.filter! : "all";
  const { rows, total } = await listAccounts(ctx, { q: sp.q, filter, page });
  const unlinked = ctx.can("fees.manage") ? await studentsWithoutAccount(ctx.orgId) : 0;
  const L = ctx.locale;
  const base = { q: sp.q, filter: filter === "all" ? undefined : filter };
  return (
    <PageBody>
      <PageHeader title={t("accounts.title")} description={t("accounts.subtitle")} actions={ctx.can("fees.manage") ? <SyncAccountsButton /> : null} />
      <FinanceTabs active="accounts" can={ctx.can} />
      {unlinked > 0 && <p className="rounded-lg border border-info/30 bg-info-soft/50 p-3 text-sm" data-testid="unlinked-note">{t("accounts.unlinked", { n: unlinked })}</p>}
      <FilterBar
        tabParam="filter"
        tabs={[
          { value: "all", label: t("accounts.filter.all") },
          { value: "owing", label: t("accounts.filter.owing") },
          { value: "overdue", label: t("accounts.filter.overdue") },
          { value: "credit", label: t("accounts.filter.credit") },
          { value: "sponsor", label: t("accounts.filter.sponsor") },
        ]}
        searchPlaceholder={t("accounts.search")}
      />
      <Panel padded={false}>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<Users className="size-5" />} title={sp.q || filter !== "all" ? t("accounts.noMatch") : t("accounts.empty")} body={sp.q || filter !== "all" ? undefined : t("accounts.emptyBody")} action={!sp.q && filter === "all" && ctx.can("fees.manage") ? <SyncAccountsButton variant="default" /> : undefined} />
          </div>
        ) : (
          <>
            <div className="hidden grid-cols-[1fr_6rem_9rem_9rem_9rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>{t("accounts.family")}</span>
              <span>{t("accounts.children")}</span>
              <span className="text-end">{t("accounts.owed")}</span>
              <span className="text-end">{t("accounts.overdue")}</span>
              <span className="text-end">{t("accounts.credit")}</span>
            </div>
            <ul className="divide-y" data-testid="account-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/finance/accounts/${r.id}`} className="grid gap-1 px-4 py-3 text-sm hover:bg-muted/40 md:grid-cols-[1fr_6rem_9rem_9rem_9rem] md:items-center md:gap-3" data-testid="account-row">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="truncate">{pick(L, r.nameEn, r.nameAr)}</span>
                        {r.payerType === "SPONSOR" && (
                          <Pill tone="violet">
                            <Building2 className="size-3" />
                            {t("accounts.sponsored")}
                          </Pill>
                        )}
                        {r.applicant && <Pill tone="info">{t("accounts.applicant")}</Pill>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <bdi>{r.code}</bdi>
                        {r.sponsorName ? ` · ${r.sponsorName}` : ""}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground md:text-sm">{t("accounts.childrenN", { n: r.students })}</span>
                    <span className="md:text-end">
                      <span className="me-1 text-xs text-muted-foreground md:hidden">{t("accounts.owed")}</span>
                      <Money fils={r.owed} locale={L} />
                    </span>
                    <span className="md:text-end">
                      {r.overdue > 0 ? (
                        <span className="font-medium text-danger">
                          <span className="me-1 text-xs text-muted-foreground md:hidden">{t("accounts.overdue")}</span>
                          <Money fils={r.overdue} locale={L} />
                        </span>
                      ) : (
                        <span className="hidden text-muted-foreground md:inline">-</span>
                      )}
                    </span>
                    <span className="md:text-end">{r.credit > 0 ? <Money fils={r.credit} locale={L} className="text-success" /> : <span className="hidden text-muted-foreground md:inline">-</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager page={page} total={total} pageSize={PAGE_SIZE} href={(p) => `/finance/accounts${qs(base, { page: p > 1 ? p : undefined })}`} />
          </>
        )}
      </Panel>
    </PageBody>
  );
}
