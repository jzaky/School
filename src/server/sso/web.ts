// Small helpers shared by the single sign-on routes and pages: the site address used in redirect URIs, the
// allowlist for where a person may land after signing in, and the flow cookie options.

/** The public site address. Redirect URIs are always built from configuration, never from request headers. */
export function siteUrl(requestUrl?: string): string | null {
  const env = process.env.AUTH_URL || process.env.APP_URL;
  if (env) return env.replace(/\/+$/, "");
  // Local development only: fall back to the address the browser used.
  if (process.env.NODE_ENV !== "production" && requestUrl) return new URL(requestUrl).origin;
  return null;
}

export const callbackPath = (provider: string) => `/api/sso/${provider}/callback`;

/**
 * Where a person may go after signing in: a product page under /en or /ar, or a join link. Anything else (other
 * hosts, protocol-relative URLs, backslashes, encoded tricks) falls back to the home page.
 */
export function safeReturnTo(raw: string | null | undefined, locale: "en" | "ar"): string {
  const fallback = `/${locale}/home`;
  if (!raw || raw.length > 300) return fallback;
  if (!/^\/(en|ar)(\/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9_\-=&%.]*)?$/.test(raw)) return fallback;
  if (raw.includes("//") || raw.includes("\\") || /%2f|%5c/i.test(raw)) return fallback;
  return raw;
}

export const localeOf = (v: string | null | undefined): "en" | "ar" => (v === "ar" ? "ar" : "en");

export function flowCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/api/sso", maxAge: 600 };
}

/** The remembered school for the sign-in page (a hint only: it never grants anything). */
export const SCHOOL_HINT_COOKIE = "login_school";

export function loginPath(slug: string | null | undefined, error?: string | null): string {
  const base = slug ? `/login/${encodeURIComponent(slug)}` : "/login";
  return error ? `${base}?error=${encodeURIComponent(error)}` : base;
}
