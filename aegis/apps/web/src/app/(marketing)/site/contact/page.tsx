import type { Metadata } from "next";
import { InquiryForm } from "@/components/marketing/inquiry-form";
import { PageIntro, Section } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Contact", description: "Contact the AEGIS team about AI agent authorization, runtime enforcement, evidence and private deployment." };

export default function ContactPage() {
  return (
    <>
      <PageIntro eyebrow="Contact" title="Talk to the team" lead="Questions about the platform, a security review, licensing or an integration. A person reads every message and replies by email." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <InquiryForm kind="inquiry" />
          <aside className="space-y-6 text-sm">
            <div>
              <h2 className="font-semibold">Security teams</h2>
              <p className="mt-1 text-(--mk-muted)">Ask for the architecture walkthrough, the threat model and the fail-closed test list. We will say plainly what is built, what is simulated in the demo tenant and what is still a gap.</p>
            </div>
            <div>
              <h2 className="font-semibold">Engineering teams</h2>
              <p className="mt-1 text-(--mk-muted)">The gateway is a REST API with a small TypeScript SDK. Any agent framework that can make an HTTP call before running a tool can be governed.</p>
            </div>
            <div>
              <h2 className="font-semibold">Procurement and legal</h2>
              <p className="mt-1 text-(--mk-muted)">Licensing is per deployment with agent-count tiers. The open-source inventory lists every dependency and its license.</p>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
