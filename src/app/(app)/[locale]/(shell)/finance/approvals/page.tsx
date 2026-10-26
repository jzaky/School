import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Stamp } from "lucide-react";
import { getCtx } from "@/server/context";
import { identityDb } from "@/lib/tenant-db";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Link } from "@/i18n/navigation";
import { personName, pick, userName } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { formatAed } from "@/server/fees/money";
import { formatPrefs } from "@/server/format";
import { AwardStatus, FinanceTabs, Money, RefundStatus } from "@/components/fees/shared";
import { DecisionButtons } from "@/components/fees/payment-actions";
import { canFinance } from "@/server/fees/queries";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("approvals.title") };
}

export default async function ApprovalsPage() {
  const ctx = await getCtx();
  if (!canFinance(ctx) || !ctx.can("fees.refund.approve")) notFound();
  const t = await getTranslations("finance");
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const [refunds, awards, recentRefunds, recentAwards] = await Promise.all([
    ctx.db.feeRefund.findMany({ where: { status: "REQUESTED" }, orderBy: { requestedAt: "asc" }, take: 100 }),
    ctx.db.feeAward.findMany({ where: { status: "PENDING" }, include: { discount: true }, orderBy: { createdAt: "asc" }, take: 100 }),
    ctx.db.feeRefund.findMany({ where: { status: { not: "REQUESTED" } }, orderBy: { decidedAt: "desc" }, take: 5 }),
    ctx.db.feeAward.findMany({ where: { status: { in: ["APPROVED", "REJECTED"] }, decidedAt: { not: null } }, include: { discount: true }, orderBy: { decidedAt: "desc" }, take: 5 }),
  ]);
  const accountIds = [...refunds, ...recentRefunds].map((r) => r.accountId);
  const studentIds = [...awards, ...recentAwards].map((a) => a.studentId);
  const memberIds = [...refunds, ...awards].map((x) => x.requestedById).filter((x): x is string => Boolean(x));
  const [accounts, students, members] = await Promise.all([
    ctx.db.feeAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, nameEn: true, nameAr: true } }),
    ctx.db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true } }),
    ctx.db.membership.findMany({ where: { id: { in: memberIds } }, select: { id: true, userId: true } }),
  ]);
  const users = await identityDb.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, nameEn: true, nameAr: true } });
  const who = (mid: string | null) => userName(users.find((u) => u.id === members.find((m) => m.id === mid)?.userId), L);
  const profiles = await ctx.db.studentFeeProfile.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, accountId: true } });
  const student = (id: string) => {
    const s = students.find((x) => x.id === id);
    return s ? personName(s, L) : "";
  };

  return (
    <PageBody>
      <PageHeader title={t("approvals.title")} description={t("approvals.subtitle")} />
      <FinanceTabs active="approvals" can={ctx.can} />
      <Panel padded={false}>
        <div className="p-5 pb-2">
          <PanelHeader title={t("approvals.refunds")} description={t("approvals.refundsBody")} />
        </div>
        {refunds.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState icon={<Stamp className="size-5" />} title={t("approvals.noRefunds")} />
          </div>
        ) : (
          <ul className="divide-y" data-testid="pending-refunds">
            {refunds.map((r) => {
              const a = accounts.find((x) => x.id === r.accountId);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      <Link href={`/finance/accounts/${r.accountId}`} className="hover:underline">
                        {a ? pick(L, a.nameEn, a.nameAr) : ""}
                      </Link>{" "}
                      · <Money fils={r.amountFils} locale={L} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.reason} · {t("approvals.askedBy", { name: who(r.requestedById), date: fmtDate(prefs, r.requestedAt) })}
                    </div>
                  </div>
                  <DecisionButtons kind="refund" id={r.id} own={r.requestedById === ctx.membershipId} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel padded={false}>
        <div className="p-5 pb-2">
          <PanelHeader title={t("approvals.awards")} description={t("approvals.awardsBody")} />
        </div>
        {awards.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState icon={<Stamp className="size-5" />} title={t("approvals.noAwards")} />
          </div>
        ) : (
          <ul className="divide-y" data-testid="pending-awards">
            {awards.map((a) => {
              const acc = profiles.find((p) => p.studentId === a.studentId)?.accountId;
              const value = a.discount.method === "PERCENT" ? `${(a.discount.percentBp ?? 0) / 100}%` : formatAed(a.discount.amountFils ?? 0, L);
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {acc ? (
                        <Link href={`/finance/accounts/${acc}`} className="hover:underline">
                          {student(a.studentId)}
                        </Link>
                      ) : (
                        student(a.studentId)
                      )}{" "}
                      · {pick(L, a.discount.nameEn, a.discount.nameAr)} ({value})
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.reason} · {t("approvals.askedBy", { name: who(a.requestedById), date: fmtDate(prefs, a.createdAt) })}
                    </div>
                  </div>
                  <DecisionButtons kind="award" id={a.id} own={a.requestedById === ctx.membershipId} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {(recentRefunds.length > 0 || recentAwards.length > 0) && (
        <Panel>
          <PanelHeader title={t("approvals.recent")} />
          <ul className="space-y-2 text-sm">
            {recentRefunds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {t("approvals.refundFor", { family: pick(L, accounts.find((x) => x.id === r.accountId)?.nameEn, accounts.find((x) => x.id === r.accountId)?.nameAr) })} · <Money fils={r.amountFils} locale={L} />
                </span>
                <RefundStatus status={r.status} />
              </li>
            ))}
            {recentAwards.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {student(a.studentId)} · {pick(L, a.discount.nameEn, a.discount.nameAr)}
                </span>
                <AwardStatus status={a.status} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageBody>
  );
}
