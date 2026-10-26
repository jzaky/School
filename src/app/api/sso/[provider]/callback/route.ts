// Finishes a single sign-on: checks the flow (state, nonce, PKCE, ID token), decides who the person is in which
// school (src/server/sso/link.ts), then opens a fresh session through a one-time ticket. The flow cookie is
// cleared on every outcome. Errors go back to the sign-in page as a code; nothing personal is logged.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { signIn } from "@/auth";
import { completeSso, FlowError, FLOW_COOKIE, readFlow } from "@/server/sso/flow";
import { resolveSignIn } from "@/server/sso/link";
import { loadPolicy } from "@/server/sso/policy";
import { isFlowProvider, providerConfig, ProviderError } from "@/server/sso/providers";
import { issueTicket } from "@/server/sso/ticket";
import { orgForTenant, schoolById } from "@/server/platform/sso-lookup";
import { flowCookieOptions, loginPath, siteUrl } from "@/server/sso/web";
import { clientIp, hit } from "@/server/access/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const sp = req.nextUrl.searchParams;
  const site = siteUrl(req.url) ?? req.nextUrl.origin;
  const cookie = req.cookies.get(FLOW_COOKIE)?.value;
  const flow = readFlow(cookie);
  const slugFor = async (orgId: string | null) => (orgId ? ((await schoolById(orgId))?.slug ?? null) : null);
  const finish = (res: NextResponse) => {
    res.cookies.set(FLOW_COOKIE, "", { ...flowCookieOptions(site.startsWith("https://")), maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  const back = async (code: string) => finish(NextResponse.redirect(new URL(loginPath(await slugFor(flow?.o ?? null), code), site), 303));

  if (!isFlowProvider(provider)) return back("SSO_UNKNOWN");
  if (!(await hit(`sso-callback:${clientIp(req.headers)}`, 60, 10 * 60)).ok) return back("RATE_LIMITED");
  // Sign-ins started from the ClassLink LaunchPad or the Clever portal arrive with a code but no state of ours.
  // We never accept those directly: the flow restarts from our side so state, nonce and the redirect are ours.
  if (!sp.get("state") && sp.get("code") && (provider === "clever" || provider === "classlink")) {
    return finish(NextResponse.redirect(new URL(`/api/sso/${provider}/start`, site), 303));
  }
  if (!flow) return back("SSO_STATE_MISSING");

  let identity;
  try {
    const policy = flow.o ? await loadPolicy(flow.o) : null;
    const cfg = await providerConfig(provider, policy);
    ({ identity } = await completeSso(cfg, { query: sp, cookie }));
  } catch (e) {
    if (e instanceof FlowError) return back(`SSO_${e.code}`);
    if (e instanceof ProviderError) return back(`SSO_${e.code}`);
    console.error(`[sso] ${provider} callback failed: ${(e as { name?: string })?.name ?? "Error"}`);
    return back("SSO_FAILED");
  }

  const orgId = flow.o ?? (provider === "classlink" || provider === "clever" ? await orgForTenant(provider, identity.tenant) : null);
  const outcome = await resolveSignIn(orgId, identity);
  if (!outcome.ok) {
    const slug = await slugFor(outcome.orgId ?? orgId);
    return finish(NextResponse.redirect(new URL(loginPath(slug, outcome.code), site), 303));
  }
  const ticket = await issueTicket({ userId: outcome.userId, orgId: outcome.orgId, membershipId: outcome.membershipId, method: provider });
  const redirectTo = outcome.status === "PENDING_APPROVAL" ? `/${flow.l}/join/waiting` : flow.r;
  // The flow cookie is spent. signIn then sets the new session cookie (a fresh token replaces any earlier one)
  // and throws the redirect, which Next.js turns into the response with both cookie changes.
  (await cookies()).set(FLOW_COOKIE, "", { ...flowCookieOptions(site.startsWith("https://")), maxAge: 0 });
  await signIn("sso", { ticket, redirectTo });
  return back("SSO_FAILED");
}
