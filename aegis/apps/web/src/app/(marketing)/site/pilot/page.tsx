import type { Metadata } from "next";
import { InquiryForm } from "@/components/marketing/inquiry-form";
import { Note, PageIntro, Section, SectionHeading } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Discuss a pilot", description: "A four-week AEGIS pilot that governs your AI support agent's refunds using your payment provider's test mode, so no real money moves. What it involves, what you bring and what you get." };

const BRING = [
  ["A refund-issuing agent", "Your own support agent, connected so that every refund asks the gateway first (through the SDK or REST API). Until yours is wired in, you can use our sample agent."],
  ["A test-mode payment account", "A Stripe test-mode secret key. The connector refuses live keys both when the key is saved and when a refund runs, so nothing in the pilot moves real money."],
  ["A named approver", "One or two people who will decide the refunds that are above the amount the agent may approve on its own during the pilot."],
  ["Thresholds you would actually use", "The amount the agent may refund on its own, the band that needs a person, who may approve, and the rules for duplicates and reasons. You set them in a guided form and can change them whenever you learn something."],
];

const GET = [
  "Every refund decision from the pilot, checked against your payment provider's own records of what actually happened (reconciled), and exported as a record that cannot be edited without it showing",
  "Counts of refunds allowed, held, approved, rejected and refused, and how long approvers took to decide",
  "A list of the near misses: what the agent tried to do that a policy or data protection stopped",
  "A written statement of what would need to change before production use, claiming nothing beyond what was observed",
];

const WEEKS = [
  ["Week 1", "Set up. Hosted demo or private deployment, Stripe test key connected and tested, agent registered with a named owner, policy set, approver assigned. An onboarding checklist tracks each step."],
  ["Week 2", "Shadow mode. Every refund is sent to the gateway for a decision while your existing process still carries it out. You compare the two."],
  ["Weeks 3 to 4", "Enforce mode on test-mode refunds. The gateway's decision now counts, and approvers decide in the console. An emergency pause drill shows outstanding actions stopping."],
  ["Exit", "You receive the evidence export and the pilot report."],
];

export default function PilotPage() {
  return (
    <>
      <PageIntro eyebrow="Discuss a pilot" title="Four weeks on test-mode money" lead="For four weeks, AEGIS governs every refund your AI support agent issues, using your payment provider's test mode so no real money moves. You set the limits and you name the approvers. Tell us about the agent and we will reply with a proposed plan." />
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
            <Note>No customers or certifications are claimed. A pilot is a trial on test-mode money. Using AEGIS in production is a separate decision with its own review.</Note>
          </aside>
        </div>
      </Section>
    </>
  );
}
