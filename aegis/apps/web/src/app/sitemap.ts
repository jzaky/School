import type { MetadataRoute } from "next";
import { SITE_URL } from "@/components/marketing/primitives";

const PATHS = ["/", "/site/products", "/site/tour", "/site/architecture", "/site/security", "/site/open-source", "/site/pricing", "/site/contact", "/site/demo", "/site/pilot", "/site/privacy", "/site/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PATHS.map((p) => ({ url: `${SITE_URL}${p}`, lastModified: now, changeFrequency: p === "/" ? "weekly" : "monthly", priority: p === "/" ? 1 : 0.7 }));
}
