// "How people sign in": whether Google and Microsoft sign-in are configured on this server, the exact
// addresses to register with them, and this school's staff email domain rule. Shows only whether settings
// are present and public addresses, never a secret or a client id.
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, CircleDashed, Globe2 } from "lucide-react";
import { Pill } from "@/components/app/badges";
import { CopyValue } from "@/components/integrations/api-keys";

export type ProviderReadiness = { key: "google" | "microsoft"; configured: boolean; missing: string[]; schoolOn: boolean; callbackPath: string };

/** Which provider settings are present on this server (names only). */
export function providerReadiness(org: { googleSignIn: boolean; microsoftSignIn: boolean }, env: NodeJS.ProcessEnv = process.env): ProviderReadiness[] {
  const missing = (names: string[]) => names.filter((n) => !env[n]);
  const google = missing(["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]);
  const microsoft = missing(["AUTH_MICROSOFT_ENTRA_ID_ID", "AUTH_MICROSOFT_ENTRA_ID_SECRET"]);
  return [
    { key: "google", configured: google.length === 0, missing: google, schoolOn: org.googleSignIn, callbackPath: "/api/auth/callback/google" },
    { key: "microsoft", configured: microsoft.length === 0, missing: microsoft, schoolOn: org.microsoftSignIn, callbackPath: "/api/auth/callback/microsoft-entra-id" },
  ];
}

async function siteUrl(): Promise<{ url: string; fromEnv: boolean }> {
  const env = process.env.AUTH_URL || process.env.APP_URL;
  if (env) return { url: env.replace(/\/+$/, ""), fromEnv: true };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { url: `${proto}://${host}`, fromEnv: false };
}

export async function SignInReadiness({ org }: { org: { googleSignIn: boolean; microsoftSignIn: boolean; staffEmailDomains: string[]; staffDomainAutoApprove: boolean } }) {
  const t = await getTranslations("adminInvites.readiness");
  const site = await siteUrl();
  const providers = providerReadiness(org);
  const microsoftIssuer = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="signin-readiness">
      <div className="border-b px-5 py-3">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("body")}</p>
      </div>
      <div className="divide-y">
        {providers.map((p) => (
          <div key={p.key} className="space-y-2 px-5 py-4" data-testid={`readiness-${p.key}`}>
            <div className="flex flex-wrap items-center gap-2">
              {p.configured ? <CheckCircle2 className="size-4 text-success" /> : <CircleDashed className="size-4 text-muted-foreground" />}
              <span className="text-sm font-medium">{t(`${p.key}.name`)}</span>
              <Pill tone={p.configured ? "success" : "neutral"} dot>
                {p.configured ? t("configured") : t("notConfigured")}
              </Pill>
              {p.configured && <Pill tone={p.schoolOn ? "brand" : "neutral"}>{p.schoolOn ? t("schoolOn") : t("schoolOff")}</Pill>}
            </div>
            <p className="text-xs text-muted-foreground">
              {p.configured ? t(`${p.key}.readyBody`) : t("missingBody")}{" "}
              {!p.configured && (
                <span className="font-mono" dir="ltr">
                  {p.missing.join(", ")}
                </span>
              )}
            </p>
            {p.key === "microsoft" && p.configured && !microsoftIssuer && <p className="text-xs text-muted-foreground">{t("microsoft.issuerNote")}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <div className="text-xs text-muted-foreground">{t("redirectUrl")}</div>
                <CopyValue value={`${site.url}${p.callbackPath}`} testId={`redirect-${p.key}`} />
              </div>
              {p.key === "google" && (
                <div className="min-w-0 space-y-1">
                  <div className="text-xs text-muted-foreground">{t("origin")}</div>
                  <CopyValue value={site.url} />
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="space-y-1 px-5 py-4" data-testid="readiness-domain">
          <div className="flex flex-wrap items-center gap-2">
            <Globe2 className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("domainTitle")}</span>
            {org.staffEmailDomains.length ? (
              org.staffEmailDomains.map((d) => (
                <Pill key={d} tone="brand">
                  <span dir="ltr">{`@${d}`}</span>
                </Pill>
              ))
            ) : (
              <Pill>{t("noDomain")}</Pill>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{org.staffEmailDomains.length ? (org.staffDomainAutoApprove ? t("domainAuto") : t("domainApproval")) : t("domainNone")}</p>
        </div>
        {!site.fromEnv && <p className="px-5 py-3 text-xs text-muted-foreground">{t("noSiteUrl")}</p>}
      </div>
    </section>
  );
}
