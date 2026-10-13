import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/mfa", "/_next", "/favicon", "/api/public", "/site", "/assets", "/no-organization", "/forbidden", "/invite", "/robots.txt", "/sitemap.xml", "/sso"];

/** Edge check only: is there a session cookie? Real validation happens in server components. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
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
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
