// Administration > Sign-in: which sign-in options the school's page shows, single sign-on rules, provider ids
// and the addresses to register with each provider, and recent sign-in activity. For signin.manage (the school
// administrator and the Head of IT). Shows whether server credentials are present, never their values.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Activity, Link2, ShieldCheck } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { userName } from "@/lib/i18n-data";
import { loadPolicy, oidcReady } from "@/server/sso/policy";
import { SIGN_IN_METHODS, missingEnv, uaePassEnvironment } from "@/server/sso/providers";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { AccessTabs } from "@/components/access/access-tabs";
import { CopyValue } from "@/components/integrations/api-keys";
import { MethodMark } from "@/components/sso/brand";
import { SignInSettingsForm, UnlinkButton, type MethodStatus } from "@/components/sso/settings-form";
import { Link } from "@/i18n/navigation";

export async function generateMetadata() {
  const t = await getTranslations("sso.admin");
  return { title: t("title") };
}

type Tab = "options" | "providers" | "activity";
const PAGE = 25;

async function site(): Promise<string> {
  const env = process.env.AUTH_URL || process.env.APP_URL;
  if (env) return env.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function SignInAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("signin.manage")) notFound();
  const t = await getTranslations("sso.admin");
  const prefs = await formatPrefs(ctx);
  const tab: Tab = sp.tab === "providers" || sp.tab === "activity" ? sp.tab : "options";
  const policy = await loadPolicy(ctx.orgId);
  const base = await site();

  const status: Record<string, MethodStatus> = {};
  for (const m of SIGN_IN_METHODS) {
    const missing = missingEnv(m);
    status[m] = missing.length
      ? { state: "server", missing }
      : m === "classlink" && !policy.classlinkTenantId
        ? { state: "tenant", missing: [] }
        : m === "clever" && !policy.cleverDistrictId
          ? { state: "tenant", missing: [] }
          : m === "oidc" && !oidcReady(policy)
            ? { state: "provider", missing: [] }
            : { state: "ready", missing: [] };
  }

  const [linkCounts, recentLinks] = await Promise.all([
    ctx.db.ssoIdentity.groupBy({ by: ["provider"], _count: { _all: true } }),
    tab === "activity" ? ctx.db.ssoIdentity.findMany({ orderBy: { createdAt: "desc" }, take: 12 }) : Promise.resolve([]),
  ]);

  return (
    <PageBody className="max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <AccessTabs
        current={tab}
        label={t("title")}
        tabs={[
          { value: "options", label: t("tabs.options"), href: "/admin/sign-in" },
          { value: "providers", label: t("tabs.providers"), href: "/admin/sign-in?tab=providers" },
          { value: "activity", label: t("tabs.activity"), href: "/admin/sign-in?tab=activity" },
        ]}
      />
      {tab !== "activity" && (
        <Panel padded={false}>
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
            <ShieldCheck className="size-5 shrink-0 text-brand" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">{t("pageAddress")}</p>
              <p className="text-xs text-muted-foreground">{t("pageAddressBody")}</p>
            </div>
            <div className="w-full sm:max-w-xs">
              <CopyValue value={`${base}/login/${ctx.org.slug}`} testId="school-login-url" />
            </div>
          </div>
        </Panel>
      )}
      {tab !== "activity" ? (
        <SignInSettingsForm
          tab={tab}
          slug={ctx.org.slug}
          status={status}
          urls={{
            classlinkCallback: `${base}/api/sso/classlink/callback`,
            classlinkLaunch: `${base}/api/sso/classlink/start`,
            cleverCallback: `${base}/api/sso/clever/callback`,
            uaepassCallback: `${base}/api/sso/uaepass/callback`,
            oidcCallback: `${base}/api/sso/oidc/callback`,
            googleCallback: `${base}/api/auth/callback/google`,
            microsoftCallback: `${base}/api/auth/callback/microsoft-entra-id`,
            origin: base,
          }}
          uaePassEnv={uaePassEnvironment()}
          initial={{
            methods: policy.methods,
            staffSsoRequired: policy.staffSsoRequired,
            allowedDomains: policy.allowedDomains,
            matchBy: policy.matchBy,
            selfJoinDomains: policy.selfJoinDomains,
            selfJoinApproval: policy.selfJoinApproval,
            classlinkTenantId: policy.classlinkTenantId ?? "",
            cleverDistrictId: policy.cleverDistrictId ?? "",
            microsoftTenantId: policy.microsoftTenantId ?? "",
            uaePassEidMatch: policy.uaePassEidMatch,
            oidcName: policy.oidcName ?? "",
            oidcIssuer: policy.oidcIssuer ?? "",
            oidcClientId: policy.oidcClientId ?? "",
            oidcSecret: "",
            oidcScopes: policy.oidcScopes,
            oidcEmailClaim: policy.oidcEmailClaim,
            oidcIdClaim: policy.oidcIdClaim,
            oidcNameClaim: policy.oidcNameClaim,
            oidcTrustEmail: policy.oidcTrustEmail,
          }}
          hasOidcSecret={!!policy.oidcSecretEnc}
        />
      ) : (
        await activity()
      )}
    </PageBody>
  );

  async function activity() {
    const page = Math.max(1, Math.min(500, Number(sp.page) || 1));
    const where = { action: { in: ["auth.sign_in", "auth.sign_in_refused", "auth.sso_linked", "auth.magic_link_sent", "auth.password_reset", "auth.sso_unlinked", "join.sso_self_join"] } };
    const [events, total] = await Promise.all([
      ctx.db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, select: { id: true, action: true, actorId: true, entityId: true, meta: true, createdAt: true } }),
      ctx.db.auditEvent.count({ where }),
    ]);
    const ids = [...new Set([...events.map((e) => e.actorId ?? e.entityId), ...recentLinks.map((l) => l.membershipId)].filter((x): x is string => !!x))];
    const members = ids.length ? await ctx.db.membership.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { nameEn: true, nameAr: true } } } }) : [];
    const nameOf = (id: string | null) => userName(members.find((m) => m.id === id)?.user, ctx.locale) || t("activity.unknown");
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const methodLabel = (m: unknown) => (typeof m === "string" && (SIGN_IN_METHODS as readonly string[]).includes(m) ? t(`methods.${m}.name`) : t("activity.unknownMethod"));
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] [&>*]:min-w-0">
        <Panel padded={false}>
          <div className="border-b px-5 py-3">
            <PanelHeader title={t("activity.title")} description={t("activity.body")} icon={<Activity className="size-4" />} />
          </div>
          {events.length === 0 ? (
            <EmptyState icon={<Activity className="size-5" />} title={t("activity.empty")} body={t("activity.emptyBody")} className="py-10" />
          ) : (
            <ul className="divide-y" data-testid="signin-activity">
              {events.map((e) => {
                const meta = (e.meta ?? {}) as { method?: string; code?: string; linkedVia?: string };
                const ok = e.action !== "auth.sign_in_refused";
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                    {meta.method && (SIGN_IN_METHODS as readonly string[]).includes(meta.method) ? <MethodMark method={meta.method as (typeof SIGN_IN_METHODS)[number]} className="size-4 shrink-0" /> : <span className="size-4" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{e.actorId || e.entityId ? nameOf(e.actorId ?? e.entityId) : t("activity.unknown")}</span>
                    <Pill tone={ok ? (e.action === "auth.sign_in" ? "success" : "info") : "danger"} dot>
                      {t(`activity.actions.${e.action.replace(".", "_")}`)}
                    </Pill>
                    <span className="text-xs text-muted-foreground">{methodLabel(meta.method)}</span>
                    {!ok && meta.code && <span className="text-xs text-danger">{t.has(`activity.codes.${meta.code}`) ? t(`activity.codes.${meta.code}`) : meta.code}</span>}
                    <span className="w-full text-xs text-muted-foreground sm:w-auto">{fmtDateTime(prefs, e.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t px-5 py-3 text-sm">
              <span className="text-xs text-muted-foreground">{t("activity.pageOf", { page: fmtNumber(prefs, page), pages: fmtNumber(prefs, pages) })}</span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={`/admin/sign-in?tab=activity&page=${page - 1}`} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted">
                    {t("activity.newer")}
                  </Link>
                )}
                {page < pages && (
                  <Link href={`/admin/sign-in?tab=activity&page=${page + 1}`} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted" data-testid="activity-older">
                    {t("activity.older")}
                  </Link>
                )}
              </div>
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("linked.title")} description={t("linked.body")} icon={<Link2 className="size-4" />} />
          {linkCounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("linked.none")}</p>
          ) : (
            <ul className="mb-4 space-y-2">
              {linkCounts.map((c) => (
                <li key={c.provider} className="flex items-center gap-2 text-sm">
                  {(SIGN_IN_METHODS as readonly string[]).includes(c.provider) && <MethodMark method={c.provider as (typeof SIGN_IN_METHODS)[number]} className="size-4" />}
                  <span className="flex-1">{methodLabel(c.provider)}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtNumber(prefs, c._count._all)}</span>
                </li>
              ))}
            </ul>
          )}
          {recentLinks.length > 0 && (
            <>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t("linked.recent")}</p>
              <ul className="divide-y rounded-lg border">
                {recentLinks.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <MethodMark method={l.provider as (typeof SIGN_IN_METHODS)[number]} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{nameOf(l.membershipId)}</span>
                    <UnlinkButton id={l.id} name={nameOf(l.membershipId)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    );
  }
}
