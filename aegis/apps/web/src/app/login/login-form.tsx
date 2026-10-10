"use client";
import { useActionState } from "react";
import { loginAction, type ActionState } from "@/server/actions/auth";

export function LoginForm({ demo }: { demo: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={action} className="rounded-panel border border-line bg-bg-elev p-6 space-y-4">
      <div>
        <label htmlFor="email" className="block text-xs font-medium text-fg-muted mb-1">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={demo ? "nadia.haddad@meridian-demo.example" : ""} className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
      </div>
      <div>
        <label htmlFor="password" className="block text-xs font-medium text-fg-muted mb-1">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo ? "AegisDemo2026!" : ""} className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
      </div>
      {state.error ? <p role="alert" className="text-sm text-deny">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60">
        {pending ? "Signing in" : "Sign in"}
      </button>
      {demo ? <p className="text-xs text-fg-dim">Demo mode: credentials are prefilled for the synthetic Meridian Gulf Bank tenant.</p> : null}
    </form>
  );
}
