import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { contentSecurityPolicy, newNonce } from "./lib/security-headers";

const intl = createMiddleware(routing);

// Only the product lives under a locale prefix. The marketing site (/, /demo, /login) reads the locale cookie.
const LOCALE_PATH = /^\/(en|ar)(\/|$)/;

/**
 * Every page gets a content security policy with a fresh nonce. Next.js reads the policy from the request
 * headers and puts the nonce on its own scripts; pages are rendered per request, so each response has its own.
 */
export default function middleware(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = LOCALE_PATH.test(request.nextUrl.pathname) ? intl(new NextRequest(request, { headers })) : NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Pages only: API routes, build assets and public files (icons, service worker, manifest) are left out.
  matcher: ["/((?!api/|_next/static|_next/image|favicon\\.ico|sw\\.js|offline\\.html|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml|woff2?)$).*)"],
};
