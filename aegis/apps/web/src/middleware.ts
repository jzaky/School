import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "./lib/csp";

const PUBLIC_PREFIXES = ["/login", "/mfa", "/_next", "/favicon", "/api/public", "/site", "/assets", "/no-organization", "/forbidden", "/invite", "/robots.txt", "/sitemap.xml", "/sso"];

/** Edge check only: is there a session cookie? Real validation happens in server components. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Every page gets a fresh nonce and the policy that requires it. Next.js reads the nonce from the
  // request's Content-Security-Policy header and applies it to its own scripts; the root layout reads
  // x-nonce for the theme script.
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const withCsp = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    return withCsp(NextResponse.next({ request: { headers } }));
  }
  if (!req.cookies.get("aegis_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  // Request headers reach server components and actions: one request id end to end, and the path for
  // checks that depend on where the user is (for example the organization's MFA requirement).
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-aegis-path", pathname);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return withCsp(res);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
