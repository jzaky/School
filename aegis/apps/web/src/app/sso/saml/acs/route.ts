import { NextResponse, type NextRequest } from "next/server";
import { completeSamlLogin, env, isAegisError, SAML_NONCE_COOKIE, SESSION_COOKIE } from "@aegis/core";

/** Assertion consumer service: the identity provider posts the signed SAML response here. */
export async function POST(req: NextRequest) {
  const base = env().WEB_PUBLIC_URL;
  const form = await req.formData();
  const samlResponse = form.get("SAMLResponse");
  const relayState = form.get("RelayState");
  if (typeof samlResponse !== "string" || typeof relayState !== "string") return NextResponse.redirect(`${base}/login?error=sso_failed`, 303);
  try {
    const r = await completeSamlLogin({ samlResponse, relayState, browserNonce: req.cookies.get(SAML_NONCE_COOKIE)?.value, ip: req.headers.get("x-forwarded-for") ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined });
    const res = NextResponse.redirect(`${base}${r.mfaRequired ? "/mfa" : "/overview"}`, 303);
    res.cookies.delete({ name: SAML_NONCE_COOKIE, path: "/sso/saml" });
    res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/" });
    return res;
  } catch (e) {
    const code = isAegisError(e) && /already exists|invite/.test(e.message) ? "sso_not_member" : "sso_failed";
    return NextResponse.redirect(`${base}/login?error=${code}`, 303);
  }
}
