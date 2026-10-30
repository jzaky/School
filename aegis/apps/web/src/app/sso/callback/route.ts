import { NextResponse, type NextRequest } from "next/server";
import { completeSsoLogin, env, isAegisError, SESSION_COOKIE } from "@aegis/core";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const verifier = req.cookies.get("aegis_sso_verifier")?.value;
  const base = env().WEB_PUBLIC_URL;
  if (!code || !state || !verifier) return NextResponse.redirect(`${base}/login?error=sso_failed`);
  try {
    const r = await completeSsoLogin({ code, state, verifier, ip: req.headers.get("x-forwarded-for") ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined });
    const res = NextResponse.redirect(`${base}${r.mfaRequired ? "/mfa" : "/overview"}`);
    res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/" });
    res.cookies.delete("aegis_sso_verifier");
    return res;
  } catch (e) {
    // Error codes only: the login page maps them to plain words and never echoes the URL.
    const code = isAegisError(e) && /invite/.test(e.message) ? "sso_not_member" : isAegisError(e) && /not enabled/.test(e.message) ? "sso_disabled" : "sso_failed";
    return NextResponse.redirect(`${base}/login?error=${code}`);
  }
}
