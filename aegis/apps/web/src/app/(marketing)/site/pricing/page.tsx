import type { Metadata } from "next";
import { InquiryForm } from "@/components/marketing/inquiry-form";
import { Note, PageIntro, Section, SectionHeading, Table } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Pricing and licensing", description: "AEGIS is licensed per installation (deployment). The tier follows how many agents you register, and every tier can run privately inside your own systems. There is no public price list; request a quote." };

const TIERS = [
  ["Team", "Up to 10 registered agents", "One organization, all four products, installs with Docker Compose or Kubernetes, email support"],
  ["Business", "Up to 50 registered agents", "Several organizations (tenants) in one deployment with their data kept apart, single sign-on (OIDC SSO), your own frameworks, priority support"],
  ["Enterprise", "Unlimited agents", "Several deployments, help with private deployment, review sessions on the architecture and the threat model, a named contact"],
];

const OPTIONS = [
  ["AEGIS Trading", "Any tier", "Governance for a trading agent you already run. A guided trading mandate sets which instruments it may trade, order value bands, a cap on units per order, market hours, duplicate protection and a daily loss cap. A simulated brokerage lets you rehearse, and an Alpaca paper-trading connector runs on practice money. Paper trading only: AEGIS holds no trading strategy and never reaches a live account."],
  ["Continuous governance", "Any tier", "AEGIS acts on monitoring alerts by itself, with a response you choose for each rule: suspend the agent, pause the gateway or disable the integration. Every automatic response is written to the evidence record, your administrators are told, and a person can reverse it. It is off by default; until you turn it on, alerts only notify people."],
];

export default function PricingPage() {
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Enterprise licensing, no public price list" lead="You license AEGIS per installation (deployment). The tier follows how many agents you register, and every tier can run privately inside your own systems." />
      <Section>
        <SectionHeading title="How licensing works" />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="mk-card">
            <h3 className="mk-h3">Per deployment</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">One license covers one running copy of AEGIS: the API, the web console, the background worker and the database. Development and test copies for the same customer are included.</p>
          </div>
          <div className="mk-card">
            <h3 className="mk-h3">Agent-count tiers</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">Your tier depends on how many agents are registered, not on how many requests they make. Suspended and retired agents do not count. If you move between tiers, the price is adjusted for the time remaining (prorated).</p>
          </div>
          <div className="mk-card">
            <h3 className="mk-h3">Private deployment</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">Every tier runs inside your own environment, using the Docker Compose file or Kubernetes manifests we ship. No part of AEGIS calls an external AI provider. For trials, a hosted evaluation environment is available.</p>
          </div>
        </div>
        <div className="mt-8">
          <Table head={["Tier", "Registered agents", "Includes"]} rows={TIERS} caption="License tiers by registered agent count" />
        </div>
        <div className="mt-8">
          <Table head={["Option", "Available on", "What it adds"]} rows={OPTIONS} caption="Optional modes available on every tier" />
        </div>
        <Note title="What a license does not include" className="mt-6">
          AEGIS does not include access to AI models, agent frameworks or hosting. Automated evidence from AEGIS shows that controls operated inside AEGIS. It does not show that your organization conforms to any standard, and no certification is provided or implied.
        </Note>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Inquiry" title="Request a quote" lead="Tell us how many agents you expect to register and where you want AEGIS to run. A person replies by email with tier options." />
        <div className="mt-8 max-w-3xl">
          <InquiryForm kind="inquiry" submitLabel="Request a quote" />
        </div>
      </Section>
    </>
  );
}
