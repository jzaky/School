"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { beginMfaAction, changePasswordAction, confirmMfaAction, disableMfaAction, revokeSessionAction, signOutEverywhereAction } from "@/server/actions/account";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { DateTime, TimeAgo } from "@/components/ui/time";

export function ChangePasswordForm() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await changePasswordAction({ current, next, confirm });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Password changed. Other sessions were signed out.");
        setCurrent("");
        setNext("");
        setConfirm("");
      }}
    >
      <Field label="Current password" htmlFor="pw-current">
        <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="New password" htmlFor="pw-next" hint="12+ characters with letters, digits and symbols">
        <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
      </Field>
      <Field label="Confirm new password" htmlFor="pw-confirm" error={confirm && confirm !== next ? "Passwords do not match" : null}>
        <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={!current || !next || next !== confirm}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function MfaPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [enrol, setEnrol] = React.useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [disableCode, setDisableCode] = React.useState("");

  if (enabled) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-allow" aria-hidden />
          <span className="text-sm">Two-factor authentication is on.</span>
          <Badge tone="allow">Enabled</Badge>
        </div>
        <p className="text-xs text-fg-muted">A code from your authenticator app is required at every sign-in.</p>
        <Dialog
          open={disableOpen}
          onOpenChange={(o) => {
            setDisableOpen(o);
            if (!o) {
              setDisableCode("");
              setError(null);
            }
          }}
          trigger={
            <Button variant="danger">
              <ShieldOff className="h-3.5 w-3.5" aria-hidden />
              Disable MFA
            </Button>
          }
          title="Disable two-factor authentication"
          description="Enter a current code from your authenticator to confirm. Your account will then be protected by the password alone."
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDisableOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button form="mfa-disable-form" type="submit" variant="danger" loading={pending} disabled={disableCode.replace(/\s/g, "").length !== 6}>
                Disable MFA
              </Button>
            </>
          }
        >
          <form
            id="mfa-disable-form"
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(null);
              const r = await disableMfaAction(disableCode);
              setPending(false);
              if (!r.ok) return setError(r.error);
              toast.success("MFA disabled");
              setDisableOpen(false);
              router.refresh();
            }}
          >
            <Field label="Authenticator code" htmlFor="mfa-disable-code">
              <Input id="mfa-disable-code" inputMode="numeric" autoComplete="one-time-code" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} maxLength={6} className="w-40 font-mono tracking-widest" autoFocus />
            </Field>
            <FormError error={error} />
          </form>
        </Dialog>
      </div>
    );
  }

  if (!enrol) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldOff className="h-4 w-4 text-fg-dim" aria-hidden />
          <span className="text-sm">Two-factor authentication is off.</span>
          <Badge>Disabled</Badge>
        </div>
        <p className="text-xs text-fg-muted">Use any TOTP authenticator app. Enrolment takes under a minute.</p>
        <Button
          variant="primary"
          loading={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            const r = await beginMfaAction();
            setPending(false);
            if (!r.ok) return setError(r.error);
            setEnrol(r.data);
          }}
        >
          Set up MFA
        </Button>
        <FormError error={error} />
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await confirmMfaAction(code);
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("MFA enabled");
        setEnrol(null);
        setCode("");
        router.refresh();
      }}
    >
      <ol className="list-decimal space-y-1 ps-5 text-sm text-fg-muted">
        <li>Scan the QR code with your authenticator app, or enter the secret manually.</li>
        <li>Enter the six-digit code the app shows to finish.</li>
      </ol>
      <div className="flex flex-wrap items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrol.qr} alt="MFA enrolment QR code" width={180} height={180} className="rounded-md border border-line" />
        <div className="min-w-0 flex-1 space-y-2">
          <CodeBlock code={enrol.secret} wrap label="Secret" />
          <Field label="Six-digit code" htmlFor="mfa-code">
            <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} className="w-40 font-mono tracking-widest" required />
          </Field>
        </div>
      </div>
      <FormError error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setEnrol(null)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending} disabled={code.replace(/\s/g, "").length !== 6}>
          Confirm and enable
        </Button>
      </div>
    </form>
  );
}

export interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmAll, setConfirmAll] = React.useState(false);
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-md border border-line">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="truncate">{describeAgent(s.userAgent)}</span>
                {s.current ? <Badge tone="allow">This session</Badge> : null}
              </div>
              <div className="text-xs text-fg-muted">
                {s.ip ?? "unknown address"} · active <TimeAgo value={s.lastSeenAt} /> · signed in <DateTime value={s.createdAt} />
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-deny"
              loading={busy === s.id}
              onClick={async () => {
                setBusy(s.id);
                const r = await revokeSessionAction(s.id);
                setBusy(null);
                if (!r.ok) return toast.error(r.error);
                if (r.data.current) window.location.href = "/login";
                else {
                  toast.success("Session revoked");
                  router.refresh();
                }
              }}
            >
              {s.current ? "Sign out" : "Revoke"}
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="danger" disabled={others === 0} disabledReason="No other active sessions" onClick={() => setConfirmAll(true)}>
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        Sign out everywhere else
      </Button>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out everywhere else"
        description={`${others} other session${others === 1 ? "" : "s"} will be revoked. This session stays signed in.`}
        confirmLabel="Sign out other sessions"
        danger
        onConfirm={async () => {
          const r = await signOutEverywhereAction();
          if (!r.ok) return r.error;
          toast.success("Other sessions signed out");
          router.refresh();
        }}
      />
    </div>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown client";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "unknown OS";
  return `${browser} on ${os}`;
}
