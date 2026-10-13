import type { Metadata } from "next";
import { rawPrisma } from "@aegis/db";
import { requirePlatformAdmin } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { PlatformEventsTable } from "@/components/platform/events-table";

export const metadata: Metadata = { title: "System Events" };
export const dynamic = "force-dynamic";

export default async function PlatformEventsPage({ searchParams }: { searchParams: Promise<{ page?: string; pageSize?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.pageSize) || 25));
  const owner = rawPrisma(); // platform_events and organizations are global tables, outside row-level security
  const [rows, total] = await Promise.all([owner.platformEvent.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), owner.platformEvent.count()]);
  const orgIds = [...new Set(rows.map((r) => r.orgId).filter((x): x is string => !!x))];
  const orgs = orgIds.length ? await owner.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return (
    <div>
      <PageHeader title="System Events" description="Platform-level events outside any tenant: admin actions, billing inquiries, chain verifications." badges={<Badge tone="info">Platform admin</Badge>} />
      <PlatformEventsTable rows={rows.map((r) => ({ id: r.id, type: r.type, actorId: r.actorId, org: r.orgId ? (orgName.get(r.orgId) ?? r.orgId) : null, detail: JSON.stringify(r.detail), createdAt: r.createdAt.toISOString() }))} pagination={{ page, pageSize, total }} />
    </div>
  );
}
