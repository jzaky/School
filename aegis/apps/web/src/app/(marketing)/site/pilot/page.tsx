import type { Metadata } from "next";
import { InquiryForm } from "@/components/marketing/inquiry-form";
import { Note, PageIntro, Section, SectionHeading } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Discuss a pilot", description: "A four-week AEGIS pilot on your AI support agent's refunds, against your payment provider's test mode. What it involves, what you bring, what you get." };

const BRING = [
  ["A refund-issuing agent", "Your own support agent calling the gateway through the SDK or REST API, or our sample agent while yours is being wired in."],
  ["A test-mode payment account", "A Stripe test-mode secret key. The connector refuses live keys at storage and at execution, so nothing in the pilot moves real money."],
  ["A named approver", "One or two people who will decide refunds above the autonomous threshold during the pilot."],
  ["Thresholds you would actually use", "Autonomous limit, approval band, approver roles, duplicate and reason rules. Set in the guided policy form; change them whenever you learn something."],
];

const GET = [
  "Every refund decision of the pilot, reconciled against your provider's own records, exported as a verifiable ledger",
  "Counts of allowed, held, approved, rejected and refused refunds, and the time approvers took",
  "A list of the near misses: what the agent tried that policy or data protection stopped",
  "A written statement of what would need to change for production use, with no claim beyond what was observed",
];

const WEEKS = [
  ["Week 1", "Set up: hosted demo or private deployment, Stripe test key connected and tested, agent registered with an owner, policy set, approver assigned. The onboarding checklist tracks it."],
  ["Week 2", "Shadow mode: every refund goes to the gateway for a decision while your existing process still executes. You compare the two."],
  ["Weeks 3 to 4", "Enforce mode on test-mode refunds. Approvers decide in the console. An emergency pause drill shows outstanding actions stopping."],
  ["Exit", "Evidence export and the pilot report."],
];

export default function PilotPage() {
  return (
    <>
      <PageIntro eyebrow="Discuss a pilot" title="Four weeks on test-mode money" lead="A pilot governs your AI support agent's refunds end to end against your payment provider's test mode, with your thresholds and your approvers. Tell us about the agent and we will reply with a proposed plan." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
          <div>
            <SectionHeading eyebrow="Tell us about your agent" title="Pilot request" />
            <div className="mt-6">
              <InquiryForm kind="pilot_request" />
            </div>
          </div>
          <aside className="space-y-8">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-(--mk-dim)">What you bring</h2>
              <dl className="mt-3 divide-y divide-(--mk-line) border-y border-(--mk-line)">
                {BRING.map(([h, b]) => (
                  <div key={h} className="py-3 text-sm">
                    <dt className="font-semibold">{h}</dt>
                    <dd className="mt-0.5 text-(--mk-muted)">{b}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-(--mk-dim)">How the weeks run</h2>
              <ol className="mt-3 divide-y divide-(--mk-line) border-y border-(--mk-line)">
                {WEEKS.map(([t, b]) => (
                  <li key={t} className="grid grid-cols-[88px_1fr] gap-3 py-3 text-sm">
                    <span className="font-mono text-xs text-(--mk-dim)">{t}</span>
                    <p className="text-(--mk-muted)">{b}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-(--mk-dim)">What you get</h2>
              <ul className="mt-3 space-y-2 text-sm text-(--mk-muted)">
                {GET.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
            <Note>No customers or certifications are claimed. A pilot is an evaluation on test-mode money; production use is a separate decision with its own review.</Note>
          </aside>
        </div>
      </Section>
    </>
  );
}
