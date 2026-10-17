import type { MetadataRoute } from "next";
import { SITE_URL } from "@/components/marketing/primitives";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/site/"], disallow: ["/login", "/mfa", "/overview", "/agents", "/platform", "/account", "/org", "/integrations", "/invite", "/sso"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
