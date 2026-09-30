import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Version skew protection across deploys (set from the commit in the Dockerfile).
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
  serverExternalPackages: ["pdfkit", "bullmq", "ioredis", "@prisma/client", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default withNextIntl(nextConfig);
