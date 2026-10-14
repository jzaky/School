import type { Metadata } from "next";
import { withTenant } from "@aegis/db";
import { computeOnboarding, enterpriseRollout, summarizeOnboarding } from "@aegis/core";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
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
  const [steps, rollout] = await withTenant(c.ctx.orgId, (db) => Promise.all([computeOnboarding(db, c.ctx), enterpriseRollout(db, c.ctx)]), { readOnly: true });
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
      <Panel title="Enterprise rollout" description={`From a new organization to its first audit report: ${rollout.filter((r) => r.done).length} of ${rollout.length} done. Checked against your records.`} className="mt-4" padded={false}>
        <ol className="divide-y divide-line" data-testid="enterprise-rollout">
          {rollout.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" data-rollout-step={r.key} data-done={r.done ? "yes" : "no"}>
              <span className="flex items-center gap-2">
                {r.done ? <CheckCircle2 className="h-4 w-4 text-allow" aria-label="Done" /> : <Circle className="h-4 w-4 text-fg-dim" aria-label="Not done" />}
                <span className={r.done ? "text-fg" : "text-fg-muted"}>{r.title}</span>
              </span>
              <Link href={r.href} className="text-xs text-accent hover:underline">
                Open
              </Link>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
