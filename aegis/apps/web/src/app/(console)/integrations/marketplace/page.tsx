import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { CATALOG_CATEGORIES, CATALOG_STATUS, catalogForOrg } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { formatDateTime } from "@/lib/utils";
import type { Tone } from "@/lib/status";

export const metadata: Metadata = { title: "Integration Marketplace" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, Tone> = { contract_tested: "approval", tested: "allow", simulated: "neutral" };

export default async function MarketplacePage() {
  const c = await requirePermission("integrations:read");
  const entries = await withTenant(c.ctx.orgId, (db) => catalogForOrg(db, c.ctx), { readOnly: true });
  const groups = Object.entries(CATALOG_CATEGORIES).map(([key, label]) => ({ key, label, items: entries.filter((e) => e.category === key) }));
  return (
    <div>
      <PageHeader title="Integration Marketplace" description="Everything AEGIS connects to, how far each connection has been verified, and what you need to use it." badges={<DemoBadge show={c.org.demoMode} />} />
      <Note tone="info" className="mb-4">
        No integration here has been verified by AEGIS against the real vendor service yet. Each one says how it was built and tested. When your organization sends a test event or passes a connection test against your own system, that entry shows as verified in your organization, with the date. Vendor names describe compatibility only; AEGIS is not affiliated with or endorsed by them.
      </Note>
      <div className="mb-4 grid gap-2 md:grid-cols-3" data-testid="marketplace-legend">
        {Object.entries(CATALOG_STATUS).map(([k, s]) => (
          <div key={k} className="rounded-md border border-line p-3 text-xs">
            <Badge tone={STATUS_TONE[k] ?? "neutral"}>{s.label}</Badge>
            <p className="mt-1 text-fg-muted">{s.meaning}</p>
          </div>
        ))}
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <Panel key={g.key} title={g.label}>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.items.map((e) => (
                <li key={e.key} className="flex flex-col rounded-md border border-line p-3" data-testid="marketplace-entry" data-entry={e.key}>
                  <span className="font-medium text-fg">{e.name}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{CATALOG_STATUS[e.status].label}</Badge>
                    {e.verifiedAt ? (
                      <Badge tone="allow" data-testid="verified-in-org">
                        verified in your organization {formatDateTime(e.verifiedAt)}
                      </Badge>
                    ) : e.configured ? (
                      <Badge tone="info">{e.configured} set up</Badge>
                    ) : null}
                  </span>
                  <p className="mt-2 flex-1 text-sm text-fg-muted">{e.description}</p>
                  <p className="mt-2 text-xs text-fg-dim">You need: {e.needs}</p>
                  <span className="mt-2 flex items-center justify-between text-xs">
                    <Link href={e.category === "events" ? `/integrations/destinations?kind=${e.key}` : e.configureHref} className="text-accent hover:underline">
                      Set up
                    </Link>
                    <span className="font-mono text-fg-dim">{e.docs}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
