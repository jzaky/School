import Image from "next/image";

/**
 * Real console screenshots captured from the seeded demo tenant by apps/web/tests/screenshots.mts
 * and copied to public/assets/screens. Never a mock-up: if a screen changes, the capture is re-run.
 */
export const SCREENS = {
  overview: { file: "overview.png", alt: "AEGIS Overview: items needing attention, agent and integration health, recent actions grouped by outcome" },
  gettingStarted: { file: "getting-started.png", alt: "Getting started checklist with seven setup steps and their completion state" },
  approvals: { file: "approvals.png", alt: "Approvals list describing each pending refund in plain language with the policy reason and expiry" },
  approvalDetail: { file: "approval-detail.png", alt: "Approval detail: requested refund, amount, order and customer reference, policy explanation and decision controls" },
  requestDetail: { file: "request-detail.png", alt: "Action request detail with the decision trace, execution grant, downstream receipt and evidence timeline" },
  policyThresholds: { file: "policy-thresholds.png", alt: "Guided refund policy with editable thresholds, plain-language explanation and sample request outcomes" },
  integrations: { file: "integrations.png", alt: "Integrations list showing simulated systems and the Stripe test-mode sandbox" },
  evidence: { file: "evidence.png", alt: "Evidence ledger with chain verification and export" },
} as const;

export type ScreenKey = keyof typeof SCREENS;

export function Screenshot({ screen, caption, priority, className }: { screen: ScreenKey; caption?: string; priority?: boolean; className?: string }) {
  const s = SCREENS[screen];
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-xl border border-(--mk-line) bg-(--mk-bg-2) shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]">
        <Image src={`/assets/screens/${s.file}`} alt={s.alt} width={1440} height={900} priority={priority} unoptimized className="block h-auto w-full" />
      </div>
      {caption ? <figcaption className="mk-hint mt-2">{caption}</figcaption> : null}
    </figure>
  );
}
