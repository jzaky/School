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
import { t, tLabel } from "@/i18n/server";

export const metadata: Metadata = { title: "Control Center" };
export const dynamic = "force-dynamic";

const TONE_TEXT: Record<Tile["tone"], string> = { allow: "text-allow", deny: "text-deny", approval: "text-approval", info: "text-fg", neutral: "text-fg" };
const GROUPS: Tile["group"][] = ["Control", "Security", "Governance", "Assurance", "Integrations"];

export default async function ControlCenterPage() {
  const c = await requirePermission("org:read");
  const data = await withTenant(c.ctx.orgId, (db) => controlCenter(db, c.ctx), { readOnly: true, timeout: 30_000 });
  return (
    <div>
      <PageHeader title={t("cc.title")} description={t("cc.description")} badges={<DemoBadge show={c.org.demoMode} />} />
      {data.decisionsByDay.length ? (
        <Panel title={t("cc.chartTitle")} description={t("cc.chartDescription")} className="mb-4">
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
                {t(`cc.group.${g}`)}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {tiles.map((tile) => (
                  <li key={tile.key} data-testid="cc-tile" data-tile={tile.key}>
                    <Link href={tile.href} className="block h-full rounded-panel border border-line bg-bg-elev p-4 transition-colors hover:border-line-strong focus-visible:border-accent">
                      <span className="block text-xs text-fg-muted">{tLabel(`tile.${tile.key}`, tile.label)}</span>
                      <span className={cn("mt-1 block text-2xl font-semibold tabular", TONE_TEXT[tile.tone])} dir="auto">{tile.value}</span>
                      <span className="mt-1 block text-xs text-fg-muted" dir="auto">{tile.detail}</span>
                      <span className="mt-2 block text-[11px] text-fg-dim">{t("common.source")}: <bdi>{tile.source}</bdi></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-fg-dim">{t("cc.computed", { at: formatDateTime(data.generatedAt) })}</p>
    </div>
  );
}
