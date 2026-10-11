import type { Metadata } from "next";
import { InquiryForm } from "@/components/marketing/inquiry-form";
import { PageIntro, Section } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Request a demo", description: "Book a live walkthrough of AEGIS: agent registry, policy, the Action Gateway, approvals, evidence and framework assessment on a synthetic banking tenant." };

const AGENDA = [
  ["5 min", "Your agents and systems", "What the agents do today, which systems they touch, where the risk is."],
  ["15 min", "Live banking scenario", "A treasury agent attempts an AED 250,000 transfer: approval required, approver decides, receipt and evidence recorded. Thresholds illustrative."],
  ["10 min", "Policy and Shield", "Versioned policies with embedded tests; sensitive data detection and destination rules on a data-egress attempt."],
  ["10 min", "Evidence and Audit", "Chain verification, signed export, an assessment against a framework catalog."],
  ["5 min", "Deployment and next steps", "Docker Compose or Kubernetes in your boundary, evaluation plan."],
];

export default function DemoPage() {
  return (
    <>
      <PageIntro eyebrow="Request a demo" title="See the gateway decide" lead="A 45-minute session on the synthetic demo tenant, driven through the real gateway, policy engine and approval service. Nothing is pre-recorded." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
          <InquiryForm kind="demo_request" />
          <aside>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-(--mk-dim)">Typical agenda</h2>
            <ol className="mt-3 divide-y divide-(--mk-line) border-y border-(--mk-line)">
              {AGENDA.map(([t, h, b]) => (
                <li key={h} className="grid grid-cols-[56px_1fr] gap-3 py-3 text-sm">
                  <span className="font-mono text-xs text-(--mk-dim)">{t}</span>
                  <div>
                    <p className="font-semibold">{h}</p>
                    <p className="mt-0.5 text-(--mk-muted)">{b}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mk-hint mt-4">All demo data is synthetic and labelled as such in the console. No customer data is used.</p>
          </aside>
        </div>
      </Section>
    </>
  );
}
