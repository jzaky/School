import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Bell, Palette, UserRound } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { DisplaySettings, EmailPreferences } from "@/components/settings/settings-forms";
import { FAMILY_KINDS, LOCKED_KINDS, STAFF_KINDS } from "@/server/settings/kinds";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const ctx = await getCtx();
  const t = await getTranslations("settings");
  const tr = await getTranslations("roles");
  const jar = await cookies();
  const numerals = (jar.get("numerals")?.value as "WESTERN" | "ARABIC_INDIC" | undefined) ?? ctx.org.numerals;
  const hijri = jar.get("hijri")?.value === "1";
  const kinds = ctx.isStaff ? STAFF_KINDS : FAMILY_KINDS;
  const prefs = await ctx.db.notificationPreference.findMany({ where: { orgId: ctx.orgId, membershipId: ctx.membershipId } });
  const rows = kinds.map((kind) => {
    const p = prefs.find((x) => x.kind === kind);
    return { kind, label: t(`kinds.${kind}`), email: !p || p.channels.includes("EMAIL") };
  });
  const locked = ctx.isStaff && (ctx.can("safeguarding.view") || ctx.can("safeguarding.refer")) ? LOCKED_KINDS.map((kind) => ({ kind, label: t(`kinds.${kind}`) })) : [];
  const roleLabels = ctx.roles.map((r) => (tr.has(r) ? tr(r) : r));
  return (
    <PageBody className="max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Panel>
        <PanelHeader title={t("profile")} icon={<UserRound className="size-4" />} />
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("name")}</dt>
            <dd className="mt-0.5 font-medium">{pick(ctx.locale, ctx.user.nameEn, ctx.user.nameAr)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("emailAddress")}</dt>
            <dd className="mt-0.5 font-medium" dir="ltr">
              {ctx.user.email}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("school")}</dt>
            <dd className="mt-0.5 font-medium">{pick(ctx.locale, ctx.org.nameEn, ctx.org.nameAr)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("roles")}</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {roleLabels.map((r) => (
                <Pill key={r}>{r}</Pill>
              ))}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">{t("profileHint")}</p>
      </Panel>
      <Panel>
        <PanelHeader title={t("display")} description={t("displayHint")} icon={<Palette className="size-4" />} />
        <DisplaySettings hijri={hijri} hijriAvailable={ctx.org.hijriEnabled} numerals={numerals} />
      </Panel>
      <div id="notifications" className="scroll-mt-20">
        <Panel>
          <PanelHeader title={t("notifications")} description={t("notificationsHint")} icon={<Bell className="size-4" />} />
          <EmailPreferences kinds={rows} locked={locked} emailEnabled={Boolean(process.env.RESEND_API_KEY)} />
        </Panel>
      </div>
    </PageBody>
  );
}
