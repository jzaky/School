import type { Metadata } from "next";
import { HomePage, homeMetadata } from "@/components/marketing/home";

export const metadata: Metadata = { ...homeMetadata, alternates: { canonical: "/" } };

export default function SiteHome() {
  return <HomePage />;
}
