import { getTranslations } from "next-intl/server";
import { ExternalLink, Tags } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { PricingSettingsForm } from "@/components/marketing/pricing-settings-form";
import { platformAdminPage, platformDb } from "@/server/platform/admin";
import { getPricing } from "@/server/marketing/pricing-store";

export async function generateMetadata() {
  const t = await getTranslations("growth.platform");
  return { title: t("settingsTitle") };
}

export default async function PlatformSettingsPage() {
  await platformAdminPage();
  const t = await getTranslations("growth.platform");
  const pricing = await getPricing(platformDb());
  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("settingsTitle")}
        description={t("settingsBody")}
        actions={
          <Button asChild variant="outline">
            <a href="/pricing" target="_blank" rel="noopener">
              <ExternalLink className="size-4" />
              {t("viewPricing")}
            </a>
          </Button>
        }
      />
      <Panel>
        <PanelHeader icon={<Tags className="size-4" />} title={t("pricingTitle")} description={t("pricingBody")} />
        <PricingSettingsForm initial={pricing} />
      </Panel>
    </PageBody>
  );
}
