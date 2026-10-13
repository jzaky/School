import { NextResponse, type NextRequest } from "next/server";
import { env, ssoProtocolForOrg } from "@aegis/core";

/** One sign-in link per organization: sends people to OpenID Connect or SAML, whichever is configured. */
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get("org") ?? "").trim().toLowerCase();
  const base = env().WEB_PUBLIC_URL;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return NextResponse.redirect(`${base}/login?error=sso_failed`);
  const protocol = await ssoProtocolForOrg(slug);
  if (!protocol) return NextResponse.redirect(`${base}/login?error=sso_disabled`);
  return NextResponse.redirect(protocol === "saml" ? `${base}/sso/saml/${slug}/login` : `${base}/sso/${slug}`);
}
