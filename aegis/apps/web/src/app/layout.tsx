import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AEGIS", template: "%s | AEGIS" },
  description: "Enterprise AI governance, authorization, security and assurance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
