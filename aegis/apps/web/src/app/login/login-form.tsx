"use client";
import { useActionState } from "react";
import { loginAction, type ActionState } from "@/server/actions/auth";

export function LoginForm({ demo, next }: { demo: boolean; next?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4 rounded-panel border border-line bg-bg-elev p-6">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div>
        <label htmlFor="email" className="mb-1 block text-xs font-medium text-fg-muted">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={demo ? "nadia.haddad@meridian-demo.example" : ""} className="h-9 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg outline-none transition-colors duration-150 focus:border-accent" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs font-medium text-fg-muted">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo ? "AegisDemo2026!" : ""} className="h-9 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg outline-none transition-colors duration-150 focus:border-accent" />
      </div>
      {state.error ? (
        <p role="alert" className="rounded-md border border-deny/30 bg-deny/10 px-3 py-2 text-xs text-deny">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="h-9 w-full rounded-md bg-accent text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong disabled:opacity-60">
        {pending ? "Signing in" : "Sign in"}
      </button>
      {demo ? <p className="text-xs text-fg-dim">Demo mode: credentials are prefilled for the synthetic Meridian Gulf Bank tenant.</p> : null}
    </form>
  );
}
