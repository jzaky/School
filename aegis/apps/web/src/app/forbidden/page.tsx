import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PERMISSIONS } from "@aegis/core";

export const metadata: Metadata = { title: "Access denied" };

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const { need } = await searchParams;
  const description = need && need in PERMISSIONS ? PERMISSIONS[need as keyof typeof PERMISSIONS] : need === "platform_admin" ? "Platform administrator access" : null;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-panel border border-line bg-bg-elev p-6">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-deny/10 text-deny">
          <ShieldAlert className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="mt-3 text-base font-semibold text-fg">Access denied</h1>
        <p className="mt-1 text-sm text-fg-muted">Your role does not include the permission this page needs.</p>
        {need ? (
          <div className="mt-3 rounded-md border border-line bg-bg px-3 py-2">
            <div className="font-mono text-xs text-fg">{need}</div>
            {description ? <div className="mt-0.5 text-xs text-fg-muted">{description}</div> : null}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-fg-dim">Ask an Owner or Administrator to assign a role that includes it.</p>
        <Link href="/overview" className="mt-5 inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong">
          Back to Command Center
        </Link>
      </div>
    </main>
  );
}
