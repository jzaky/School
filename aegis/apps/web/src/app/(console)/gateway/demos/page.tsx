import type { Metadata } from "next";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Note } from "@/components/ui/note";
import { LinkButton } from "@/components/ui/link-button";
import { DemoRunner } from "@/components/control/demo-runner";

export const metadata: Metadata = { title: "Demo scenarios" };
export const dynamic = "force-dynamic";

export default async function DemosPage() {
  const c = await requirePermission("gateway:read");
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Action Gateway", href: "/gateway" }, { label: "Demo scenarios" }]}
        title="Demo scenarios"
        description="Every step goes through the real Action Gateway, the one door every agent action takes: the basic checks, the policy decision, the Shield data protection check, approvals, one-time permission slips (execution grants) and the simulated outside systems. Nothing in the console is faked."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={
          <>
            <LinkButton href="/activity">Watch Live Activity</LinkButton>
            <LinkButton href="/approvals">Open Approval Center</LinkButton>
          </>
        }
      />
      {!c.org.demoMode ? <Note tone="warning" className="mb-4">This organization is not in demo mode. The scenarios are switched off so that made-up records cannot mix with real ones.</Note> : null}
      <DemoRunner canDecide={c.can("approvals:decide") && c.org.demoMode} userName={c.session.user.name} enabled={c.org.demoMode} />
    </div>
  );
}
