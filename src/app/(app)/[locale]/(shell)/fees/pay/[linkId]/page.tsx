import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FlaskConical } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Money } from "@/components/fees/shared";
import { TestCheckoutButtons } from "@/components/fees/parent-pay";
import { parentAccountIds } from "@/server/fees/accounts";
import { configuredProvider } from "@/server/payments/providers";

export async function generateMetadata() {
  const t = await getTranslations("finance.parent");
  return { title: t("testTitle") };
}

/** The built-in test checkout (PAYMENTS_PROVIDER=console). No card details are asked for and no money moves. */
export default async function TestCheckoutPage({ params }: { params: Promise<{ linkId: string }> }) {
  const ctx = await getCtx();
  if (!ctx.isParent || configuredProvider()?.key !== "console") notFound();
  const { linkId } = await params;
  const link = await ctx.db.paymentLink.findFirst({ where: { id: linkId, provider: "console" } });
  if (!link || !(await parentAccountIds(ctx.db, ctx)).includes(link.accountId)) notFound();
  const invoice = link.invoiceId ? await ctx.db.invoice.findFirst({ where: { id: link.invoiceId }, select: { number: true } }) : null;
  const t = await getTranslations("finance.parent");
  return (
    <PageBody className="max-w-lg">
      <PageHeader title={t("testTitle")} />
      <Panel className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-sm" data-testid="test-banner">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{t("testBody")}</span>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t("testAmount")}</div>
          <div className="text-3xl font-semibold">
            <Money fils={link.amountFils} locale={ctx.locale} />
          </div>
          {invoice && <div className="text-sm text-muted-foreground"><bdi>{invoice.number}</bdi></div>}
        </div>
        {link.status === "OPEN" && link.expiresAt > new Date() ? <TestCheckoutButtons linkId={link.id} /> : <p className="text-sm text-muted-foreground">{t("testClosed")}</p>}
      </Panel>
    </PageBody>
  );
}
