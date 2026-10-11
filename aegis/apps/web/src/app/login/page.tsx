import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { env } from "@aegis/core";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const demo = env().AEGIS_DEMO_MODE;
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 font-semibold text-accent">A</div>
          <div>
            <div className="text-lg font-semibold tracking-tight">AEGIS</div>
            <div className="text-xs text-fg-muted">AI governance console</div>
          </div>
        </div>
        <LoginForm demo={demo} next={next} />
        <p className="mt-4 text-center text-[11px] text-fg-dim">Tamper-evident evidence. Signals, not guarantees.</p>
      </div>
    </main>
  );
}
