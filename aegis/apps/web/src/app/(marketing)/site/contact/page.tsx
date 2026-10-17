import type { Metadata } from "next";
import { InquiryForm } from "@/components/marketing/inquiry-form";
import { PageIntro, Section } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Contact", description: "Contact the AEGIS team about deciding what your AI agents may do, enforcing it as they act, keeping the evidence, and running AEGIS privately inside your own systems." };

export default function ContactPage() {
  return (
    <>
      <PageIntro eyebrow="Contact" title="Talk to the team" lead="Ask about the platform, a security review, licensing or connecting your systems. A person reads every message and replies by email." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <InquiryForm kind="inquiry" />
          <aside className="space-y-6 text-sm">
            <div>
              <h2 className="font-semibold">Security teams</h2>
              <p className="mt-1 text-(--mk-muted)">Ask for the architecture walkthrough, the threat model and the list of tests showing that AEGIS refuses when something goes wrong rather than letting it through (the fail-closed test list). We will say plainly what is built, what is simulated in the demo tenant and what is still a gap.</p>
            </div>
            <div>
              <h2 className="font-semibold">Engineering teams</h2>
              <p className="mt-1 text-(--mk-muted)">Agents reach the Action Gateway, the one door every agent action goes through, over a REST API with a small TypeScript SDK. Any agent framework that can make an HTTP call before running a tool can be governed.</p>
            </div>
            <div>
              <h2 className="font-semibold">Procurement and legal</h2>
              <p className="mt-1 text-(--mk-muted)">Licensing is per installation (deployment), with tiers set by how many agents you register. The open-source inventory lists every dependency and its license.</p>
            </div>
          </aside>
        </div>
      </Section>
    </>
  );
}
