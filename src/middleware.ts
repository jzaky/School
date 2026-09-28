import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

// Only the product lives under a locale prefix. The marketing site (/, /demo, /login) reads the locale cookie.
export const config = {
  matcher: ["/(en|ar)/:path*"],
};
