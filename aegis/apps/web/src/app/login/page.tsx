import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { env } from "@aegis/core";

/** Rendered per request: whether demo sign-in is offered comes from the running environment, not the build. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

/** Known sign-in problems, in plain words. Anything else shows a generic line: the URL is never echoed. */
const ERRORS: Record<string, string> = {
  mfa_locked: "Too many wrong authenticator codes. Sign in again to get a new set of attempts.",
  sso_failed: "Single sign-on did not complete. Try again, or sign in with your password.",
  sso_not_member: "Your account exists but is not a member of that organization. Ask one of its administrators to invite you.",
  sso_disabled: "Single sign-on is not turned on for that organization.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const demo = env().AEGIS_DEMO_MODE;
  const { next, error } = await searchParams;
  const errorText = error ? (ERRORS[error] ?? "Sign-in did not complete. Try again.") : null;
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
        {errorText ? (
          <p role="alert" className="mb-4 rounded-md border border-deny/30 bg-deny/10 px-3 py-2 text-sm text-fg">
            {errorText}
          </p>
        ) : null}
        <LoginForm demo={demo} next={next} />
        <form action="/sso/start" method="get" className="mt-4 rounded-panel border border-line bg-bg-elev p-4" aria-label="Sign in with single sign-on">
          <label htmlFor="sso-org" className="mb-1 block text-xs font-medium text-fg-muted">
            Single sign-on: your organization&apos;s short name
          </label>
          <div className="flex gap-2">
            <input id="sso-org" name="org" required pattern="[a-z0-9][a-z0-9-]{1,62}" placeholder="for example meridian" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-accent" />
            <button type="submit" className="h-9 shrink-0 rounded-md border border-line-strong px-3 text-sm text-fg hover:bg-bg-elev-2">
              Continue
            </button>
          </div>
        </form>
        <p className="mt-4 text-center text-[11px] text-fg-dim">Tamper-evident evidence. Signals, not guarantees.</p>
      </div>
    </main>
  );
}
