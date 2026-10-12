import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { computeOnboarding, summarizeOnboarding } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { OnboardingChecklist, OnboardingProgress } from "@/components/onboarding/checklist";
import { OnboardingDismissButton } from "@/components/onboarding/dismiss-button";

export const metadata: Metadata = { title: "Getting started" };
export const dynamic = "force-dynamic";

export default async function GettingStartedPage() {
  const c = await requirePermission("org:read");
  const steps = await withTenant(c.ctx.orgId, (db) => computeOnboarding(db, c.ctx), { readOnly: true });
  const summary = summarizeOnboarding(steps, c.org.settings);
  return (
    <div>
      <PageHeader
        title="Getting started"
        description="Seven steps to a working pilot: let an AI agent handle routine work, require a person for risky actions, and keep a verifiable record of every decision. Each step is checked against real data, so it ticks itself off when the work is done."
        badges={<DemoBadge show={c.org.demoMode} />}
        actions={<OnboardingDismissButton dismissed={!!summary.dismissedAt} canAdmin={c.can("org:admin")} size="md" />}
      />
      {summary.dismissedAt ? <Note className="mb-4">This checklist is hidden from the sidebar and the Overview. It stays reachable from Settings.</Note> : null}
      <Panel padded={false} title={summary.complete ? "Pilot setup complete" : `Step ${Math.min(summary.done + 1, summary.total)} of ${summary.total}`} description={summary.next ? `Next: ${summary.next.title}` : "Every step is done. Hide the checklist when you no longer need it."} actions={<OnboardingProgress summary={summary} className="w-56" />}>
        <OnboardingChecklist steps={steps} />
      </Panel>
    </div>
  );
}
