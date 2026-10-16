import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AEGIS by Nexus AI Assurance", template: "%s | AEGIS by Nexus AI Assurance" },
  description: "Enterprise AI governance, authorization, security and assurance.",
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("aegis-theme")||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t;document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The per-request nonce from the middleware; the Content-Security-Policy refuses inline scripts without it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Applies the saved console theme before first paint, so there is no flash. Dark is the default. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
