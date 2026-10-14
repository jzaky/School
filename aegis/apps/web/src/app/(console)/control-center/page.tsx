import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { controlCenter, type Tile } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { DemoBadge } from "@/components/ui/demo-badge";
import { DecisionsChart } from "@/components/assurance/report-charts";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Control Center" };
export const dynamic = "force-dynamic";

const TONE_TEXT: Record<Tile["tone"], string> = { allow: "text-allow", deny: "text-deny", approval: "text-approval", info: "text-fg", neutral: "text-fg" };
const GROUPS: Tile["group"][] = ["Control", "Security", "Governance", "Assurance", "Integrations"];

export default async function ControlCenterPage() {
  const c = await requirePermission("org:read");
  const data = await withTenant(c.ctx.orgId, (db) => controlCenter(db, c.ctx), { readOnly: true, timeout: 30_000 });
  return (
    <div>
      <PageHeader title="Control Center" description="Every AEGIS module in one view. Each figure is computed from your records when the page loads, names its source, and opens the page with the rows behind it. Areas you cannot read are left out." badges={<DemoBadge show={c.org.demoMode} />} />
      {data.decisionsByDay.length ? (
        <Panel title="Gateway decisions, last 14 days" description="Allowed (including narrowed), sent to a person (approval, more information, quarantine), and refused, per day" className="mb-4">
          <DecisionsChart data={data.decisionsByDay} />
        </Panel>
      ) : null}
      <div className="space-y-4">
        {GROUPS.map((g) => {
          const tiles = data.tiles.filter((t) => t.group === g);
          if (!tiles.length) return null;
          return (
            <section key={g} aria-labelledby={`cc-${g}`}>
              <h2 id={`cc-${g}`} className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-dim">
                {g}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {tiles.map((t) => (
                  <li key={t.key} data-testid="cc-tile" data-tile={t.key}>
                    <Link href={t.href} className="block h-full rounded-panel border border-line bg-bg-elev p-4 transition-colors hover:border-line-strong focus-visible:border-accent">
                      <span className="block text-xs text-fg-muted">{t.label}</span>
                      <span className={cn("mt-1 block text-2xl font-semibold tabular", TONE_TEXT[t.tone])}>{t.value}</span>
                      <span className="mt-1 block text-xs text-fg-muted">{t.detail}</span>
                      <span className="mt-2 block text-[11px] text-fg-dim">Source: {t.source}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-fg-dim">Computed {formatDateTime(data.generatedAt)}. Reload the page for current figures.</p>
    </div>
  );
}
