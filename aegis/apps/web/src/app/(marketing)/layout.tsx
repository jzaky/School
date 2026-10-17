import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./marketing.css";
import { MarketingShell } from "@/components/marketing/shell";
import { SITE_URL } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "AEGIS by Nexus AI Assurance", template: "%s | AEGIS by Nexus AI Assurance" },
  description: "Enterprise AI governance, authorization, security and assurance. Define what your AI agents may do, enforce it before execution and prove what happened.",
  openGraph: { type: "website", siteName: "AEGIS by Nexus AI Assurance", images: [{ url: "/assets/og.svg", width: 1200, height: 630, alt: "AEGIS: define, enforce, prove" }] },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
