import type { Metadata } from "next";
import { listSessions } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { ChangePasswordForm, MfaPanel, SessionsList } from "@/components/account/security";

export const metadata: Metadata = { title: "Account and security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ mfa?: string }> }) {
  const c = await getConsoleContext();
  const { mfa } = await searchParams;
  const mustEnrol = c.org.settings.requireMfa === true && !c.session.user.mfaEnabled;
  const sessions = await listSessions(c.session.user.id);
  return (
    <div>
      <PageHeader title="Account and security" description={`${c.session.user.name} · ${c.session.user.email}`} />
      {mustEnrol ? (
        <div className="mb-4" data-testid="mfa-required">
          <Note tone="warning">{c.org.name} requires two-factor authentication. Turn it on below to use the rest of the console{mfa === "required" ? "; you were brought here because it is not on yet" : ""}.</Note>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Password" description="Changing your password signs you out everywhere else">
          <ChangePasswordForm />
        </Panel>
        <Panel title="Two-factor authentication" description="A one-time code from an authenticator app on your phone, in addition to your password (time-based one-time codes)">
          <MfaPanel enabled={c.session.user.mfaEnabled} />
        </Panel>
        <Panel title="Active sessions" description="Where you are signed in right now. A session ends after 12 hours, or after 2 hours without activity." className="lg:col-span-2">
          <SessionsList sessions={sessions.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), expiresAt: s.expiresAt.toISOString(), current: s.id === c.session.id }))} />
        </Panel>
      </div>
    </div>
  );
}
