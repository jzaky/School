import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { organizationHealth } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import type { Tone } from "@/lib/status";

export const metadata: Metadata = { title: "System Health" };
export const dynamic = "force-dynamic";

const TONE: Record<string, Tone> = { ok: "allow", warning: "approval", failing: "deny", unknown: "neutral" };

export default async function HealthPage() {
  const c = await requirePermission("org:read");
  const checks = await withTenant(c.ctx.orgId, (db) => organizationHealth(db, c.ctx), { readOnly: true });
  return (
    <div>
      <PageHeader title="System Health" description="Whether the parts of AEGIS your organization depends on are working, judged from the records they leave. Infrastructure-wide health (hosts, queues across all organizations) is on the platform administration view." badges={<DemoBadge show={c.org.demoMode} />} />
      <Panel title="Checks" padded={false}>
        <ul className="divide-y divide-line" data-testid="health-checks">
          {checks.map((h) => (
            <li key={h.key} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3" data-check={h.key} data-status={h.status}>
              <span>
                <span className="font-medium text-fg">{h.label}</span>
                <span className="block text-sm text-fg-muted">{h.detail}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={TONE[h.status] ?? "neutral"}>{h.status}</Badge>
                {h.href ? (
                  <Link href={h.href} className="text-xs text-accent hover:underline">
                    Open
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
