import type { Metadata } from "next";
import { InquiryForm } from "@/components/marketing/inquiry-form";
import { Note, PageIntro, Section, SectionHeading, Table } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Pricing and licensing", description: "AEGIS is licensed per deployment with agent-count tiers and a private deployment option. No public price list; request a quote." };

const TIERS = [
  ["Team", "Up to 10 registered agents", "One organization, all four products, Docker Compose or Kubernetes, email support"],
  ["Business", "Up to 50 registered agents", "Multiple organizations (tenants) in one deployment, OIDC SSO, custom frameworks, priority support"],
  ["Enterprise", "Unlimited agents", "Multi-deployment, private deployment assistance, architecture and threat-model review sessions, named contact"],
];

const OPTIONS = [
  ["Continuous governance", "Any tier", "AEGIS responds to monitoring alerts on its own, with a response you set per rule: suspend the agent, pause the gateway or disable the integration. Every automatic response is recorded in evidence, notifies your administrators and can be reversed by a person. Off by default; alerts then only notify people."],
];

export default function PricingPage() {
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Enterprise licensing, no public price list" lead="AEGIS is licensed per deployment. The tier follows the number of registered agents, and every tier includes private deployment inside your own boundary." />
      <Section>
        <SectionHeading title="How licensing works" />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="mk-card">
            <h3 className="mk-h3">Per deployment</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">One license covers one AEGIS deployment (API, web, worker, database). Development and test deployments of the same customer are included.</p>
          </div>
          <div className="mk-card">
            <h3 className="mk-h3">Agent-count tiers</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">The tier is set by registered agents in the registry, not by request volume. Suspended and retired agents do not count. Moving between tiers is prorated.</p>
          </div>
          <div className="mk-card">
            <h3 className="mk-h3">Private deployment</h3>
            <p className="mt-2 text-sm text-(--mk-muted)">Every tier runs in your environment with the shipped Docker Compose file or Kubernetes manifests. No component calls an external AI provider. A hosted evaluation environment is available for trials.</p>
          </div>
        </div>
        <div className="mt-8">
          <Table head={["Tier", "Registered agents", "Includes"]} rows={TIERS} caption="License tiers by registered agent count" />
        </div>
        <div className="mt-8">
          <Table head={["Option", "Available on", "What it adds"]} rows={OPTIONS} caption="Optional modes available on every tier" />
        </div>
        <Note title="What a license does not include" className="mt-6">
          AEGIS does not include model access, agent frameworks or hosting. Automated evidence from AEGIS shows that controls operated inside AEGIS; it does not establish organizational conformance with any standard, and no certification is provided or implied.
        </Note>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Inquiry" title="Request a quote" lead="Tell us the number of agents you expect to register and where you want to deploy. A person replies by email with tier options." />
        <div className="mt-8 max-w-3xl">
          <InquiryForm kind="inquiry" submitLabel="Request a quote" />
        </div>
      </Section>
    </>
  );
}
