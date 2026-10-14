import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { AREA_TEXT, DEPLOYMENT_MODELS, MODEL_TEXT, deploymentReadiness, type ReadinessArea } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/ui/demo-badge";
import { KeyValue } from "@/components/ui/key-value";
import type { Tone } from "@/lib/status";
import { formatDate, formatDateTime } from "@/lib/utils";
import { t, tLabel } from "@/i18n/server";

export const metadata: Metadata = { title: "Deployment" };
export const dynamic = "force-dynamic";

const TONE: Record<string, Tone> = { ok: "allow", warning: "approval", failing: "deny", unknown: "neutral" };
const RES_TONE: Record<string, Tone> = { in_country: "allow", no_customer_data: "neutral", outside: "deny", undeclared: "approval", not_attested: "approval", missing: "approval" };
const AREAS = Object.keys(AREA_TEXT) as ReadinessArea[];
const INSTALL: Record<(typeof DEPLOYMENT_MODELS)[number], string> = {
  multi_tenant_saas: "deploy/k8s or a managed platform; see docs/DEPLOYMENT.md",
  single_tenant_managed: "deploy/k8s, one namespace and database per customer",
  customer_private: "deploy/k8s or deploy/docker-compose.yml in the customer's account",
  on_premises: "deploy/docker-compose.yml or deploy/systemd on the customer's servers",
  development: "pnpm dev; see README.md",
};

