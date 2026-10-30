import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { listMembers, listTeams } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateTeamDialog, TeamCard, type MemberPick, type TeamView } from "@/components/org/teams";
import { UsersRound } from "lucide-react";

export const metadata: Metadata = { title: "Teams" };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const c = await requirePermission("users:read");
  const [teams, members] = await withTenant(c.ctx.orgId, (db) => Promise.all([listTeams(db, c.ctx), listMembers(db, c.ctx)]));
  const byMembership = new Map(members.map((m) => [m.id, m]));
  const picks: MemberPick[] = members.filter((m) => m.status === "active").map((m) => ({ membershipId: m.id, name: m.user?.name ?? "Unknown user", email: m.user?.email ?? "", roleName: m.role.name })).sort((a, b) => a.name.localeCompare(b.name));
  const views: TeamView[] = teams.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    members: t.members
      .map((tm) => {
        const m = byMembership.get(tm.membershipId);
        return { membershipId: tm.membershipId, name: m?.user?.name ?? "Unknown user", roleName: m?.role.name ?? "", isLead: tm.isLead };
      })
      .sort((a, b) => Number(b.isLead) - Number(a.isLead) || a.name.localeCompare(b.name)),
  }));
  const canWrite = c.can("users:write");
  return (
    <div>
      <PageHeader title="Teams" description="Teams own agents and resources. Policies can target a whole team." badges={<DemoBadge show={c.org.demoMode} />} actions={<CreateTeamDialog canWrite={canWrite} />} />
      {views.length === 0 ? (
        <EmptyState icon={UsersRound} title="No teams" description="Create the first team to group members and agents." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {views.map((t) => (
            <TeamCard key={t.id} team={t} members={picks} canWrite={canWrite} />
          ))}
        </div>
      )}
    </div>
  );
}
