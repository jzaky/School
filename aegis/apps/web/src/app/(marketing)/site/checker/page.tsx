import type { Metadata } from "next";
import { CHECKER_FRAMEWORKS } from "@aegis/core/audit/checker";
import { ClosingCta, Note, PageIntro, Section, SectionHeading } from "@/components/marketing/primitives";
import { GovernanceChecker } from "@/components/marketing/governance-checker";

export const metadata: Metadata = { title: "Free AI agent governance checker", description: "Fourteen plain questions about the AI agents you run, scored in your browser and mapped to ISO/IEC 42001, ISO/IEC 27001, NIST AI RMF, the EU AI Act, GDPR, the UAE PDPL, Dubai DESC ISR and further ISO guidance. Nothing is stored." };

export default function CheckerPage() {
  return (
    <>
      <PageIntro eyebrow="Free checker" title="How well governed are your AI agents?" lead={<>Fourteen questions a regulator, an auditor or your own board would ask about agents that can act. Answer them here; the score, the gaps and the framework coverage are computed in your browser and never sent anywhere.</>} />
      <Section tight>
        <Note title="What this is">
          A self-assessment against AEGIS&apos;s own one-sentence summaries of {CHECKER_FRAMEWORKS.length} public frameworks ({CHECKER_FRAMEWORKS.map((f) => f.name).join(", ")}). It is not a compliance opinion, not a certification and not legal advice. No account, no email, no cookie: there is nothing to sign up for.
        </Note>
        <div className="mt-8">
          <GovernanceChecker />
        </div>
      </Section>
      <Section className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Why these questions" title="Fourteen controls that decide whether an agent can do damage" lead="Each question maps to the control catalog AEGIS ships in its Audit module. The same catalog assesses your own policy documents inside the product, and most of the technical controls are confirmed from live records rather than from a document." />
      </Section>
      <ClosingCta title="See the controls in a running system" body="The hosted demo shows every one of these controls operating on a fictional bank's agents, with the evidence behind each decision." />
    </>
  );
}