export default async function DeploymentPage() {
  const c = await requirePermission("org:read");
  const r = await withTenant(c.ctx.orgId, (db) => deploymentReadiness(db, c.ctx, { settings: c.org.settings }), { readOnly: true, timeout: 30_000 });
  const res = r.residency;
  return (
    <div>
      <PageHeader title={t("deploy.title")} description={t("deploy.description")} badges={<DemoBadge show={c.org.demoMode} />} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title={t("deploy.model")} data-testid="deployment-model" data-model={r.model.key}>
          <p className="text-base font-semibold text-fg">{tLabel(`model.${r.model.key}`, r.model.name)}</p>
          <p className="mt-1 text-sm text-fg-muted" dir="auto">{r.model.summary}</p>
          <KeyValue
            className="mt-3"
            items={[
              { label: t("deploy.operator"), value: r.loaded.manifest.operator || r.model.operator },
              { label: t("deploy.isolation"), value: <bdi>{r.model.isolation}</bdi> },
              {
                label: t("deploy.manifest"),
                value: r.loaded.error ? (
                  <span className="text-deny">
                    {t("deploy.manifest.error")}: {r.loaded.error}
                  </span>
                ) : r.loaded.source === "none" ? (
                  t("deploy.manifest.none")
                ) : (
                  t("deploy.manifest.loaded", { source: r.loaded.source })
                ),
              },
            ]}
          />
        </Panel>
        <Panel title={t("deploy.regional")} data-testid="regional-settings">
          <KeyValue
            items={[
              { label: t("deploy.regional.timezone"), value: <span className="font-mono">{c.region.timeZone}</span> },
              { label: t("deploy.regional.now"), value: <span data-testid="regional-now">{formatDateTime(r.generatedAt)}</span> },
              { label: t("deploy.regional.currency"), value: <span className="font-mono">{c.region.currency}</span> },
              { label: t("deploy.regional.language"), value: c.org.settings.locale === "ar" ? "العربية" : "English" },
              { label: t("deploy.regional.retention"), value: t("deploy.regional.retentionDays", { days: r.auditRetentionDays }) },
            ]}
          />
          <p className="mt-2 text-xs text-fg-dim">
            <Link href="/org/settings" className="text-accent hover:underline">
              {t("deploy.regional.change")}
            </Link>
          </p>
        </Panel>
      </div>

      <Panel title={t("deploy.residency", { country: res.country })} description={t("deploy.residency.help")} className="mb-4" data-testid="residency" data-claim={res.claimAllowed ? "allowed" : "none"}>
        <div className="flex flex-wrap items-start gap-2">
          <Badge tone={res.claimAllowed ? "allow" : "approval"}>{res.claimAllowed ? t("deploy.residency.claim") : t("deploy.residency.noClaim")}</Badge>
          <p className="min-w-0 flex-1 text-sm text-fg" data-testid="residency-statement" dir="auto">
            {res.statement}
          </p>
        </div>
        {res.blockers.length ? (
          <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-fg-muted">
            {res.blockers.map((b) => (
              <li key={b} dir="auto">{b}</li>
            ))}
          </ul>
        ) : null}
        <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-fg-dim">{t("deploy.components")}</h3>
        {res.components.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-fg-muted">
                  <th className="py-1.5 pe-3 text-start font-medium">{t("deploy.col.component")}</th>
                  <th className="py-1.5 pe-3 text-start font-medium">{t("deploy.col.country")}</th>
                  <th className="py-1.5 text-start font-medium">{t("deploy.col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {res.components.map((cp) => (
                  <tr key={cp.key} data-component={cp.key} data-status={cp.status}>
                    <td className="py-2 pe-3">
                      <span className="text-fg">{cp.provider}</span>
                      <span className="block text-xs text-fg-dim">
                        {cp.kind.replace(/_/g, " ")}
                        {cp.subprocessor ? `, ${t("deploy.subprocessor")}` : ""}
                      </span>
                    </td>
                    <td className="py-2 pe-3 font-mono text-xs">
                      {cp.country}
                      {cp.region ? <span className="block text-fg-dim">{cp.region}</span> : null}
                    </td>
                    <td className="py-2">
                      <Badge tone={RES_TONE[cp.status] ?? "neutral"}>{t(`deploy.res.${cp.status}`)}</Badge>
                      <span className="block text-xs text-fg-muted" dir="auto">{cp.reason}</span>
                    </td>
                  </tr>
                ))}
                <tr data-component="backups" data-status={res.backups.status}>
                  <td className="py-2 pe-3 text-fg">{t("deploy.backups")}</td>
                  <td className="py-2 pe-3 font-mono text-xs">{r.loaded.manifest.backups?.country ?? "unknown"}</td>
                  <td className="py-2">
                    <Badge tone={RES_TONE[res.backups.status] ?? "neutral"}>{t(`deploy.res.${res.backups.status}`)}</Badge>
                    <span className="block text-xs text-fg-muted" dir="auto">{res.backups.reason}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">{t("deploy.components.empty")}</p>
        )}
      </Panel>

      <Panel title={t("deploy.readiness")} description={t("deploy.readiness.help")} className="mb-4" padded={false}>
        <div className="divide-y divide-line" data-testid="readiness">
          {AREAS.map((area) => {
            const checks = r.checks.filter((x) => x.area === area);
            if (!checks.length) return null;
            return (
              <section key={area} className="px-4 py-3" aria-labelledby={`area-${area}`}>
                <h3 id={`area-${area}`} className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-dim">
                  {tLabel(`area.${area}`, AREA_TEXT[area])}
                </h3>
                <ul className="space-y-2">
                  {checks.map((x) => (
                    <li key={x.key} className="flex flex-wrap items-start justify-between gap-2" data-testid="readiness-check" data-key={x.key} data-status={x.status} data-basis={x.basis}>
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-fg" dir="auto">{x.label}</span>
                        <span className="block text-sm text-fg-muted" dir="auto">{x.detail}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Badge tone="neutral">{t(`deploy.basis.${x.basis}`)}</Badge>
                        <Badge tone={TONE[x.status] ?? "neutral"}>{t(`common.status.${x.status}`)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>

      <Panel title={t("deploy.options")} description={t("deploy.options.help")}>
        <ul className="grid gap-3 md:grid-cols-2" data-testid="deployment-options">
          {DEPLOYMENT_MODELS.filter((m) => m !== "development").map((m) => (
            <li key={m} className="rounded-md border border-line p-3" data-option={m}>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-fg">{tLabel(`model.${m}`, MODEL_TEXT[m].name)}</span>
                {m === r.model.key ? <Badge tone="info">{t("deploy.current")}</Badge> : null}
              </span>
              <span className="mt-1 block text-sm text-fg-muted" dir="auto">{MODEL_TEXT[m].summary}</span>
              <span className="mt-1 block text-xs text-fg-dim" dir="auto">
                {MODEL_TEXT[m].operator}. {INSTALL[m]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-fg-dim">{t("deploy.footer", { at: formatDate(r.generatedAt) })}</p>
      </Panel>
    </div>
  );
}
