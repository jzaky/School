import type { Metadata } from "next";
import "./(marketing)/marketing.css";
import { MarketingShell } from "@/components/marketing/shell";
import { HomePage, homeMetadata } from "@/components/marketing/home";

export const metadata: Metadata = homeMetadata;

export default function RootHome() {
  return (
    <MarketingShell>
      <HomePage />
    </MarketingShell>
  );
}
