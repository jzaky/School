import { NextResponse, type NextRequest } from "next/server";
import { beginSsoLogin, env, isAegisError } from "@aegis/core";

/** Starts the OpenID Connect flow for an organization. The PKCE verifier travels in a short-lived HttpOnly cookie. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const redirectUri = `${env().WEB_PUBLIC_URL}/sso/callback`;
  try {
    const { url, verifier } = await beginSsoLogin(slug, redirectUri);
    const res = NextResponse.redirect(url);
    res.cookies.set("aegis_sso_verifier", verifier, { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/sso", maxAge: 600 });
    return res;
  } catch (e) {
    const message = isAegisError(e) ? e.message : "Single sign-on is unavailable";
    return NextResponse.redirect(`${env().WEB_PUBLIC_URL}/login?error=${/not enabled/.test(message) ? "sso_disabled" : "sso_failed"}`);
  }
}
