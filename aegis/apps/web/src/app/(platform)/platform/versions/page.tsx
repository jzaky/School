import type { Metadata } from "next";
import { rawPrisma } from "@aegis/db";
import { Cpu } from "lucide-react";
import { requirePlatformAdmin } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Deployment Versions" };
export const dynamic = "force-dynamic";

export default async function VersionsPage() {
  await requirePlatformAdmin();
  const rows = await rawPrisma().deploymentVersion.findMany({ orderBy: { deployedAt: "desc" }, take: 200 });
  return (
    <div>
      <PageHeader title="Deployment Versions" description="What is running where. Rows are written by the deploy pipeline after each rollout." badges={<Badge tone="info">Platform admin</Badge>} />
      <div className="overflow-auto rounded-panel border border-line bg-bg-elev">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Deployment versions</caption>
          <thead className="bg-bg-elev-2/95 text-xs text-fg-muted">
            <tr>
              <th className="h-9 px-3 text-start font-medium">Component</th>
              <th className="h-9 px-3 text-start font-medium">Version</th>
              <th className="h-9 px-3 text-start font-medium">Git SHA</th>
              <th className="h-9 px-3 text-start font-medium">Deployed</th>
              <th className="h-9 px-3 text-start font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={Cpu} title="No deployments recorded" description="The deploy pipeline inserts a deployment_versions row for each component (web, api, worker) when it ships. Nothing has been recorded on this deployment yet." />
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="h-9 px-3 font-medium">{r.component}</td>
                  <td className="h-9 px-3 font-mono text-xs">{r.version}</td>
                  <td className="h-9 px-3 font-mono text-xs text-fg-muted">{r.gitSha ? r.gitSha.slice(0, 12) : "unknown"}</td>
                  <td className="h-9 px-3">{formatDateTime(r.deployedAt)}</td>
                  <td className="h-9 px-3 text-fg-muted">{r.notes}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
