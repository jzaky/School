import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MailCheck, MailX } from "lucide-react";
import { acceptInvitation, isAegisError, setSessionOrg } from "@aegis/core";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await getSession();
  const safeToken = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
  if (!s) {
    return (
      <Shell icon="ok" title="You have been invited">
        <p className="text-sm text-fg-muted">Sign in with the email address the invitation was sent to. You will be added to the organization right after.</p>
        <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="mt-5 inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong">
          Sign in to accept
        </Link>
      </Shell>
    );
  }
  if (s.user.mfaEnabled && !s.mfaPassed) redirect("/mfa");
  let error: string | null = null;
  if (!safeToken) error = "This invitation link is malformed.";
  else {
    try {
      const r = await acceptInvitation(safeToken, s.user.id);
      await setSessionOrg(s.id, r.orgId);
    } catch (e) {
      error = isAegisError(e) ? (e.code === "not_found" ? "This invitation is invalid, expired or already used." : e.message) : "The invitation could not be accepted.";
    }
  }
  if (!error) redirect("/overview");
  return (
    <Shell icon="bad" title="Invitation not accepted">
      <p className="text-sm text-fg-muted">{error}</p>
      <p className="mt-2 text-xs text-fg-dim">Signed in as {s.user.email}. Ask the organization administrator for a new link if needed.</p>
      <Link href="/overview" className="mt-5 inline-flex h-8 items-center rounded-md border border-line-strong bg-bg-elev px-3 text-sm text-fg transition-colors duration-150 hover:bg-bg-elev-2">
        Continue to console
      </Link>
    </Shell>
  );
}

function Shell({ icon, title, children }: { icon: "ok" | "bad"; title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-panel border border-line bg-bg-elev p-6">
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${icon === "ok" ? "bg-accent/15 text-accent" : "bg-deny/10 text-deny"}`}>{icon === "ok" ? <MailCheck className="h-5 w-5" aria-hidden /> : <MailX className="h-5 w-5" aria-hidden />}</div>
        <h1 className="mt-3 text-base font-semibold text-fg">{title}</h1>
        <div className="mt-1">{children}</div>
      </div>
    </main>
  );
}
