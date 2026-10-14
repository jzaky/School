import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listSupportRequests } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SupportRequestForm } from "@/components/commercial/support-form";
import type { Tone } from "@/lib/status";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, Tone> = { open: "approval", in_progress: "info", resolved: "allow" };
const SEVERITY_TONE: Record<string, Tone> = { low: "neutral", normal: "neutral", high: "approval", urgent: "deny" };

export default async function SupportPage() {
  const c = await requirePermission("org:read");
  const rows = await withTenant(c.ctx.orgId, (db) => listSupportRequests(db, c.ctx), { readOnly: true });
  return (
    <div>
      <PageHeader title="Support" description="Ask your provider's support team for help. Requests and their answers are kept here for everyone in the organization." badges={<DemoBadge show={c.org.demoMode} />} />
      <Panel title="New request" className="mb-4">
        <SupportRequestForm />
      </Panel>
      <Panel title="Requests" padded={false}>
        {rows.length ? (
          <ul className="divide-y divide-line" data-testid="support-requests">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3" data-status={r.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-fg">{r.subject}</span>
                  <span className="flex items-center gap-1.5">
                    <Badge tone={SEVERITY_TONE[r.severity] ?? "neutral"}>{r.severity}</Badge>
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</Badge>
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{r.body}</p>
                {r.resolution ? <p className="mt-2 rounded-md bg-bg-elev-2 px-3 py-2 text-sm text-fg">Answer: {r.resolution}</p> : null}
                <p className="mt-1 text-xs text-fg-dim">Opened {formatDateTime(r.createdAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No support requests" description="Requests you send appear here with their status and the support team's answer." />
        )}
      </Panel>
    </div>
  );
}
