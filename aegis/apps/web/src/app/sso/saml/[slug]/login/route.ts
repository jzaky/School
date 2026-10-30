import { NextResponse, type NextRequest } from "next/server";
import { beginSamlLogin, env, isAegisError, SAML_NONCE_COOKIE } from "@aegis/core";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { url, nonce } = await beginSamlLogin(slug);
    const res = NextResponse.redirect(url);
    // The identity provider posts back cross-site, so the cookie must be SameSite=None (and therefore Secure).
    // Without HTTPS (local development) it falls back to Lax, which a cross-site POST does not carry.
    const secure = env().WEB_PUBLIC_URL.startsWith("https://");
    res.cookies.set(SAML_NONCE_COOKIE, nonce, { httpOnly: true, secure, sameSite: secure ? "none" : "lax", path: "/sso/saml", maxAge: 600 });
    return res;
  } catch (e) {
    const code = isAegisError(e) && /not enabled|does not sign in/.test(e.message) ? "sso_disabled" : "sso_failed";
    return NextResponse.redirect(`${env().WEB_PUBLIC_URL}/login?error=${code}`);
  }
}
