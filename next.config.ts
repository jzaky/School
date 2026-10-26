import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Version skew protection across deploys (set from the commit in the Dockerfile).
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
  serverExternalPackages: ["pdfkit", "fontkit", "bullmq", "ioredis", "@prisma/client", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // Horizon does not use next/image, so the image optimizer is switched off (no /_next/image processing).
  images: { unoptimized: true },
  async headers() {
    return [
      // Browser security headers on every response; the content security policy is set per request in src/middleware.ts.
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
      // The service worker must never be served stale, or a fix to it would take a day to reach phones.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default withNextIntl(nextConfig);
