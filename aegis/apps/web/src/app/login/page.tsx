import { LoginForm } from "./login-form";
import { env } from "@aegis/core";

export default function LoginPage() {
  const demo = env().AEGIS_DEMO_MODE;
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-accent/15 grid place-items-center text-accent font-semibold">A</div>
          <div>
            <div className="text-lg font-semibold tracking-tight">AEGIS</div>
            <div className="text-xs text-fg-muted">AI governance console</div>
          </div>
        </div>
        <LoginForm demo={demo} />
      </div>
    </main>
  );
}
