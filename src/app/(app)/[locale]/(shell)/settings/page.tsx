import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Bell, ListChecks, Palette, Smartphone, UserRound } from "lucide-react";
import type { NotificationChannel } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { canSetup } from "@/server/onboarding/access";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { DisplaySettings } from "@/components/settings/settings-forms";
import { ChannelPreferences, PushDevice, WhatsAppOptInForm } from "@/components/settings/device-channels";
import { FAMILY_KINDS, LOCKED_KINDS, STAFF_KINDS } from "@/server/settings/kinds";
import { maskPhone, pushConfig, whatsappConfig } from "@/server/notify/channels";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const ctx = await getCtx();
  const t = await getTranslations("settings");
  const td = await getTranslations("devices");
  const tr = await getTranslations("roles");
  const prefsFmt = await formatPrefs(ctx);
  const jar = await cookies();
  const numerals = (jar.get("numerals")?.value as "WESTERN" | "ARABIC_INDIC" | undefined) ?? ctx.org.numerals;
  const hijri = jar.get("hijri")?.value === "1";
  const kinds = ctx.isStaff ? STAFF_KINDS : FAMILY_KINDS;
  const push = pushConfig();
  // WhatsApp: parents only, when a provider is configured and the school sends at least one kind on it.
  const waKinds = ctx.isParent && whatsappConfig() ? ctx.org.whatsappKinds.filter((k) => FAMILY_KINDS.includes(k)) : [];
  const [prefs, subscriptions, optIn] = await Promise.all([
    ctx.db.notificationPreference.findMany({ where: { orgId: ctx.orgId, membershipId: ctx.membershipId } }),
    push ? ctx.db.pushSubscription.findMany({ where: { orgId: ctx.orgId, membershipId: ctx.membershipId }, select: { endpoint: true } }) : Promise.resolve([]),
    waKinds.length ? ctx.db.whatsAppOptIn.findFirst({ where: { orgId: ctx.orgId, membershipId: ctx.membershipId, withdrawnAt: null } }) : Promise.resolve(null),
  ]);
  const showPush = Boolean(push) && subscriptions.length > 0;
  const showWhatsApp = Boolean(optIn);
  const rows = kinds.map((kind) => {
    const p = prefs.find((x) => x.kind === kind);
    const has = (c: NotificationChannel) => !p || p.channels.includes(c);
    return { kind, label: t(`kinds.${kind}`), channels: { EMAIL: has("EMAIL"), PUSH: has("PUSH"), WHATSAPP: has("WHATSAPP") }, whatsapp: waKinds.includes(kind) };
  });
  const locked = ctx.isStaff && (ctx.can("safeguarding.view") || ctx.can("safeguarding.refer")) ? LOCKED_KINDS.map((kind) => ({ kind, label: t(`kinds.${kind}`) })) : [];
  const roleLabels = ctx.roles.map((r) => (tr.has(r) ? tr(r) : r));
  const tSetup = await getTranslations("onboarding.settingsLink");
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
            <dd className="mt-0.5 break-all font-medium" dir="ltr">
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
      {canSetup(ctx) && (
        <Panel>
          <PanelHeader
            title={tSetup("title")}
            description={tSetup("body")}
            icon={<ListChecks className="size-4" />}
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/setup" data-testid="settings-open-setup">
                  {tSetup("open")}
                </Link>
              </Button>
            }
          />
        </Panel>
      )}
      <Panel>
        <PanelHeader title={t("display")} description={t("displayHint")} icon={<Palette className="size-4" />} />
        <DisplaySettings hijri={hijri} hijriAvailable={ctx.org.hijriEnabled} numerals={numerals} />
      </Panel>
      {(push || waKinds.length > 0) && (
        <Panel>
          <PanelHeader title={td("title")} description={td("hint")} icon={<Smartphone className="size-4" />} />
          <div className="space-y-3">
            {push && <PushDevice publicKey={push.publicKey} endpoints={subscriptions.map((s) => s.endpoint)} />}
            {waKinds.length > 0 && (
              <WhatsAppOptInForm
                optIn={optIn ? { masked: maskPhone(optIn.phone), since: fmtDate(prefsFmt, optIn.consentedAt) } : null}
                defaultPhone={ctx.membership.guardian?.phone ?? ""}
                kinds={waKinds.map((k) => t(`kinds.${k}`))}
              />
            )}
          </div>
        </Panel>
      )}
      <div id="notifications" className="scroll-mt-20">
        <Panel>
          <PanelHeader title={t("notifications")} description={t("notificationsHint")} icon={<Bell className="size-4" />} />
          <ChannelPreferences kinds={rows} locked={locked} emailEnabled={Boolean(process.env.RESEND_API_KEY)} showPush={showPush} showWhatsApp={showWhatsApp} />
        </Panel>
      </div>
    </PageBody>
  );
}
