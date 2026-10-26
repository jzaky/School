// Starts a single sign-on: /api/sso/{classlink|clever|uaepass|oidc}/start?school=<slug>&locale=en&next=/en/home
// ClassLink LaunchPad and Clever portal tiles can point here without a school: the school is then found from the
// person's tenant or district after they sign in.
import { NextResponse, type NextRequest } from "next/server";
import { beginSso, FLOW_COOKIE } from "@/server/sso/flow";
import { loadPolicy, methodAvailable } from "@/server/sso/policy";
import { isFlowProvider, providerConfig, ProviderError } from "@/server/sso/providers";
import { schoolBySlug } from "@/server/platform/sso-lookup";
import { callbackPath, flowCookieOptions, localeOf, loginPath, safeReturnTo, siteUrl } from "@/server/sso/web";
import { hit, clientIp } from "@/server/access/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const sp = req.nextUrl.searchParams;
  const slug = sp.get("school");
  const back = (code: string) => NextResponse.redirect(new URL(loginPath(slug, code), req.url), 303);
  if (!isFlowProvider(provider)) return back("SSO_UNKNOWN");
  if (!(await hit(`sso-start:${clientIp(req.headers)}`, 60, 10 * 60)).ok) return back("RATE_LIMITED");
  const site = siteUrl(req.url);
  if (!site) return back("SSO_NOT_CONFIGURED");

  let orgId: string | null = null;
  let policy = null;
  if (slug) {
    const school = await schoolBySlug(slug);
    if (!school) return back("SSO_NO_SCHOOL");
    orgId = school.id;
    policy = await loadPolicy(orgId);
    if (!methodAvailable(policy, provider)) return back("METHOD_OFF");
  } else if (provider === "uaepass" || provider === "oidc") {
    // These need the school's settings (Emirates ID matching, the school's own provider).
    return back("SSO_NO_SCHOOL");
  }

  let cfg;
  try {
    cfg = await providerConfig(provider, policy);
  } catch (e) {
    return back(e instanceof ProviderError ? `SSO_${e.code}` : "SSO_NOT_CONFIGURED");
  }
  const locale = localeOf(sp.get("locale"));
  const extra: Record<string, string> = {};
  if (provider === "clever" && policy?.cleverDistrictId) extra.district_id = policy.cleverDistrictId;
  if (provider === "uaepass") extra.ui_locales = locale;
  const { url, cookie } = beginSso(cfg, { orgId, locale, returnTo: safeReturnTo(sp.get("next"), locale), redirectUri: `${site}${callbackPath(provider)}`, extraParams: extra });
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(FLOW_COOKIE, cookie, flowCookieOptions(site.startsWith("https://")));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
