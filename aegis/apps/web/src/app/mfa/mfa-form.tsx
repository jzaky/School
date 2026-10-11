"use client";
import { useActionState } from "react";
import { mfaAction, type ActionState } from "@/server/actions/auth";

export function MfaForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(mfaAction, {});
  return (
    <form action={action} className="space-y-4 rounded-panel border border-line bg-bg-elev p-6">
      <div>
        <label htmlFor="code" className="mb-1 block text-xs font-medium text-fg-muted">
          Authenticator code
        </label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className="h-10 w-full rounded-md border border-line bg-bg px-3 text-center font-mono text-lg tracking-[0.4em] text-fg outline-none focus:border-accent" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-deny">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="h-9 w-full rounded-md bg-accent text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong disabled:opacity-60">
        {pending ? "Verifying" : "Continue"}
      </button>
    </form>
  );
}
