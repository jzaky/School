import type { Metadata } from "next";
import { listSessions } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ChangePasswordForm, MfaPanel, SessionsList } from "@/components/account/security";

export const metadata: Metadata = { title: "Account and security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const c = await getConsoleContext();
  const sessions = await listSessions(c.session.user.id);
  return (
    <div>
      <PageHeader title="Account and security" description={`${c.session.user.name} · ${c.session.user.email}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Password" description="Changing it signs out every other session">
          <ChangePasswordForm />
        </Panel>
        <Panel title="Two-factor authentication" description="Time-based one-time codes">
          <MfaPanel enabled={c.session.user.mfaEnabled} />
        </Panel>
        <Panel title="Active sessions" description="Sessions expire after 12 hours or 2 hours idle" className="lg:col-span-2">
          <SessionsList sessions={sessions.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), expiresAt: s.expiresAt.toISOString(), current: s.id === c.session.id }))} />
        </Panel>
      </div>
    </div>
  );
}
