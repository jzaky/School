import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Building2, Download, FileText, Receipt, UserRound } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { personName, pick } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { formatPrefs } from "@/server/format";
import { AwardStatus, InvoiceStatus, Money, PaymentStatus, RefundStatus } from "@/components/fees/shared";
import { AccountEditDialog, AddChargeDialog, ApplyCreditButton, AwardDialog, BillFamilyDialog, LeaverDialog, RecordPaymentDialog, RefundDialog, RemoveChargeButton, RevokeAwardButton, StudentProfileDialog } from "@/components/fees/account-dialogs";
import { BounceDialog, ClearChequeDialog } from "@/components/fees/payment-actions";
import { accountDetail, canFinance, todayKey, yearContext } from "@/server/fees/queries";
import { balanceOf, unallocatedOf } from "@/server/fees/ledger";
import { dayInput } from "@/server/fees/money";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("account.title") };
}

const TABS = ["invoices", "payments", "credits", "statement"] as const;

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx)) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const d = await accountDetail(ctx, id);
  if (!d) notFound();
  const t = await getTranslations("finance");
  const tg = await getTranslations();
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "invoices";
  const today = new Date(`${todayKey()}T00:00:00+04:00`);
  const { year, plans } = await yearContext(ctx);
  const canManage = ctx.can("fees.manage");
  const canCollect = ctx.can("fees.collect");
  const [items, discounts, zones, otherAccounts] = canManage
    ? await Promise.all([
        year ? ctx.db.feeItem.findMany({ where: { academicYearId: year.id, active: true, recurring: false }, orderBy: [{ kind: "asc" }, { code: "asc" }] }) : Promise.resolve([]),
        ctx.db.feeDiscount.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
        year ? ctx.db.feeItem.findMany({ where: { academicYearId: year.id, kind: "TRANSPORT", active: true }, select: { zone: true, nameEn: true, nameAr: true } }) : Promise.resolve([]),
        ctx.db.feeAccount.findMany({ where: { OR: [{ id: d.account.id }, { payerType: "SPONSOR" }] }, select: { id: true, code: true, nameEn: true, nameAr: true }, orderBy: { code: "asc" }, take: 200 }),
      ])
    : [[], [], [], []];
  const childOpts = d.students.map((s) => ({ value: s.id, label: personName(s, L) }));
  const open = d.invoices.filter((i) => i.kind === "TAX" && (i.status === "OPEN" || i.status === "PARTIAL"));
  // Open proformas (for example a seat booking) can be paid too: a payment that covers one turns it into a tax invoice.
  const payable = [...open, ...d.invoices.filter((i) => i.kind === "PROFORMA" && i.status === "OPEN")];
  const payer = d.account.payerType === "SPONSOR" ? d.account.sponsorName : d.payer ? personName(d.payer, L) : null;
  const guardians = [...new Map(d.linkedGuardians.map((l) => [l.guardian.id, { value: l.guardian.id, label: personName(l.guardian, L) }])).values()];
  const refundable = d.payments.filter((p) => unallocatedOf(p) > 0).map((p) => ({ id: p.id, label: p.number ?? "", availableFils: unallocatedOf(p) }));
  const parts = plans.flatMap((p) => p.parts.map((x) => ({ id: x.id, label: `${pick(L, p.nameEn, p.nameAr)}: ${pick(L, x.labelEn, x.labelAr)}`, due: dayInput(x.dueDate) })));
  const tabHref = (k: string) => `/finance/accounts/${id}${k === "invoices" ? "" : `?tab=${k}`}`;

  return (
    <PageBody>
      <Link href="/finance/accounts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("account.back")}
      </Link>
      <PageHeader
        eyebrow={<bdi>{d.account.code}</bdi>}
        title={<span data-testid="account-name">{pick(L, d.account.nameEn, d.account.nameAr)}</span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {d.account.payerType === "SPONSOR" ? <Building2 className="size-4" /> : <UserRound className="size-4" />}
            {payer ? t("account.paidBy", { payer }) : t("account.noPayer")}
            {d.account.planKey && <Pill tone="brand">{plans.find((p) => p.key === d.account.planKey) ? pick(L, plans.find((p) => p.key === d.account.planKey)!.nameEn, plans.find((p) => p.key === d.account.planKey)!.nameAr) : d.account.planKey}</Pill>}
            {d.account.remindersPaused && <Pill tone="warning">{t("account.remindersPaused")}</Pill>}
          </span>
        }
        actions={
          <>
            {canCollect && <RecordPaymentDialog accountId={d.account.id} invoices={payable.map((i) => ({ id: i.id, number: i.number, balanceFils: balanceOf(i) }))} locale={L} />}
            {canManage && <BillFamilyDialog accountId={d.account.id} parts={parts} />}
            {canManage && <AddChargeDialog accountId={d.account.id} items={items.map((i) => ({ id: i.id, label: pick(L, i.nameEn, i.nameAr), amountFils: i.amountFils }))} students={childOpts} />}
            {canManage && (
              <AccountEditDialog
                initial={{
                  id: d.account.id,
                  nameEn: d.account.nameEn,
                  nameAr: d.account.nameAr,
                  payerType: d.account.payerType,
                  payerGuardianId: d.account.payerGuardianId,
                  sponsorName: d.account.sponsorName ?? "",
                  sponsorTrn: d.account.sponsorTrn ?? "",
                  billingAddress: d.account.billingAddress ?? "",
                  billingEmail: d.account.billingEmail ?? "",
                  planKey: d.account.planKey ?? "",
                  remindersPaused: d.account.remindersPaused,
                  pausedReason: d.account.pausedReason ?? "",
                }}
                guardians={guardians}
                plans={plans.map((p) => ({ value: p.key, label: pick(L, p.nameEn, p.nameAr) }))}
              />
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("account.owed")} value={<Money fils={d.owed} locale={L} />} tone="info" testId="acc-owed" />
        <StatCard label={t("account.overdue")} value={<Money fils={d.overdue} locale={L} />} tone={d.overdue ? "danger" : "success"} testId="acc-overdue" />
        <StatCard label={t("account.credit")} value={<Money fils={d.credit} locale={L} />} tone="success" hint={d.credit > 0 && canCollect ? <span className="inline-flex flex-wrap gap-2 pt-1">{open.length > 0 && <ApplyCreditButton accountId={d.account.id} />}<RefundDialog payments={refundable} locale={L} /></span> : undefined} testId="acc-credit" />
        <StatCard label={t("account.balance")} value={<Money fils={d.balance} locale={L} />} hint={d.balance < 0 ? t("account.inCredit") : d.balance === 0 ? t("account.settled") : t("account.toPay")} tone="brand" testId="acc-balance" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("account.children")} action={canManage ? <div className="flex gap-2"><LeaverDialog students={childOpts} />{year && <AwardDialog students={childOpts} discounts={discounts.map((x) => ({ value: x.id, label: pick(L, x.nameEn, x.nameAr), approval: x.requiresApproval }))} yearId={year.id} />}</div> : undefined} />
          {d.students.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.account.applicationRef ? t("account.applicantNote", { ref: d.account.applicationRef }) : t("account.noChildren")}</p>
          ) : (
            <ul className="divide-y">
              {d.students.map((s) => {
                const prof = d.account.students.find((p) => p.studentId === s.id);
                const awards = d.awards.filter((a) => a.studentId === s.id && a.status !== "REVOKED" && a.status !== "REJECTED");
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="font-medium">{personName(s, L)}</div>
                      <div className="text-xs text-muted-foreground">
                        {tg("gradeLevel.label", gradeLevelValues(s.gradeLevel))}
                        {s.section ? ` ${s.section}` : ""} · <bdi>{s.studentNo}</bdi>
                        {prof?.transportZone ? ` · ${t("account.zone", { zone: prof.transportZone })}` : ""}
                      </div>
                      {awards.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {awards.map((a) => (
                            <span key={a.id} className="inline-flex items-center gap-1">
                              <Pill tone="gold">{pick(L, a.discount.nameEn, a.discount.nameAr)}</Pill>
                              <AwardStatus status={a.status} />
                              {canManage && <RevokeAwardButton id={a.id} />}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {s.status !== "ACTIVE" && <Pill tone="neutral">{t(`studentStatus.${s.status}`)}</Pill>}
                      {canManage && (
                        <StudentProfileDialog
                          studentId={s.id}
                          studentName={personName(s, L)}
                          accountId={d.account.id}
                          transportZone={prof?.transportZone ?? null}
                          accounts={otherAccounts.map((a) => ({ value: a.id, label: `${a.code} ${pick(L, a.nameEn, a.nameAr)}` }))}
                          zones={[...new Map(zones.filter((z) => z.zone).map((z) => [z.zone!, { value: z.zone!, label: pick(L, z.nameEn, z.nameAr) }])).values()]}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("account.pendingCharges")} description={t("account.pendingChargesBody")} />
          {d.charges.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("account.noCharges")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.charges.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {c.quantity} × {c.item ? pick(L, c.descriptionEn ?? c.item.nameEn, c.descriptionAr ?? c.item.nameAr) : ""}
                  </span>
                  <span className="flex items-center gap-1">
                    <Money fils={c.quantity * c.unitFils} locale={L} />
                    {canManage && <RemoveChargeButton id={c.id} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.refunds.length > 0 && (
            <div className="mt-5 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("account.refunds")}</h3>
              {d.refunds.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-muted-foreground">{fmtDate(prefs, r.requestedAt)}</span>
                  <Money fils={r.amountFils} locale={L} />
                  <RefundStatus status={r.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-fit">
        {TABS.map((k) => (
          <Link key={k} href={tabHref(k)} className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === k ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")} data-testid={`acc-tab-${k}`}>
            {t(`account.tab.${k}`)}
          </Link>
        ))}
      </nav>

      <Panel padded={false}>
        {tab === "invoices" &&
          (d.invoices.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<FileText className="size-5" />} title={t("account.noInvoices")} />
            </div>
          ) : (
            <ul className="divide-y" data-testid="acc-invoices">
              {d.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <Link prefetch={false} href={`/finance/invoices/${i.id}`} className="font-medium hover:underline">
                      <bdi>{i.number}</bdi>
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {i.kind === "PROFORMA" ? t("invoice.proforma") : pick(L, i.periodLabelEn, i.periodLabelAr) || t("invoice.taxInvoice")} · {t("invoice.dueOn", { date: fmtDate(prefs, i.dueDate) })}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <InvoiceStatus status={i.status} kind={i.kind} overdue={i.dueDate < today} />
                    <div className="text-end">
                      <Money fils={i.totalFils} locale={L} className="font-medium" />
                      {balanceOf(i) > 0 && i.kind === "TAX" && <div className="text-xs text-muted-foreground">{t("invoice.balanceShort")} <Money fils={balanceOf(i)} locale={L} /></div>}
                    </div>
                    <a href={`/api/fees/invoices/${i.id}/pdf`} className="text-muted-foreground hover:text-foreground" aria-label={t("invoice.download")}>
                      <Download className="size-4" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        {tab === "payments" &&
          (d.payments.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<Receipt className="size-5" />} title={t("payments.empty")} />
            </div>
          ) : (
            <ul className="divide-y" data-testid="acc-payments">
              {d.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {p.number ? <bdi>{p.number}</bdi> : t("payments.noReceiptYet")} · {t(`method.${p.method}`)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(prefs, p.receivedAt)}
                      {p.method === "CHEQUE" && p.chequeDate ? ` · ${t("payments.chequeDated", { no: p.chequeNumber ?? "", date: fmtDate(prefs, p.chequeDate) })}` : ""}
                      {p.reference ? ` · ${p.reference}` : ""}
                      {unallocatedOf(p) > 0 ? ` · ${t("payments.unallocated")}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <PaymentStatus status={p.status} />
                    <Money fils={p.amountFils} locale={L} className="font-medium" />
                    {p.status === "HELD" && canCollect && <ClearChequeDialog paymentId={p.id} chequeDate={dayInput(p.chequeDate)} />}
                    {p.method === "CHEQUE" && p.status !== "BOUNCED" && canCollect && p.refundedFils === 0 && <BounceDialog paymentId={p.id} />}
                    {p.number && (
                      <a href={`/api/fees/receipts/${p.id}/pdf`} className="text-muted-foreground hover:text-foreground" aria-label={t("payments.receipt")}>
                        <Download className="size-4" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
        {tab === "credits" &&
          (d.creditNotes.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<FileText className="size-5" />} title={t("account.noCredits")} />
            </div>
          ) : (
            <ul className="divide-y">
              {d.creditNotes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      <bdi>{c.number}</bdi>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(prefs, c.issueDate)} · {pick(L, c.reasonEn, c.reasonAr)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Money fils={c.totalFils} locale={L} className="font-medium" />
                    <a href={`/api/fees/credit-notes/${c.id}/pdf`} className="text-muted-foreground hover:text-foreground" aria-label={t("invoice.download")}>
                      <Download className="size-4" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        {tab === "statement" &&
          (d.statement.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<FileText className="size-5" />} title={t("account.noStatement")} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm" data-testid="acc-statement">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">{t("statement.date")}</th>
                    <th className="px-4 py-2 text-start font-medium">{t("statement.document")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("statement.charges")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("statement.payments")}</th>
                    <th className="px-4 py-2 text-end font-medium">{t("statement.balance")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {d.statement.map((e) => (
                    <tr key={`${e.kind}-${e.id}`}>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">{fmtDate(prefs, e.at)}</td>
                      <td className="px-4 py-2">
                        {t(`statement.kind.${e.kind}`)} <bdi className="text-muted-foreground">{e.ref}</bdi>
                      </td>
                      <td className="px-4 py-2 text-end">{e.debit ? <Money fils={e.debit} locale={L} /> : ""}</td>
                      <td className="px-4 py-2 text-end">{e.credit ? <Money fils={e.credit} locale={L} /> : ""}</td>
                      <td className="px-4 py-2 text-end font-medium">
                        <Money fils={e.balance} locale={L} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </Panel>
    </PageBody>
  );
}
