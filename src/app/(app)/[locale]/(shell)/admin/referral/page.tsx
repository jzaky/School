import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Gift, Link2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { CopyField } from "@/components/access/invite-forms";
import { ensureReferralCode } from "@/server/platform/referrals";

export async function generateMetadata() {
  const t = await getTranslations("growth.referral");
  return { title: t("title") };
}

/** Public origin for share links: APP_URL when set, otherwise the host this request came in on. */
async function origin() {
  const fromEnv = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function ReferralPage() {
  const ctx = await getCtx();
  if (!(ctx.can("school.manage") || ctx.roles.includes("principal"))) notFound();
  const t = await getTranslations("growth.referral");
  const code = await ensureReferralCode(ctx.db, ctx.orgId);
  const link = `${await origin()}/signup?ref=${code}`;
  return (
    <PageBody className="max-w-3xl">
      <PageHeader title={t("title")} description={t("body")} />
      <Panel>
        <PanelHeader icon={<Gift className="size-4" />} title={t("codeTitle")} description={t("codeBody")} />
        <p className="font-mono text-2xl font-semibold tracking-[0.2em]" dir="ltr" data-testid="referral-code">
          {code}
        </p>
      </Panel>
      <Panel>
        <PanelHeader icon={<Link2 className="size-4" />} title={t("linkTitle")} description={t("linkBody")} />
        <CopyField value={link} testId="referral-link" />
      </Panel>
      <p className="text-sm text-muted-foreground">{t("how")}</p>
    </PageBody>
  );
}
