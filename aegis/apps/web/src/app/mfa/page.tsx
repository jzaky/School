import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { logoutAction } from "@/server/actions/auth";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-factor authentication" };
export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.user.mfaEnabled || s.mfaPassed) redirect("/overview");
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 font-semibold text-accent">A</div>
          <div>
            <div className="text-lg font-semibold tracking-tight">Two-factor authentication</div>
            <div className="text-xs text-fg-muted">Signed in as {s.user.email}</div>
          </div>
        </div>
        <MfaForm />
        <form action={logoutAction} className="mt-3 text-center">
          <button type="submit" className="text-xs text-fg-muted hover:text-fg">
            Use a different account
          </button>
        </form>
      </div>
    </main>
  );
}
